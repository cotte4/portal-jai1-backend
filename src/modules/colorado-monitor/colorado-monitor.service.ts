import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StateStatusNew, IrsCheckTrigger, IrsCheckResult } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { EncryptionService } from '../../common/services';
import { NotificationsService } from '../notifications/notifications.service';
import { SupabaseService } from '../../config/supabase.service';
import { ColoradoScraperService } from './colorado-scraper.service';
import { ColoradoStatusMapperService } from './colorado-status-mapper.service';

@Injectable()
export class ColoradoMonitorService {
  private readonly logger = new Logger(ColoradoMonitorService.name);

  private readonly SCREENSHOT_BUCKET = 'colorado-screenshots';
  private isRunningCheckAll = false;

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private scraper: ColoradoScraperService,
    private mapper: ColoradoStatusMapperService,
    private notifications: NotificationsService,
    private supabase: SupabaseService,
  ) {}

  async getFiledClients() {
    const taxCases = await this.prisma.taxCase.findMany({
      where: {
        caseStatus: { in: ['taxes_filed', 'case_issues'] },
        OR: [
          { workState: { equals: 'Colorado', mode: 'insensitive' } },
          { workState: { equals: 'CO', mode: 'insensitive' } },
        ],
      },
      include: {
        clientProfile: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
        coloradoChecks: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return taxCases.map((tc: any) => {
      const stateRefundAmount = tc.stateActualRefund
        ? Math.round(Number(tc.stateActualRefund))
        : null;

      return {
        taxCaseId: tc.id,
        stateActualRefund: stateRefundAmount,
        paymentMethod: tc.paymentMethod,
        stateStatusNew: tc.stateStatusNew,
        stateStatusNewChangedAt: tc.stateStatusNewChangedAt,
        clientName: `${tc.clientProfile.user.firstName} ${tc.clientProfile.user.lastName}`,
        clientEmail: tc.clientProfile.user.email,
        userId: tc.clientProfile.user.id,
        ssnMasked: tc.clientProfile.ssn ? this.encryption.maskSSN(tc.clientProfile.ssn) : null,
        lastCheck: tc.coloradoChecks[0] ?? null,
      };
    });
  }

  async runAllChecks(
    trigger: IrsCheckTrigger = IrsCheckTrigger.manual,
    adminId: string | null = null,
  ): Promise<{ total: number; succeeded: number; failed: number }> {
    if (this.isRunningCheckAll) {
      this.logger.warn('runAllChecks already in progress — skipping duplicate run');
      return { total: 0, succeeded: 0, failed: 0 };
    }

    this.isRunningCheckAll = true;

    try {
      const taxCases = await this.prisma.taxCase.findMany({
        where: {
          caseStatus: { in: ['taxes_filed', 'case_issues'] },
          OR: [
            { workState: { equals: 'Colorado', mode: 'insensitive' } },
            { workState: { equals: 'CO', mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });

      const total = taxCases.length;
      let succeeded = 0;
      let failed = 0;

      this.logger.log(`runAllChecks started: ${total} CO clients (trigger: ${trigger})`);

      for (const { id } of taxCases) {
        try {
          const result = await this.runCheck(id, adminId, trigger);
          if (result.success || result.statusChanged) succeeded++;
          else failed++;
        } catch (err) {
          this.logger.warn(`runAllChecks: check failed for ${id}: ${(err as Error).message}`);
          failed++;
        }
      }

      this.logger.log(`runAllChecks complete: ${succeeded}/${total} succeeded, ${failed} failed`);
      return { total, succeeded, failed };
    } finally {
      this.isRunningCheckAll = false;
    }
  }

  async getStats(): Promise<{ changesLast24h: number }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const changesLast24h = await this.prisma.coloradoCheck.count({
      where: { statusChanged: true, createdAt: { gte: since } },
    });
    return { changesLast24h };
  }

  async runCheck(taxCaseId: string, adminId: string | null = null, trigger: IrsCheckTrigger = IrsCheckTrigger.manual) {
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

    // Validate SSN
    const ssn = this.encryption.safeDecrypt(clientProfile.ssn ?? null, 'ssn');
    if (!ssn) {
      const check = await this.prisma.coloradoCheck.create({
        data: {
          taxCaseId,
          coRawStatus: 'No SSN on file',
          checkResult: IrsCheckResult.error,
          triggeredBy: trigger,
          triggeredByUserId: adminId ?? undefined,
          statusChanged: false,
          errorMessage: 'Client has no SSN on file',
        },
      });
      return { success: false, error: 'Client has no SSN on file', check };
    }

    // Validate state refund amount — Colorado requires it, no fallback
    const stateRefundAmount = taxCase.stateActualRefund
      ? Math.round(Number(taxCase.stateActualRefund))
      : null;
    if (!stateRefundAmount) {
      const check = await this.prisma.coloradoCheck.create({
        data: {
          taxCaseId,
          coRawStatus: 'No state refund amount on file',
          checkResult: IrsCheckResult.error,
          triggeredBy: trigger,
          triggeredByUserId: adminId ?? undefined,
          statusChanged: false,
          errorMessage: 'Set the state actual refund amount before running Colorado checks',
        },
      });
      return { success: false, error: 'No state actual refund amount on file', check };
    }

    // Run scraper
    this.logger.log(`Colorado check for ${user.firstName} ${user.lastName} (taxCase: ${taxCaseId})`);
    let scrapeResult: Awaited<ReturnType<typeof this.scraper.checkRefundStatus>>;
    try {
      const scraperParams = {
        ssn,
        stateRefundAmount,
        taxCaseId,
        clientName: `${user.firstName} ${user.lastName}`,
      };

      scrapeResult = await this.scraper.checkRefundStatus(scraperParams);

      if (scrapeResult.result === 'error' || scrapeResult.result === 'timeout') {
        this.logger.warn(`Check ${scrapeResult.result} for ${taxCaseId}, retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        scrapeResult = await this.scraper.checkRefundStatus(scraperParams);
        this.logger.log(`Retry result: ${scrapeResult.result} — ${scrapeResult.rawStatus}`);
      }
    } catch (err) {
      const message = (err as Error).message ?? 'Unexpected scraper error';
      this.logger.error(`runCheck unexpected error [${taxCaseId}]: ${message}`);
      const check = await this.prisma.coloradoCheck.create({
        data: {
          taxCaseId,
          coRawStatus: 'Error',
          checkResult: IrsCheckResult.error,
          triggeredBy: trigger,
          triggeredByUserId: adminId,
          statusChanged: false,
          errorMessage: message,
        },
      });
      return { success: false, error: message, check };
    }

    // Map result to JAI1 state status
    const mappedStatus = this.mapper.map(scrapeResult.rawStatus, taxCase.paymentMethod);
    const previousStatus = taxCase.stateStatusNew as StateStatusNew | null;
    const statusChanged = mappedStatus !== null && mappedStatus !== previousStatus;

    // Save check record
    const check = await this.prisma.coloradoCheck.create({
      data: {
        taxCaseId,
        coRawStatus: scrapeResult.rawStatus,
        coDetails: scrapeResult.details,
        screenshotPath: scrapeResult.screenshotPath,
        mappedStatus,
        previousStatus,
        statusChanged,
        checkResult: scrapeResult.result,
        triggeredBy: trigger,
        triggeredByUserId: adminId,
        errorMessage: scrapeResult.errorMessage ?? null,
      },
    });

    // Status changes require admin approval (same pattern as IRS)
    if (statusChanged && mappedStatus) {
      this.logger.log(
        `Recommendation: ${user.firstName} ${user.lastName} — ${previousStatus ?? 'null'} → ${mappedStatus} (pending admin approval)`,
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

    const checks = await this.prisma.coloradoCheck.findMany({
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
    return this.prisma.coloradoCheck.findMany({
      where: { taxCaseId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async exportCsv(): Promise<string> {
    const checks = await this.prisma.coloradoCheck.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        taxCase: {
          include: {
            clientProfile: {
              include: { user: { select: { firstName: true, lastName: true, email: true } } },
            },
          },
        },
      },
    });

    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const headers = [
      'Date', 'Client Name', 'Email',
      'CO Raw Status', 'Mapped Status', 'Status Changed', 'Previous Status',
      'Check Result', 'Triggered By', 'Error Message',
    ];

    const rows = checks.map((c: any) => {
      const u = c.taxCase.clientProfile.user;
      return [
        new Date(c.createdAt).toISOString(),
        `${u.firstName} ${u.lastName}`,
        u.email,
        c.coRawStatus,
        c.mappedStatus ?? '',
        c.statusChanged ? 'YES' : 'no',
        c.previousStatus ?? '',
        c.checkResult,
        c.triggeredBy,
        c.errorMessage ?? '',
      ].map(escape).join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  async approveCheck(checkId: string, adminId: string) {
    const check = await this.prisma.coloradoCheck.findUnique({
      where: { id: checkId },
      include: {
        taxCase: {
          include: {
            clientProfile: {
              include: { user: { select: { id: true, firstName: true, lastName: true } } },
            },
          },
        },
      },
    });

    if (!check) throw new NotFoundException('Check not found');
    if (!check.statusChanged || !check.mappedStatus) {
      return { applied: false, reason: 'No status change to approve' };
    }

    const taxCase = check.taxCase;
    const user = taxCase.clientProfile.user;
    const mappedStatus = check.mappedStatus as StateStatusNew;
    const previousStatus = taxCase.stateStatusNew as StateStatusNew | null;

    if (mappedStatus === previousStatus) {
      return { applied: false, reason: 'Status already matches recommendation' };
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx: any) => {
      await tx.taxCase.update({
        where: { id: taxCase.id },
        data: {
          stateStatusNew: mappedStatus,
          stateStatusNewChangedAt: now,
          stateLastReviewedAt: now,
          stateLastComment: `Colorado Monitor (aprobado): ${check.coRawStatus}`,
        },
      });

      await tx.statusHistory.create({
        data: {
          taxCaseId: taxCase.id,
          previousStatus: previousStatus ?? undefined,
          newStatus: mappedStatus,
          changedById: adminId,
          comment: `Colorado Monitor (aprobado por admin): ${check.coRawStatus}`,
          internalComment: `Admin ${adminId} approved Colorado check ${checkId}`,
        },
      });
    });

    await this.notifications
      .create(
        user.id,
        'status_change',
        'Estado de tu reembolso actualizado',
        `Tu estado estatal fue actualizado a: ${mappedStatus.replace(/_/g, ' ')}`,
      )
      .catch((err: Error) => {
        this.logger.warn(`Notification failed for user ${user.id}: ${err.message}`);
      });

    this.logger.log(
      `Status APPROVED: ${user.firstName} ${user.lastName} — ${previousStatus ?? 'null'} → ${mappedStatus}`,
    );

    return { applied: true, previousStatus, newStatus: mappedStatus };
  }

  async dismissCheck(checkId: string) {
    const check = await this.prisma.coloradoCheck.findUnique({ where: { id: checkId } });
    if (!check) throw new NotFoundException('Check not found');

    await this.prisma.coloradoCheck.update({
      where: { id: checkId },
      data: { statusChanged: false },
    });

    return { dismissed: true };
  }

  async getScreenshotUrl(checkId: string): Promise<{ url: string }> {
    const check = await this.prisma.coloradoCheck.findUnique({
      where: { id: checkId },
      select: { screenshotPath: true },
    });
    if (!check?.screenshotPath) throw new NotFoundException('No screenshot for this check');
    const url = await this.supabase.getSignedUrl(this.SCREENSHOT_BUCKET, check.screenshotPath, 86400);
    return { url };
  }
}
