import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../../config/prisma.service';
import { SupabaseService } from '../../../config/supabase.service';
import { EncryptionService } from '../../../common/services';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  calculateAlarms,
  StatusAlarm,
} from '../../../common/utils/status-mapping.util';

@Injectable()
export class ClientQueryService {
  private readonly logger = new Logger(ClientQueryService.name);
  private readonly PROFILE_PICTURES_BUCKET = 'profile-pictures';

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private encryption: EncryptionService,
    private auditLogsService: AuditLogsService,
  ) {}

  async findAll(options: {
    status?: string;
    search?: string;
    cursor?: string;
    limit: number;
    // Advanced filters
    hasProblem?: boolean;
    federalStatus?: string;
    stateStatus?: string;
    caseStatus?: string;
    dateFrom?: string;
    dateTo?: string;
    // Sorting
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const where: any = {};

    // Advanced filter: Date range on profile createdAt
    if (options.dateFrom || options.dateTo) {
      where.createdAt = {};
      if (options.dateFrom) {
        const fromDate = new Date(options.dateFrom);
        // Validate date is valid
        if (!isNaN(fromDate.getTime())) {
          where.createdAt.gte = fromDate;
        }
      }
      if (options.dateTo) {
        const toDate = new Date(options.dateTo);
        // Validate date is valid
        if (!isNaN(toDate.getTime())) {
          // Add 1 day to include the entire "to" day
          toDate.setDate(toDate.getDate() + 1);
          where.createdAt.lt = toDate;
        }
      }
      // Remove empty createdAt if no valid dates
      if (Object.keys(where.createdAt).length === 0) {
        delete where.createdAt;
      }
    }

    // Advanced filter: Has Problem
    if (options.hasProblem !== undefined) {
      where.taxCases = {
        ...where.taxCases,
        some: {
          ...where.taxCases?.some,
          hasProblem: options.hasProblem,
        },
      };
    }

    // Advanced filter: Federal Status (v2)
    if (options.federalStatus) {
      where.taxCases = {
        ...where.taxCases,
        some: {
          ...where.taxCases?.some,
          federalStatusNew: options.federalStatus,
        },
      };
    }

    // Advanced filter: State Status (v2)
    if (options.stateStatus) {
      where.taxCases = {
        ...where.taxCases,
        some: {
          ...where.taxCases?.some,
          stateStatusNew: options.stateStatus,
        },
      };
    }

    // Advanced filter: Case Status
    if (options.caseStatus) {
      where.taxCases = {
        ...where.taxCases,
        some: {
          ...where.taxCases?.some,
          caseStatus: options.caseStatus,
        },
      };
    }

    // Handle different filter types using new status fields
    if (options.status && options.status !== 'all') {
      const existingTaxCaseFilters = where.taxCases?.some || {};

      if (options.status === 'group_pending') {
        if (Object.keys(existingTaxCaseFilters).length > 0) {
          where.AND = [
            { taxCases: { some: existingTaxCaseFilters } },
            {
              OR: [
                { taxCases: { none: {} } },
                { taxCases: { some: { caseStatus: { not: 'taxes_filed' } } } },
                { taxCases: { some: { caseStatus: null } } },
              ],
            },
          ];
          delete where.taxCases;
        } else {
          where.OR = [
            { taxCases: { none: {} } },
            { taxCases: { some: { caseStatus: { not: 'taxes_filed' } } } },
            { taxCases: { some: { caseStatus: null } } },
          ];
        }
      } else if (options.status === 'group_in_review') {
        where.taxCases = {
          some: {
            ...existingTaxCaseFilters,
            caseStatus: 'taxes_filed',
            federalStatusNew: { in: ['taxes_en_proceso', 'cheque_en_camino', 'deposito_directo'] },
          },
        };
      } else if (options.status === 'group_completed') {
        where.taxCases = {
          some: {
            ...existingTaxCaseFilters,
            OR: [
              { federalStatusNew: 'taxes_completados' },
              { stateStatusNew: 'taxes_completados' },
            ],
          },
        };
      } else if (options.status === 'group_needs_attention') {
        where.taxCases = {
          some: {
            ...existingTaxCaseFilters,
            OR: [
              { federalStatusNew: 'issues' },
              { stateStatusNew: 'issues' },
              { hasProblem: true },
            ],
          },
        };
      } else if (options.status === 'ready_to_present') {
        where.isReadyToPresent = true;
      } else if (options.status === 'incomplete') {
        where.isIncomplete = true;
      }
    }

    if (options.search) {
      const searchCondition = {
        OR: [
          { email: { contains: options.search, mode: 'insensitive' } },
          { firstName: { contains: options.search, mode: 'insensitive' } },
          { lastName: { contains: options.search, mode: 'insensitive' } },
        ],
      };

      if (where.OR) {
        where.AND = [{ OR: where.OR }, { user: searchCondition }];
        delete where.OR;
      } else {
        where.user = searchCondition;
      }
    }

    // Build dynamic orderBy clause
    const sortOrder = options.sortOrder || 'desc';
    let orderBy: any = { createdAt: sortOrder }; // Default sort

    if (options.sortBy) {
      const sortFieldMap: Record<string, any> = {
        createdAt: { createdAt: sortOrder },
        name: { user: { firstName: sortOrder } },
        email: { user: { email: sortOrder } },
      };
      orderBy = sortFieldMap[options.sortBy] || { createdAt: sortOrder };
    }

    const clients = await this.prisma.clientProfile.findMany({
      where,
      take: options.limit + 1,
      cursor: options.cursor ? { id: options.cursor } : undefined,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        taxCases: {
          orderBy: { taxYear: 'desc' },
          take: 1,
          select: {
            id: true,
            taxesFiled: true,
            taxesFiledAt: true,
            federalLastComment: true,
            stateLastComment: true,
            federalActualRefund: true,
            stateActualRefund: true,
            federalLastReviewedAt: true,
            stateLastReviewedAt: true,
            paymentReceived: true,
            bankName: true,
            bankRoutingNumber: true,
            bankAccountNumber: true,
            hasProblem: true,
            // NEW STATUS SYSTEM (v2)
            caseStatus: true,
            caseStatusChangedAt: true,
            federalStatusNew: true,
            federalStatusNewChangedAt: true,
            stateStatusNew: true,
            stateStatusNewChangedAt: true,
            documents: {
              select: {
                id: true,
                type: true,
                fileName: true,
                storagePath: true,
                mimeType: true,
                fileSize: true,
                taxYear: true,
                isReviewed: true,
                reviewedAt: true,
                uploadedAt: true,
                uploadedById: true,
              },
            },
          },
        },
      },
      orderBy,
    });

    const hasMore = clients.length > options.limit;
    const results = hasMore ? clients.slice(0, -1) : clients;

    // BATCH ALARM CALCULATION - Process all clients at once to avoid N+1 problem
    const alarmsMap = new Map<string, StatusAlarm[]>();
    for (const client of results) {
      const taxCase = client.taxCases[0];
      if (taxCase) {
        const alarms = calculateAlarms(
          taxCase.federalStatusNew,
          taxCase.federalStatusNewChangedAt,
          taxCase.stateStatusNew,
          taxCase.stateStatusNewChangedAt,
        );
        alarmsMap.set(client.id, alarms);
      } else {
        alarmsMap.set(client.id, []);
      }
    }

    return {
      clients: results.map((client) => {
        const taxCase = client.taxCases[0];

        // Calculate missing items
        const missingItems: string[] = [];

        if (!client.ssn) {
          missingItems.push('SSN');
        }
        if (!client.dateOfBirth) {
          missingItems.push('Fecha Nac.');
        }
        if (
          !client.addressStreet ||
          !client.addressCity ||
          !client.addressState ||
          !client.addressZip
        ) {
          missingItems.push('Dirección');
        }
        if (
          !taxCase?.bankName ||
          !taxCase?.bankRoutingNumber ||
          !taxCase?.bankAccountNumber
        ) {
          missingItems.push('Banco');
        }

        const hasW2 = taxCase?.documents?.some((d) => d.type === 'w2') || false;
        if (!hasW2) {
          missingItems.push('W2');
        }

        const hasPaymentProof =
          taxCase?.documents?.some((d) => d.type === 'payment_proof') || false;
        if (!hasPaymentProof) {
          missingItems.push('Comprobante');
        }

        const isReadyToPresent =
          client.profileComplete && !client.isDraft && hasW2;

        // Compute last review date (most recent of federal/state)
        const federalReview = taxCase?.federalLastReviewedAt;
        const stateReview = taxCase?.stateLastReviewedAt;
        let lastReviewDate: Date | null = null;
        if (federalReview && stateReview) {
          lastReviewDate = federalReview > stateReview ? federalReview : stateReview;
        } else {
          lastReviewDate = federalReview || stateReview || null;
        }

        const alarms: StatusAlarm[] = alarmsMap.get(client.id) || [];

        return {
          id: client.id,
          user: {
            id: client.user.id,
            email: client.user.email,
            firstName: client.user.firstName,
            lastName: client.user.lastName,
          },
          ssn: client.ssn ? this.encryption.decrypt(client.ssn) : null,
          caseStatus: taxCase?.caseStatus || null,
          caseStatusChangedAt: taxCase?.caseStatusChangedAt || null,
          federalStatusNew: taxCase?.federalStatusNew || null,
          federalStatusNewChangedAt: taxCase?.federalStatusNewChangedAt || null,
          stateStatusNew: taxCase?.stateStatusNew || null,
          stateStatusNewChangedAt: taxCase?.stateStatusNewChangedAt || null,
          alarms,
          hasAlarm: alarms.length > 0,
          hasCriticalAlarm: alarms.some(a => a.level === 'critical'),
          federalLastComment: taxCase?.federalLastComment || null,
          stateLastComment: taxCase?.stateLastComment || null,
          federalActualRefund: taxCase?.federalActualRefund ? Number(taxCase.federalActualRefund) : null,
          stateActualRefund: taxCase?.stateActualRefund ? Number(taxCase.stateActualRefund) : null,
          lastReviewDate,
          credentials: {
            turbotaxEmail: client.turbotaxEmail ? this.encryption.decrypt(client.turbotaxEmail) : null,
            turbotaxPassword: client.turbotaxPassword ? this.encryption.decrypt(client.turbotaxPassword) : null,
            irsUsername: client.irsUsername ? this.encryption.decrypt(client.irsUsername) : null,
            irsPassword: client.irsPassword ? this.encryption.decrypt(client.irsPassword) : null,
            stateUsername: client.stateUsername ? this.encryption.decrypt(client.stateUsername) : null,
            statePassword: client.statePassword ? this.encryption.decrypt(client.statePassword) : null,
          },
          paymentReceived: taxCase?.paymentReceived || false,
          profileComplete: client.profileComplete,
          isDraft: client.isDraft,
          missingItems,
          isReadyToPresent,
          createdAt: client.createdAt,
        };
      }),
      nextCursor: hasMore ? results[results.length - 1]?.id : null,
      hasMore: hasMore,
    };
  }

  async findOne(id: string) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: {
        user: true,
        taxCases: {
          include: {
            documents: true,
            statusHistory: {
              include: { changedBy: true },
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { taxYear: 'desc' },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    // Get profile picture URL if exists (inlined from getProfilePictureUrl)
    let profilePictureUrl: string | null = null;
    if (client.user.profilePicturePath) {
      try {
        profilePictureUrl = await this.supabase.getSignedUrl(
          this.PROFILE_PICTURES_BUCKET,
          client.user.profilePicturePath,
          3600, // 1 hour expiry
        );
      } catch (err) {
        this.logger.error('Failed to get profile picture signed URL', err);
      }
    }

    // Collect all documents from all tax cases
    const allDocuments = client.taxCases.flatMap((tc) => tc.documents);

    // Collect all status history from all tax cases
    const allStatusHistory = client.taxCases.flatMap((tc) =>
      tc.statusHistory.map((sh) => ({
        id: sh.id,
        taxCaseId: sh.taxCaseId,
        previousStatus: sh.previousStatus,
        newStatus: sh.newStatus,
        changedById: sh.changedById,
        comment: sh.comment,
        createdAt: sh.createdAt,
        changedBy: sh.changedBy,
      })),
    );

    // Return structure matching frontend AdminClientDetail interface
    return {
      id: client.id,
      user: {
        id: client.user.id,
        email: client.user.email,
        role: client.user.role,
        firstName: client.user.firstName,
        lastName: client.user.lastName,
        phone: client.user.phone,
        profilePictureUrl,
        isActive: client.user.isActive,
        lastLoginAt: client.user.lastLoginAt,
        createdAt: client.user.createdAt,
        updatedAt: client.user.updatedAt,
      },
      profile: {
        id: client.id,
        userId: client.userId,
        ssn: client.ssn ? this.encryption.decrypt(client.ssn) : null,
        dateOfBirth: client.dateOfBirth,
        address: {
          street: client.addressStreet
            ? this.encryption.decrypt(client.addressStreet)
            : null,
          city: client.addressCity,
          state: client.addressState,
          zip: client.addressZip,
        },
        bank: client.taxCases[0]
          ? {
              name: client.taxCases[0].bankName,
              routingNumber: client.taxCases[0].bankRoutingNumber
                ? this.encryption.decrypt(client.taxCases[0].bankRoutingNumber)
                : null,
              accountNumber: client.taxCases[0].bankAccountNumber
                ? this.encryption.decrypt(client.taxCases[0].bankAccountNumber)
                : null,
            }
          : { name: null, routingNumber: null, accountNumber: null },
        workState: client.taxCases[0]?.workState || null,
        employerName: client.taxCases[0]?.employerName || null,
        turbotaxEmail: client.turbotaxEmail
          ? this.encryption.decrypt(client.turbotaxEmail)
          : null,
        turbotaxPassword: client.turbotaxPassword
          ? this.encryption.decrypt(client.turbotaxPassword)
          : null,
        irsUsername: client.irsUsername
          ? this.encryption.decrypt(client.irsUsername)
          : null,
        irsPassword: client.irsPassword
          ? this.encryption.decrypt(client.irsPassword)
          : null,
        stateUsername: client.stateUsername
          ? this.encryption.decrypt(client.stateUsername)
          : null,
        statePassword: client.statePassword
          ? this.encryption.decrypt(client.statePassword)
          : null,
        profileComplete: client.profileComplete,
        isDraft: client.isDraft,
        createdAt: client.createdAt,
        updatedAt: client.updatedAt,
      },
      taxCases: client.taxCases.map((tc) => {
        const alarms = calculateAlarms(
          (tc as any).federalStatusNew,
          (tc as any).federalStatusNewChangedAt,
          (tc as any).stateStatusNew,
          (tc as any).stateStatusNewChangedAt,
        );

        return {
          id: tc.id,
          clientProfileId: tc.clientProfileId,
          taxYear: tc.taxYear,
          caseStatus: (tc as any).caseStatus,
          caseStatusChangedAt: (tc as any).caseStatusChangedAt,
          federalStatusNew: (tc as any).federalStatusNew,
          federalStatusNewChangedAt: (tc as any).federalStatusNewChangedAt,
          stateStatusNew: (tc as any).stateStatusNew,
          stateStatusNewChangedAt: (tc as any).stateStatusNewChangedAt,
          alarms,
          hasAlarm: alarms.length > 0,
          hasCriticalAlarm: alarms.some(a => a.level === 'critical'),
          estimatedRefund: tc.estimatedRefund,
          actualRefund:
            tc.federalActualRefund || tc.stateActualRefund
              ? Number(tc.federalActualRefund || 0) +
                Number(tc.stateActualRefund || 0)
              : null,
          refundDepositDate: tc.federalDepositDate || tc.stateDepositDate || null,
          federalEstimatedDate: tc.federalEstimatedDate,
          stateEstimatedDate: tc.stateEstimatedDate,
          federalActualRefund: tc.federalActualRefund,
          stateActualRefund: tc.stateActualRefund,
          federalDepositDate: tc.federalDepositDate,
          stateDepositDate: tc.stateDepositDate,
          federalLastComment: (tc as any).federalLastComment,
          federalStatusChangedAt: (tc as any).federalStatusChangedAt,
          federalLastReviewedAt: (tc as any).federalLastReviewedAt,
          stateLastComment: (tc as any).stateLastComment,
          stateStatusChangedAt: (tc as any).stateStatusChangedAt,
          stateLastReviewedAt: (tc as any).stateLastReviewedAt,
          federalInternalComment: (tc as any).federalInternalComment,
          stateInternalComment: (tc as any).stateInternalComment,
          paymentReceived: tc.paymentReceived,
          commissionPaid: tc.commissionPaid,
          federalCommissionRate: tc.federalCommissionRate ? Number(tc.federalCommissionRate) : 0.11,
          stateCommissionRate: tc.stateCommissionRate ? Number(tc.stateCommissionRate) : 0.11,
          // Commission proof tracking
          federalCommissionProofSubmitted: (tc as any).federalCommissionProofSubmitted,
          federalCommissionProofSubmittedAt: (tc as any).federalCommissionProofSubmittedAt,
          stateCommissionProofSubmitted: (tc as any).stateCommissionProofSubmitted,
          stateCommissionProofSubmittedAt: (tc as any).stateCommissionProofSubmittedAt,
          // Commission proof review
          federalCommissionProofReviewedBy: (tc as any).federalCommissionProofReviewedBy,
          federalCommissionProofReviewedAt: (tc as any).federalCommissionProofReviewedAt,
          federalCommissionProofReviewNote: (tc as any).federalCommissionProofReviewNote,
          stateCommissionProofReviewedBy: (tc as any).stateCommissionProofReviewedBy,
          stateCommissionProofReviewedAt: (tc as any).stateCommissionProofReviewedAt,
          stateCommissionProofReviewNote: (tc as any).stateCommissionProofReviewNote,
          // Commission payment (per-track)
          federalCommissionPaid: (tc as any).federalCommissionPaid,
          federalCommissionPaidAt: (tc as any).federalCommissionPaidAt,
          stateCommissionPaid: (tc as any).stateCommissionPaid,
          stateCommissionPaidAt: (tc as any).stateCommissionPaidAt,
          // Refund confirmation
          federalRefundReceived: (tc as any).federalRefundReceived,
          federalRefundReceivedAt: (tc as any).federalRefundReceivedAt,
          stateRefundReceived: (tc as any).stateRefundReceived,
          stateRefundReceivedAt: (tc as any).stateRefundReceivedAt,
          statusUpdatedAt: tc.statusUpdatedAt,
          adminStep: tc.adminStep,
          hasProblem: tc.hasProblem,
          problemStep: tc.problemStep,
          problemType: tc.problemType,
          problemDescription: tc.problemDescription,
          problemResolvedAt: tc.problemResolvedAt,
          createdAt: tc.createdAt,
          updatedAt: tc.updatedAt,
        };
      }),
      documents: allDocuments,
      statusHistory: allStatusHistory,
    };
  }

  /**
   * Get all client accounts with MASKED credentials for admin view
   */
  async getAllClientAccounts(options: { cursor?: string; limit: number }) {
    const clients = await this.prisma.clientProfile.findMany({
      take: options.limit + 1,
      cursor: options.cursor ? { id: options.cursor } : undefined,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = clients.length > options.limit;
    const results = hasMore ? clients.slice(0, -1) : clients;

    const MASKED = '••••••••';

    return {
      accounts: results.map((client) => ({
        id: client.id,
        name: `${client.user.firstName || ''} ${client.user.lastName || ''}`.trim(),
        email: client.user.email,
        turbotaxEmail: client.turbotaxEmail
          ? this.encryption.decrypt(client.turbotaxEmail)
          : null,
        turbotaxPassword: client.turbotaxPassword ? MASKED : null,
        irsUsername: client.irsUsername
          ? this.encryption.decrypt(client.irsUsername)
          : null,
        irsPassword: client.irsPassword ? MASKED : null,
        stateUsername: client.stateUsername
          ? this.encryption.decrypt(client.stateUsername)
          : null,
        statePassword: client.statePassword ? MASKED : null,
      })),
      nextCursor: hasMore ? results[results.length - 1]?.id : null,
      hasMore,
    };
  }

  /**
   * Get unmasked credentials for a SINGLE client (SECURITY: with audit logging)
   */
  async getClientCredentials(
    clientId: string,
    adminUserId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id: clientId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }

    // Log credentials access for audit trail
    await this.auditLogsService.log({
      action: AuditAction.CREDENTIALS_ACCESS,
      userId: adminUserId,
      targetUserId: client.userId,
      details: {
        clientId: client.id,
        clientName: `${client.user.firstName || ''} ${client.user.lastName || ''}`.trim(),
        accessedFields: {
          turbotax: !!(client.turbotaxEmail || client.turbotaxPassword),
          irs: !!(client.irsUsername || client.irsPassword),
          state: !!(client.stateUsername || client.statePassword),
        },
      },
      ipAddress,
      userAgent,
    });

    const now = new Date().toISOString();

    // Use safeDecrypt to handle decryption failures gracefully
    const turbotaxEmail = this.encryption.safeDecrypt(client.turbotaxEmail, 'turbotaxEmail');
    const turbotaxPassword = this.encryption.safeDecrypt(client.turbotaxPassword, 'turbotaxPassword');
    const irsUsername = this.encryption.safeDecrypt(client.irsUsername, 'irsUsername');
    const irsPassword = this.encryption.safeDecrypt(client.irsPassword, 'irsPassword');
    const stateUsername = this.encryption.safeDecrypt(client.stateUsername, 'stateUsername');
    const statePassword = this.encryption.safeDecrypt(client.statePassword, 'statePassword');

    return {
      revealedAt: now,
      revealedBy: adminUserId,
      clientId: client.id,
      clientName: `${client.user.firstName || ''} ${client.user.lastName || ''}`.trim(),
      clientEmail: client.user.email,
      credentials: {
        turbotaxEmail,
        turbotaxPassword,
        irsUsername,
        irsPassword,
        stateUsername,
        statePassword,
      },
      errors: {
        turbotaxEmail: client.turbotaxEmail && !turbotaxEmail ? 'Decryption failed' : null,
        turbotaxPassword: client.turbotaxPassword && !turbotaxPassword ? 'Decryption failed' : null,
        irsUsername: client.irsUsername && !irsUsername ? 'Decryption failed' : null,
        irsPassword: client.irsPassword && !irsPassword ? 'Decryption failed' : null,
        stateUsername: client.stateUsername && !stateUsername ? 'Decryption failed' : null,
        statePassword: client.statePassword && !statePassword ? 'Decryption failed' : null,
      },
    };
  }
}
