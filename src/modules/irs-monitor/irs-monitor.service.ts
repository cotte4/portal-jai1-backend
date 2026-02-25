import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FederalStatusNew, IrsCheckTrigger, IrsCheckResult } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { EncryptionService } from '../../common/services';
import { NotificationsService } from '../notifications/notifications.service';
import { IrsScraperService } from './irs-scraper.service';
import { IrsStatusMapperService } from './irs-status-mapper.service';

@Injectable()
export class IrsMonitorService {
  private readonly logger = new Logger(IrsMonitorService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private scraper: IrsScraperService,
    private mapper: IrsStatusMapperService,
    private notifications: NotificationsService,
  ) {}

  async getFiledClients() {
    const taxCases = await this.prisma.taxCase.findMany({
      where: { caseStatus: 'taxes_filed' },
      include: {
        clientProfile: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
        irsChecks: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return taxCases.map((tc: any) => {
      // Determine which amount will actually be sent to IRS WMR (same priority as runCheck)
      const rawRefund = tc.federalActualRefund ?? tc.estimatedRefund;
      const irsRefundAmount = rawRefund ? Math.round(Number(rawRefund)) : null;

      return {
        taxCaseId: tc.id,
        taxYear: tc.taxYear,
        estimatedRefund: tc.estimatedRefund,
        federalActualRefund: tc.federalActualRefund,
        irsRefundAmount,           // the amount that will actually be submitted to IRS WMR
        paymentMethod: tc.paymentMethod,
        federalStatusNew: tc.federalStatusNew,
        federalStatusNewChangedAt: tc.federalStatusNewChangedAt,
        clientName: `${tc.clientProfile.user.firstName} ${tc.clientProfile.user.lastName}`,
        clientEmail: tc.clientProfile.user.email,
        userId: tc.clientProfile.user.id,
        ssnMasked: tc.clientProfile.ssn ? this.encryption.maskSSN(tc.clientProfile.ssn) : null,
        lastCheck: tc.irsChecks[0] ?? null,
      };
    });
  }

  async runCheck(taxCaseId: string, adminId: string) {
    const taxCase = await this.prisma.taxCase.findUnique({
      where: { id: taxCaseId },
      include: {
        clientProfile: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, preferredLanguage: true },
            },
          },
        },
      },
    });

    if (!taxCase) throw new NotFoundException('Tax case not found');

    const { clientProfile } = taxCase;
    const user = clientProfile.user;

    // Validate SSN — use safeDecrypt so corrupted/non-encrypted data returns null
    // rather than the raw ciphertext being sent to IRS
    const ssn = this.encryption.safeDecrypt(clientProfile.ssn ?? null, 'ssn');
    if (!ssn) {
      const check = await this.prisma.irsCheck.create({
        data: {
          taxCaseId,
          irsRawStatus: 'No SSN on file',
          checkResult: IrsCheckResult.error,
          triggeredBy: IrsCheckTrigger.manual,
          triggeredByUserId: adminId,
          statusChanged: false,
          errorMessage: 'Client has no SSN on file',
        },
      });
      return { success: false, error: 'Client has no SSN on file', check };
    }

    // Validate refund amount — IRS WMR is federal only, so prioritise the exact
    // federal amount from the filed return. Fall back to the pre-filing estimate
    // only if the federal-specific amount hasn't been entered yet.
    const rawRefund = taxCase.federalActualRefund ?? taxCase.estimatedRefund;
    const refundAmount = rawRefund ? Math.round(Number(rawRefund)) : null;
    if (!refundAmount) {
      const check = await this.prisma.irsCheck.create({
        data: {
          taxCaseId,
          irsRawStatus: 'No refund amount on file',
          checkResult: IrsCheckResult.error,
          triggeredBy: IrsCheckTrigger.manual,
          triggeredByUserId: adminId,
          statusChanged: false,
          errorMessage: 'Client has no federal refund amount on file (set federalActualRefund or estimatedRefund)',
        },
      });
      return { success: false, error: 'Client has no federal refund amount on file', check };
    }

    // Run scraper
    this.logger.log(`IRS check for ${user.firstName} ${user.lastName} (taxCase: ${taxCaseId})`);
    const scrapeResult = await this.scraper.checkRefundStatus({
      ssn,
      refundAmount,
      taxYear: taxCase.taxYear,
    });

    // Map result to JAI1 status
    const mappedStatus = this.mapper.map(scrapeResult.rawStatus, taxCase.paymentMethod);
    const previousStatus = taxCase.federalStatusNew as FederalStatusNew | null;
    const statusChanged = mappedStatus !== null && mappedStatus !== previousStatus;

    // Save check record
    const check = await this.prisma.irsCheck.create({
      data: {
        taxCaseId,
        irsRawStatus: scrapeResult.rawStatus,
        irsDetails: scrapeResult.details,
        screenshotPath: scrapeResult.screenshotPath,
        mappedStatus,
        previousStatus,
        statusChanged,
        checkResult: scrapeResult.result,
        triggeredBy: IrsCheckTrigger.manual,
        triggeredByUserId: adminId,
        errorMessage: scrapeResult.errorMessage ?? null,
      },
    });

    // Update TaxCase + history + notification if status changed
    if (statusChanged && mappedStatus) {
      const now = new Date();
      await this.prisma.$transaction(async (tx: any) => {
        await tx.taxCase.update({
          where: { id: taxCaseId },
          data: {
            federalStatusNew: mappedStatus,
            federalStatusNewChangedAt: now,
            federalLastReviewedAt: now,
            federalLastComment: `IRS Monitor: ${scrapeResult.rawStatus}`,
          },
        });

        await tx.statusHistory.create({
          data: {
            taxCaseId,
            previousStatus: previousStatus ?? undefined,
            newStatus: mappedStatus,
            changedById: adminId,
            comment: `IRS Monitor (automático): ${scrapeResult.rawStatus}`,
            internalComment: `Triggered by admin ${adminId} via IRS Monitor`,
          },
        });
      });

      // Notify client (non-blocking — don't fail the check if notification fails)
      await this.notifications
        .create(
          user.id,
          'status_change',
          'Estado de tu reembolso actualizado',
          `Tu estado federal fue actualizado a: ${mappedStatus.replace(/_/g, ' ')}`,
        )
        .catch((err: Error) => {
          this.logger.warn(`Notification failed for user ${user.id}: ${err.message}`);
        });

      this.logger.log(
        `Status updated: ${user.firstName} ${user.lastName} — ${previousStatus ?? 'null'} → ${mappedStatus}`,
      );
    }

    return {
      success: scrapeResult.result === IrsCheckResult.success,
      statusChanged,
      previousStatus,
      newStatus: mappedStatus,
      rawStatus: scrapeResult.rawStatus,
      check,
    };
  }

  async getChecks(cursor?: string, limit = 20) {
    const effectiveLimit = Math.min(limit, 100);

    const checks = await this.prisma.irsCheck.findMany({
      take: effectiveLimit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        taxCase: {
          include: {
            clientProfile: {
              include: {
                user: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });

    const hasMore = checks.length > effectiveLimit;
    const results = hasMore ? checks.slice(0, -1) : checks;

    return {
      checks: results.map((c: any) => ({
        ...c,
        clientName: `${c.taxCase.clientProfile.user.firstName} ${c.taxCase.clientProfile.user.lastName}`,
      })),
      nextCursor: hasMore ? results[results.length - 1]?.id : null,
      hasMore,
    };
  }

  async getChecksForClient(taxCaseId: string) {
    return this.prisma.irsCheck.findMany({
      where: { taxCaseId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
