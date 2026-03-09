import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../../config/prisma.service';
import { SupabaseService } from '../../../config/supabase.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  calculateAlarms,
  StatusAlarm,
} from '../../../common/utils/status-mapping.util';

@Injectable()
export class ClientReportingService {
  private readonly logger = new Logger(ClientReportingService.name);

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private auditLogsService: AuditLogsService,
  ) {}

  /**
   * Get comprehensive dashboard stats for admin statistics page
   * Returns group counts, status breakdowns, and financial summary — all from DB aggregates
   */
  async getDashboardStats() {
    const [
      totalCases,
      pending,
      completed,
      needsAttention,
      caseStatusGroups,
      federalStatusGroups,
      stateStatusGroups,
      refundData,
    ] = await Promise.all([
      // Total tax cases
      this.prisma.taxCase.count(),

      // Pending: not yet taxes_filed
      this.prisma.taxCase.count({
        where: { caseStatus: { not: 'taxes_filed' as any } },
      }),

      // Completed: taxes_filed + either track completed
      this.prisma.taxCase.count({
        where: {
          caseStatus: 'taxes_filed' as any,
          OR: [
            { federalStatusNew: 'taxes_completados' as any },
            { stateStatusNew: 'taxes_completados' as any },
          ],
        },
      }),

      // Needs attention: taxes_filed + not completed + either track has problems
      this.prisma.taxCase.count({
        where: {
          caseStatus: 'taxes_filed' as any,
          AND: [
            {
              NOT: {
                OR: [
                  { federalStatusNew: 'taxes_completados' as any },
                  { stateStatusNew: 'taxes_completados' as any },
                ],
              },
            },
            {
              OR: [
                { federalStatusNew: 'problemas' as any },
                { stateStatusNew: 'problemas' as any },
              ],
            },
          ],
        },
      }),

      // Case status breakdown
      this.prisma.taxCase.groupBy({
        by: ['caseStatus'],
        _count: { _all: true },
      }),

      // Federal status breakdown (filed cases only)
      this.prisma.taxCase.groupBy({
        by: ['federalStatusNew'],
        where: { caseStatus: 'taxes_filed' as any, federalStatusNew: { not: null } },
        _count: { _all: true },
      }),

      // State status breakdown (filed cases only)
      this.prisma.taxCase.groupBy({
        by: ['stateStatusNew'],
        where: { caseStatus: 'taxes_filed' as any, stateStatusNew: { not: null } },
        _count: { _all: true },
      }),

      // Refund totals
      this.prisma.$queryRaw<[{
        total_federal: number | null;
        total_state: number | null;
        count_federal: bigint | null;
        count_state: bigint | null;
      }]>`
        SELECT
          SUM("federal_actual_refund") as total_federal,
          SUM("state_actual_refund") as total_state,
          COUNT(CASE WHEN "federal_actual_refund" IS NOT NULL THEN 1 END) as count_federal,
          COUNT(CASE WHEN "state_actual_refund" IS NOT NULL THEN 1 END) as count_state
        FROM "tax_cases"
      `,
    ]);

    // inReview = filed cases that are neither completed nor need attention
    const inReview = Math.max(0, (totalCases - pending) - completed - needsAttention);

    const caseStatusBreakdown: Record<string, number> = {};
    for (const g of caseStatusGroups) {
      caseStatusBreakdown[g.caseStatus || 'none'] = g._count._all;
    }

    const federalStatusBreakdown: Record<string, number> = {};
    for (const g of federalStatusGroups) {
      if (g.federalStatusNew) {
        federalStatusBreakdown[g.federalStatusNew] = g._count._all;
      }
    }

    const stateStatusBreakdown: Record<string, number> = {};
    for (const g of stateStatusGroups) {
      if (g.stateStatusNew) {
        stateStatusBreakdown[g.stateStatusNew] = g._count._all;
      }
    }

    const refund = refundData[0];
    const totalFederal = Number(refund?.total_federal || 0);
    const totalState = Number(refund?.total_state || 0);
    const countFederal = Number(refund?.count_federal || 0);
    const countState = Number(refund?.count_state || 0);

    return {
      groupStats: {
        total: totalCases,
        pending,
        inReview,
        completed,
        needsAttention,
      },
      caseStatusBreakdown,
      federalStatusBreakdown,
      stateStatusBreakdown,
      financials: {
        totalFederalRefunds: Math.round(totalFederal * 100) / 100,
        totalStateRefunds: Math.round(totalState * 100) / 100,
        totalRefunds: Math.round((totalFederal + totalState) * 100) / 100,
        clientsWithFederalRefund: countFederal,
        clientsWithStateRefund: countState,
        avgFederalRefund: countFederal > 0 ? Math.round(totalFederal / countFederal) : 0,
        avgStateRefund: countState > 0 ? Math.round(totalState / countState) : 0,
      },
    };
  }

  /**
   * Get payments summary for admin bank payments view
   * Returns clients with their federal/state refunds and calculated commissions
   * OPTIMIZED: Uses cursor pagination to prevent memory issues with large datasets
   */
  async getPaymentsSummary(options: { cursor?: string; limit: number }) {
    // Fetch clients with pagination (limit + 1 to check if there's more)
    const clients = await this.prisma.clientProfile.findMany({
      take: options.limit + 1,
      cursor: options.cursor ? { id: options.cursor } : undefined,
      where: {
        taxCases: {
          some: {
            OR: [
              { federalActualRefund: { not: null } },
              { stateActualRefund: { not: null } },
            ],
          },
        },
      },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        taxCases: {
          orderBy: { taxYear: 'desc' },
          take: 1,
          select: {
            federalActualRefund: true,
            stateActualRefund: true,
            federalDepositDate: true,
            stateDepositDate: true,
            paymentReceived: true,
            commissionPaid: true,
            federalCommissionRate: true,
            stateCommissionRate: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = clients.length > options.limit;
    const results = hasMore ? clients.slice(0, -1) : clients;

    // Map to payments data (using per-client commission rates)
    const paymentsData = results.map((client) => {
      const tc = client.taxCases[0];
      const federalTaxes = Number(tc?.federalActualRefund || 0);
      const stateTaxes = Number(tc?.stateActualRefund || 0);
      const totalTaxes = federalTaxes + stateTaxes;
      const fedRate = Number(tc?.federalCommissionRate || 0.11);
      const stateRate = Number(tc?.stateCommissionRate || 0.11);
      const federalCommission = Math.round(federalTaxes * fedRate * 100) / 100;
      const stateCommission = Math.round(stateTaxes * stateRate * 100) / 100;
      const totalCommission = Math.round((federalCommission + stateCommission) * 100) / 100;
      const clientReceives = Math.round((totalTaxes - totalCommission) * 100) / 100;

      return {
        id: client.id,
        name: `${client.user.firstName || ''} ${client.user.lastName || ''}`.trim() || 'Sin Nombre',
        email: client.user.email,
        federalTaxes,
        stateTaxes,
        totalTaxes,
        federalCommission,
        stateCommission,
        totalCommission,
        clientReceives,
        federalDepositDate: tc?.federalDepositDate,
        stateDepositDate: tc?.stateDepositDate,
        paymentReceived: tc?.paymentReceived,
        commissionPaid: tc?.commissionPaid,
      };
    });

    // Calculate totals by summing per-client results (rates vary per case)
    const totals = paymentsData.reduce(
      (acc, client) => {
        acc.federalTaxes += client.federalTaxes;
        acc.stateTaxes += client.stateTaxes;
        acc.totalTaxes += client.totalTaxes;
        acc.federalCommission += client.federalCommission;
        acc.stateCommission += client.stateCommission;
        acc.totalCommission += client.totalCommission;
        acc.clientReceives += client.clientReceives;
        return acc;
      },
      {
        federalTaxes: 0,
        stateTaxes: 0,
        totalTaxes: 0,
        federalCommission: 0,
        stateCommission: 0,
        totalCommission: 0,
        clientReceives: 0,
      },
    );

    // Round all totals
    totals.federalTaxes = Math.round(totals.federalTaxes * 100) / 100;
    totals.stateTaxes = Math.round(totals.stateTaxes * 100) / 100;
    totals.totalTaxes = Math.round(totals.totalTaxes * 100) / 100;
    totals.federalCommission = Math.round(totals.federalCommission * 100) / 100;
    totals.stateCommission = Math.round(totals.stateCommission * 100) / 100;
    totals.totalCommission = Math.round(totals.totalCommission * 100) / 100;
    totals.clientReceives = Math.round(totals.clientReceives * 100) / 100;

    return {
      clients: paymentsData,
      nextCursor: hasMore ? results[results.length - 1]?.id : null,
      hasMore,
      totals,
    };
  }

  /**
   * Get delays data for admin delays view
   * Shows timing metrics: documentation complete, filing, deposit dates, and calculated delays
   * OPTIMIZED: Uses cursor pagination and filters to prevent memory issues with large datasets
   */
  async getDelaysData(options: {
    cursor?: string;
    limit: number;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
  }) {
    // Build where clause with filters (V2: use caseStatus instead of taxesFiled)
    const where: any = {
      taxCases: {
        some: {
          caseStatus: 'taxes_filed', // Only clients with filed taxes (V2)
        },
      },
    };

    // Add date range filter if provided (V2: use caseStatusChangedAt)
    if (options.dateFrom || options.dateTo) {
      where.taxCases.some.caseStatusChangedAt = {};
      if (options.dateFrom) {
        where.taxCases.some.caseStatusChangedAt.gte = new Date(options.dateFrom);
      }
      if (options.dateTo) {
        where.taxCases.some.caseStatusChangedAt.lte = new Date(options.dateTo);
      }
    }

    // Add status filter if provided (v2 status)
    if (options.status) {
      where.taxCases.some.OR = [
        { federalStatusNew: options.status },
        { stateStatusNew: options.status },
      ];
    }

    // Fetch clients with pagination (limit + 1 to check if there's more)
    const clients = await this.prisma.clientProfile.findMany({
      take: options.limit + 1,
      cursor: options.cursor ? { id: options.cursor } : undefined,
      where,
      include: {
        user: { select: { firstName: true, lastName: true } },
        taxCases: {
          where: { caseStatus: 'taxes_filed' },
          orderBy: { taxYear: 'desc' },
          take: 1,
          select: {
            id: true,
            caseStatus: true,
            caseStatusChangedAt: true,
            federalStatusNew: true,
            stateStatusNew: true,
            federalDepositDate: true,
            stateDepositDate: true,
            problemType: true,
            hasProblem: true,
            statusHistory: {
              select: { newStatus: true, comment: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = clients.length > options.limit;
    const results = hasMore ? clients.slice(0, -1) : clients;

    // Helper to calculate days between two dates
    const daysBetween = (start: Date | null, end: Date | null): number | null => {
      if (!start || !end) return null;
      const diffMs = end.getTime() - start.getTime();
      return Math.round(diffMs / (1000 * 60 * 60 * 24));
    };

    const delaysData = results
      .filter((client) => client.taxCases[0]) // Ensure tax case exists
      .map((client) => {
        const tc = client.taxCases[0];
        // V2: derive taxesFiledAt from caseStatusChangedAt when caseStatus is taxes_filed
        const taxesFiledAt = tc.caseStatusChangedAt ? new Date(tc.caseStatusChangedAt) : null;
        const federalDepositDate = tc.federalDepositDate ? new Date(tc.federalDepositDate) : null;
        const stateDepositDate = tc.stateDepositDate ? new Date(tc.stateDepositDate) : null;

        // Check verification per track (federal vs state)
        const federalVerification =
          tc.federalStatusNew === 'en_verificacion' ||
          tc.federalStatusNew === 'verificacion_en_progreso' ||
          tc.statusHistory.some(
            (h) =>
              (h.newStatus?.toLowerCase().includes('verif') &&
                h.newStatus?.toLowerCase().includes('federal')) ||
              (h.comment?.toLowerCase().includes('verif') &&
                h.comment?.toLowerCase().includes('federal')),
          );

        const stateVerification =
          tc.stateStatusNew === 'en_verificacion' ||
          tc.stateStatusNew === 'verificacion_en_progreso' ||
          tc.statusHistory.some(
            (h) =>
              (h.newStatus?.toLowerCase().includes('verif') &&
                (h.newStatus?.toLowerCase().includes('state') ||
                  h.newStatus?.toLowerCase().includes('estat'))) ||
              (h.comment?.toLowerCase().includes('verif') &&
                (h.comment?.toLowerCase().includes('state') ||
                  h.comment?.toLowerCase().includes('estat'))),
          );

        const wentThroughVerification = federalVerification || stateVerification;

        // Documentation complete date - we use taxesFiledAt as the documentation was complete before filing
        const documentationCompleteDate = taxesFiledAt; // Approximation

        return {
          id: client.id,
          name: `${client.user.firstName || ''} ${client.user.lastName || ''}`.trim() || 'Sin Nombre',
          documentationCompleteDate,
          taxesFiledAt,
          federalDepositDate,
          stateDepositDate,
          wentThroughVerification,
          federalVerification,
          stateVerification,
          federalDelayDays: daysBetween(taxesFiledAt, federalDepositDate),
          stateDelayDays: daysBetween(taxesFiledAt, stateDepositDate),
          federalStatus: tc.federalStatusNew,
          stateStatus: tc.stateStatusNew,
        };
      });

    return {
      clients: delaysData,
      nextCursor: hasMore ? results[results.length - 1]?.id : null,
      hasMore,
    };
  }

  /**
   * Get season summary stats for admin dashboard
   * Returns total clients, taxes completed %, projected earnings, and earnings to date
   * OPTIMIZED: Uses database aggregations instead of full-table scans
   */
  async getSeasonStats() {
    const DEFAULT_COMMISSION_RATE = 0.11; // 11% default for projections

    // Use parallel aggregate queries for maximum performance
    const [
      totalClients,
      totalTaxCases,
      completedCases,
      depositedCases,
      earningsResult,
      projectedRefundResult,
    ] = await Promise.all([
      // Total clients count
      this.prisma.clientProfile.count(),

      // Total tax cases count
      this.prisma.taxCase.count(),

      // Count completed cases (v2 status = taxes_completados)
      this.prisma.taxCase.count({
        where: {
          OR: [
            { federalStatusNew: 'taxes_completados' },
            { stateStatusNew: 'taxes_completados' },
          ],
        },
      }),

      // Count cases with deposit dates
      this.prisma.taxCase.count({
        where: {
          OR: [
            { federalDepositDate: { not: null } },
            { stateDepositDate: { not: null } },
          ],
        },
      }),

      // Earnings to date: only count each track when that track's deposit date is set
      // This prevents counting state commission when only federal has deposited (and vice versa)
      this.prisma.$queryRaw<[{ earnings: number | null }]>`
        SELECT SUM(
          CASE WHEN "federal_deposit_date" IS NOT NULL
            THEN COALESCE("federal_actual_refund", 0) * COALESCE("federal_commission_rate", 0.11)
            ELSE 0
          END +
          CASE WHEN "state_deposit_date" IS NOT NULL
            THEN COALESCE("state_actual_refund", 0) * COALESCE("state_commission_rate", 0.11)
            ELSE 0
          END
        ) as "earnings"
        FROM "tax_cases"
        WHERE "federal_deposit_date" IS NOT NULL OR "state_deposit_date" IS NOT NULL
      `,

      // Sum of projected refunds for all cases
      this.prisma.$queryRaw<[{ projectedBase: number | null }]>`
        SELECT SUM(
          COALESCE(
            "estimated_refund",
            COALESCE("federal_actual_refund", 0) + COALESCE("state_actual_refund", 0)
          )
        ) as "projectedBase"
        FROM "tax_cases"
      `,
    ]);

    // Calculate completed count (max of status-based or date-based)
    const taxesCompletedCount = Math.max(completedCases, depositedCases);

    // Earnings to date from raw SQL (already uses per-case rates)
    const earningsToDate = Number(earningsResult[0]?.earnings || 0);

    // Projected earnings uses default rate (most cases won't have custom rates yet)
    const projectedBase = Number(projectedRefundResult[0]?.projectedBase || 0);
    const projectedEarnings = projectedBase * DEFAULT_COMMISSION_RATE;

    return {
      totalClients,
      taxesCompletedPercent:
        totalTaxCases > 0
          ? Math.round((taxesCompletedCount / totalTaxCases) * 100)
          : 0,
      projectedEarnings: Math.round(projectedEarnings * 100) / 100,
      earningsToDate: Math.round(earningsToDate * 100) / 100,
    };
  }

  /**
   * Get all clients that have active alarms (NEW STATUS SYSTEM v2)
   * Used for alarm dashboard
   */
  async getClientsWithAlarms(): Promise<{
    clients: Array<{
      id: string;
      name: string;
      alarms: StatusAlarm[];
      federalStatusNew: string | null;
      stateStatusNew: string | null;
      federalStatusNewChangedAt: Date | null;
      stateStatusNewChangedAt: Date | null;
    }>;
    totalWithAlarms: number;
    totalCritical: number;
    totalWarning: number;
  }> {
    // Get all tax cases with the new status fields
    const taxCases = await this.prisma.taxCase.findMany({
      where: {
        OR: [
          { federalStatusNew: { not: null } },
          { stateStatusNew: { not: null } },
        ],
      },
      select: {
        id: true,
        federalStatusNew: true,
        federalStatusNewChangedAt: true,
        stateStatusNew: true,
        stateStatusNewChangedAt: true,
        clientProfile: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    // Calculate alarms for each client
    const clientsWithAlarms: Array<{
      id: string;
      name: string;
      alarms: StatusAlarm[];
      federalStatusNew: string | null;
      stateStatusNew: string | null;
      federalStatusNewChangedAt: Date | null;
      stateStatusNewChangedAt: Date | null;
    }> = [];

    let totalCritical = 0;
    let totalWarning = 0;

    for (const tc of taxCases) {
      const alarms = calculateAlarms(
        tc.federalStatusNew,
        tc.federalStatusNewChangedAt,
        tc.stateStatusNew,
        tc.stateStatusNewChangedAt,
      );

      if (alarms.length > 0) {
        const name = tc.clientProfile?.user
          ? `${tc.clientProfile.user.firstName || ''} ${tc.clientProfile.user.lastName || ''}`.trim()
          : 'Cliente';

        clientsWithAlarms.push({
          id: tc.clientProfile?.id || tc.id,
          name,
          alarms,
          federalStatusNew: tc.federalStatusNew,
          stateStatusNew: tc.stateStatusNew,
          federalStatusNewChangedAt: tc.federalStatusNewChangedAt,
          stateStatusNewChangedAt: tc.stateStatusNewChangedAt,
        });

        // Count alarm levels
        for (const alarm of alarms) {
          if (alarm.level === 'critical') totalCritical++;
          else totalWarning++;
        }
      }
    }

    // Sort by critical alarms first, then by days since status change
    clientsWithAlarms.sort((a, b) => {
      const aHasCritical = a.alarms.some(al => al.level === 'critical');
      const bHasCritical = b.alarms.some(al => al.level === 'critical');
      if (aHasCritical && !bHasCritical) return -1;
      if (!aHasCritical && bHasCritical) return 1;

      // Sort by max days
      const aMaxDays = Math.max(...a.alarms.map(al => al.daysSinceStatusChange));
      const bMaxDays = Math.max(...b.alarms.map(al => al.daysSinceStatusChange));
      return bMaxDays - aMaxDays;
    });

    return {
      clients: clientsWithAlarms,
      totalWithAlarms: clientsWithAlarms.length,
      totalCritical,
      totalWarning,
    };
  }

  /**
   * Reset W2 estimate for a client (admin only)
   * This allows the user to recalculate their W2 estimate
   * Deletes: W2Estimate record, associated Document, and storage file
   */
  async resetW2Estimate(clientProfileId: string, adminUserId: string) {
    const clientProfile = await this.prisma.clientProfile.findUnique({
      where: { id: clientProfileId },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        taxCases: {
          orderBy: { taxYear: 'desc' },
          take: 1,
          include: {
            documents: {
              where: { type: 'w2' },
            },
          },
        },
      },
    });

    if (!clientProfile) {
      throw new NotFoundException('Client profile not found');
    }

    const userId = clientProfile.user.id;
    const taxCase = clientProfile.taxCases[0];

    // Find all W2 estimates for this user
    const w2Estimates = await this.prisma.w2Estimate.findMany({
      where: { userId },
    });

    if (w2Estimates.length === 0 && (!taxCase?.documents || taxCase.documents.length === 0)) {
      throw new BadRequestException('No W2 estimate or document found for this client');
    }

    // Track what was deleted for audit log
    const deletedItems: string[] = [];

    // Delete W2 estimates and their storage files
    for (const estimate of w2Estimates) {
      if (estimate.w2StoragePath) {
        try {
          await this.supabase.deleteFile('documents', estimate.w2StoragePath);
          this.logger.log(`Deleted W2 storage file: ${estimate.w2StoragePath}`);
        } catch (err) {
          this.logger.warn(`Failed to delete W2 storage file: ${estimate.w2StoragePath}`, err);
        }
      }
      deletedItems.push(`W2Estimate:${estimate.id}`);
    }

    // Delete all W2 estimates for this user
    await this.prisma.w2Estimate.deleteMany({
      where: { userId },
    });
    this.logger.log(`Deleted ${w2Estimates.length} W2 estimate(s) for user ${userId}`);

    // Delete W2 documents and their storage files
    if (taxCase?.documents) {
      for (const doc of taxCase.documents) {
        if (doc.storagePath) {
          try {
            await this.supabase.deleteFile('documents', doc.storagePath);
            this.logger.log(`Deleted W2 document file: ${doc.storagePath}`);
          } catch (err) {
            this.logger.warn(`Failed to delete W2 document file: ${doc.storagePath}`, err);
          }
        }
        deletedItems.push(`Document:${doc.id}`);
      }

      // Delete W2 documents from database
      await this.prisma.document.deleteMany({
        where: {
          taxCaseId: taxCase.id,
          type: 'w2',
        },
      });
      this.logger.log(`Deleted ${taxCase.documents.length} W2 document(s) for tax case ${taxCase.id}`);
    }

    // Reset estimated refund on tax case
    if (taxCase) {
      await this.prisma.taxCase.update({
        where: { id: taxCase.id },
        data: { estimatedRefund: null },
      });
      this.logger.log(`Reset estimated refund for tax case ${taxCase.id}`);
    }

    // Update computed status fields
    await this.prisma.clientProfile.update({
      where: { id: clientProfileId },
      data: {
        isReadyToPresent: false,
        isIncomplete: true,
      },
    });

    // Audit log
    await this.auditLogsService.log({
      action: AuditAction.DOCUMENT_DELETE,
      userId: adminUserId,
      targetUserId: userId,
      details: {
        action: 'reset_w2_estimate',
        deletedItems,
        clientName: `${clientProfile.user.firstName} ${clientProfile.user.lastName}`,
      },
    });

    this.logger.log(`Admin ${adminUserId} reset W2 estimate for client ${clientProfileId}`);

    return {
      message: 'W2 estimate reset successfully. User can now recalculate.',
      deletedEstimates: w2Estimates.length,
      deletedDocuments: taxCase?.documents?.length || 0,
    };
  }

  /**
   * Get W2 estimate data for a client (admin only)
   * Used by visual review to display key W2 fields checklist
   */
  async getW2EstimateForClient(clientProfileId: string) {
    const clientProfile = await this.prisma.clientProfile.findUnique({
      where: { id: clientProfileId },
      select: { userId: true },
    });

    if (!clientProfile) {
      throw new NotFoundException('Client profile not found');
    }

    const w2Estimate = await this.prisma.w2Estimate.findFirst({
      where: { userId: clientProfile.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        box2Federal: true,
        box17State: true,
        estimatedRefund: true,
        w2FileName: true,
        ocrConfidence: true,
        createdAt: true,
      },
    });

    if (!w2Estimate) {
      return {
        hasEstimate: false,
        estimate: null,
      };
    }

    return {
      hasEstimate: true,
      estimate: {
        id: w2Estimate.id,
        box2Federal: Number(w2Estimate.box2Federal),
        box17State: Number(w2Estimate.box17State),
        estimatedRefund: Number(w2Estimate.estimatedRefund),
        w2FileName: w2Estimate.w2FileName,
        ocrConfidence: w2Estimate.ocrConfidence,
        createdAt: w2Estimate.createdAt,
      },
    };
  }
}
