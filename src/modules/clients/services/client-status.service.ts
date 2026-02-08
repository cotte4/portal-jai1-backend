import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../../config/prisma.service';
import { EncryptionService } from '../../../common/services';
import { NotificationsService } from '../../notifications/notifications.service';
import { ReferralsService } from '../../referrals/referrals.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { UpdateStatusDto } from '../dto/admin-update.dto';
import {
  isValidTransition,
  getValidNextStatuses,
  createInvalidTransitionError,
} from '../../../common/utils/status-transitions.util';
import { formatUSDAmount } from '../../../common/utils/currency-format.util';

@Injectable()
export class ClientStatusService {
  private readonly logger = new Logger(ClientStatusService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private notificationsService: NotificationsService,
    private referralsService: ReferralsService,
    private auditLogsService: AuditLogsService,
  ) {}

  async update(id: string, data: any) {
    // Separate ClientProfile data from TaxCase data (bank/employer)
    const profileData = { ...data };
    const taxCaseData: any = {};

    // Remove bank/employer fields from profile data (they go to TaxCase)
    delete profileData.bankName;
    delete profileData.bankRoutingNumber;
    delete profileData.bankAccountNumber;
    delete profileData.workState;
    delete profileData.employerName;

    // Encrypt profile sensitive fields
    if (data.ssn) {
      profileData.ssn = this.encryption.encrypt(data.ssn);
    }
    if (data.addressStreet) {
      profileData.addressStreet = this.encryption.encrypt(data.addressStreet);
    }
    if (data.turbotaxEmail) {
      profileData.turbotaxEmail = this.encryption.encrypt(data.turbotaxEmail);
    }
    if (data.turbotaxPassword) {
      profileData.turbotaxPassword = this.encryption.encrypt(
        data.turbotaxPassword,
      );
    }
    // IRS credentials (encrypted)
    if (data.irsUsername) {
      profileData.irsUsername = this.encryption.encrypt(data.irsUsername);
    }
    if (data.irsPassword) {
      profileData.irsPassword = this.encryption.encrypt(data.irsPassword);
    }
    // State credentials (encrypted)
    if (data.stateUsername) {
      profileData.stateUsername = this.encryption.encrypt(data.stateUsername);
    }
    if (data.statePassword) {
      profileData.statePassword = this.encryption.encrypt(data.statePassword);
    }

    // Prepare TaxCase bank/employer data
    if (data.bankName !== undefined) taxCaseData.bankName = data.bankName;
    if (data.bankRoutingNumber) {
      taxCaseData.bankRoutingNumber = this.encryption.encrypt(
        data.bankRoutingNumber,
      );
    }
    if (data.bankAccountNumber) {
      taxCaseData.bankAccountNumber = this.encryption.encrypt(
        data.bankAccountNumber,
      );
    }
    if (data.workState !== undefined) taxCaseData.workState = data.workState;
    if (data.employerName !== undefined)
      taxCaseData.employerName = data.employerName;

    // Update in transaction if we have both profile and taxCase updates
    const hasTaxCaseUpdates = Object.keys(taxCaseData).length > 0;

    if (hasTaxCaseUpdates) {
      return this.prisma.$transaction(async (tx) => {
        const profile = await tx.clientProfile.update({
          where: { id },
          data: profileData,
        });

        // Get or create TaxCase for this profile
        let taxCase = await tx.taxCase.findFirst({
          where: { clientProfileId: id },
          orderBy: { taxYear: 'desc' },
        });

        if (!taxCase) {
          taxCase = await tx.taxCase.create({
            data: {
              clientProfileId: id,
              taxYear: new Date().getFullYear(),
              ...taxCaseData,
            },
          });
        } else {
          taxCase = await tx.taxCase.update({
            where: { id: taxCase.id },
            data: taxCaseData,
          });
        }

        return { ...profile, taxCase };
      });
    }

    return this.prisma.clientProfile.update({
      where: { id },
      data: profileData,
    });
  }

  async updateStatus(
    id: string,
    statusData: UpdateStatusDto,
    changedById: string,
  ) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            referralCode: true,
          },
        },
        taxCases: { orderBy: { taxYear: 'desc' }, take: 1 },
      },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    const taxCase = client.taxCases[0];

    this.logger.log(`[updateStatus] Received status update for client ${id}:`, {
      federalStatusNew: statusData.federalStatusNew,
      stateStatusNew: statusData.stateStatusNew,
      caseStatus: statusData.caseStatus,
      currentTaxCaseStatuses: {
        federalStatusNew: (taxCase as any).federalStatusNew,
        stateStatusNew: (taxCase as any).stateStatusNew,
        caseStatus: (taxCase as any).caseStatus,
      },
    });

    // Capture previous status BEFORE the update (for audit trail)
    const previousCaseStatus = (taxCase as any).caseStatus;
    const previousFederalStatusNew = (taxCase as any).federalStatusNew;
    const previousStateStatusNew = (taxCase as any).stateStatusNew;

    // Build previous status string for StatusHistory
    const previousStatusParts: string[] = [];
    if (previousCaseStatus) {
      previousStatusParts.push(`caseStatus: ${previousCaseStatus}`);
    }
    if (previousFederalStatusNew) {
      previousStatusParts.push(`federalStatus: ${previousFederalStatusNew}`);
    }
    if (previousStateStatusNew) {
      previousStatusParts.push(`stateStatus: ${previousStateStatusNew}`);
    }
    const previousStatusString = previousStatusParts.join(', ') || null;

    // Build update data dynamically
    const updateData: any = {
      statusUpdatedAt: new Date(),
    };

    const now = new Date();

    // Handle federal/state comments
    if (statusData.federalComment) {
      updateData.federalLastComment = statusData.federalComment;
    }
    if (statusData.stateComment) {
      updateData.stateLastComment = statusData.stateComment;
    }

    // Handle internal comments
    if (statusData.federalInternalComment !== undefined) {
      updateData.federalInternalComment = statusData.federalInternalComment;
    }
    if (statusData.stateInternalComment !== undefined) {
      updateData.stateInternalComment = statusData.stateInternalComment;
    }

    // Handle federal-specific fields
    if (statusData.federalEstimatedDate) {
      updateData.federalEstimatedDate = new Date(
        statusData.federalEstimatedDate,
      );
    }
    if (statusData.federalActualRefund !== undefined) {
      updateData.federalActualRefund = statusData.federalActualRefund;
    }
    if (statusData.federalDepositDate) {
      updateData.federalDepositDate = new Date(statusData.federalDepositDate);
    }

    // Handle state-specific fields
    if (statusData.stateEstimatedDate) {
      updateData.stateEstimatedDate = new Date(statusData.stateEstimatedDate);
    }
    if (statusData.stateActualRefund !== undefined) {
      updateData.stateActualRefund = statusData.stateActualRefund;
    }
    if (statusData.stateDepositDate) {
      updateData.stateDepositDate = new Date(statusData.stateDepositDate);
    }

    // ============= STATUS TRANSITION VALIDATION =============
    const isForceOverride = statusData.forceTransition === true && statusData.overrideReason;

    // Validate caseStatus transition
    if (statusData.caseStatus && statusData.caseStatus !== previousCaseStatus) {
      if (!isValidTransition('case', previousCaseStatus, statusData.caseStatus)) {
        if (!isForceOverride) {
          const error = createInvalidTransitionError('case', previousCaseStatus, statusData.caseStatus);
          throw new BadRequestException(error);
        }
      }
    }

    // Validate federalStatusNew transition
    if (statusData.federalStatusNew && statusData.federalStatusNew !== previousFederalStatusNew) {
      if (!isValidTransition('federal', previousFederalStatusNew, statusData.federalStatusNew)) {
        if (!isForceOverride) {
          const error = createInvalidTransitionError('federal', previousFederalStatusNew, statusData.federalStatusNew);
          throw new BadRequestException(error);
        }
      }
    }

    // Validate stateStatusNew transition
    if (statusData.stateStatusNew && statusData.stateStatusNew !== previousStateStatusNew) {
      if (!isValidTransition('state', previousStateStatusNew, statusData.stateStatusNew)) {
        if (!isForceOverride) {
          const error = createInvalidTransitionError('state', previousStateStatusNew, statusData.stateStatusNew);
          throw new BadRequestException(error);
        }
      }
    }

    // ============= STATUS UPDATES =============
    if (statusData.caseStatus) {
      updateData.caseStatus = statusData.caseStatus;
      if (statusData.caseStatus !== previousCaseStatus) {
        updateData.caseStatusChangedAt = now;
      }
      if (statusData.caseStatus === 'taxes_filed' && !(taxCase as any).taxesFiled) {
        updateData.taxesFiled = true;
        updateData.taxesFiledAt = now;

        if (!taxCase.federalEstimatedDate) {
          const federalEstDate = new Date(now);
          federalEstDate.setDate(federalEstDate.getDate() + 42);
          updateData.federalEstimatedDate = federalEstDate;
          this.logger.log(`Auto-calculated federalEstimatedDate: ${federalEstDate.toISOString()}`);
        }
        if (!taxCase.stateEstimatedDate) {
          const stateEstDate = new Date(now);
          stateEstDate.setDate(stateEstDate.getDate() + 63);
          updateData.stateEstimatedDate = stateEstDate;
          this.logger.log(`Auto-calculated stateEstimatedDate: ${stateEstDate.toISOString()}`);
        }
      }
    }

    // Update federalStatusNew field
    if (statusData.federalStatusNew) {
      updateData.federalStatusNew = statusData.federalStatusNew;
      if (statusData.federalStatusNew !== previousFederalStatusNew) {
        updateData.federalStatusNewChangedAt = now;
      }
    }

    // Update commission rates if provided
    if (statusData.federalCommissionRate !== undefined) {
      updateData.federalCommissionRate = statusData.federalCommissionRate;
    }
    if (statusData.stateCommissionRate !== undefined) {
      updateData.stateCommissionRate = statusData.stateCommissionRate;
    }

    // Update stateStatusNew field
    if (statusData.stateStatusNew) {
      updateData.stateStatusNew = statusData.stateStatusNew;
      if (statusData.stateStatusNew !== previousStateStatusNew) {
        updateData.stateStatusNewChangedAt = now;
      }
    }

    // Check if this is the first deposit date being set (referral completion trigger)
    const isFirstDepositDate =
      !taxCase.federalDepositDate &&
      !taxCase.stateDepositDate &&
      (statusData.federalDepositDate || statusData.stateDepositDate);

    // Build status change description for history
    const statusChanges: string[] = [];
    if (updateData.caseStatus) {
      statusChanges.push(`caseStatus: ${updateData.caseStatus}`);
    }
    if (statusData.federalStatusNew) {
      statusChanges.push(`federalStatus: ${statusData.federalStatusNew}`);
    }
    if (statusData.stateStatusNew) {
      statusChanges.push(`stateStatus: ${statusData.stateStatusNew}`);
    }

    // Build the history comment (include track-specific comments)
    const commentParts: string[] = [];
    if (statusData.comment) commentParts.push(statusData.comment);
    if (statusData.federalComment) commentParts.push(`Federal: ${statusData.federalComment}`);
    if (statusData.stateComment) commentParts.push(`Estatal: ${statusData.stateComment}`);
    let historyComment = commentParts.join(' | ');
    if (isForceOverride) {
      const overridePrefix = `[ADMIN OVERRIDE] Razon: ${statusData.overrideReason}`;
      historyComment = historyComment
        ? `${overridePrefix} | ${historyComment}`
        : overridePrefix;
    }

    // AUTO-RESOLVE PROBLEMS when status progresses to positive states
    const positiveProgressStatuses = [
      'deposito_directo',
      'cheque_en_camino',
      'comision_pendiente',
      'taxes_completados',
    ];

    const federalProgressed =
      statusData.federalStatusNew &&
      positiveProgressStatuses.includes(statusData.federalStatusNew);
    const stateProgressed =
      statusData.stateStatusNew &&
      positiveProgressStatuses.includes(statusData.stateStatusNew);

    if (taxCase.hasProblem && (federalProgressed || stateProgressed)) {
      this.logger.log(
        `Auto-resolving problem for taxCase ${taxCase.id} due to positive status progression`,
      );
      updateData.hasProblem = false;
      updateData.problemResolvedAt = now;
      updateData.problemType = null;
      updateData.problemDescription = null;
      updateData.problemStep = null;

      try {
        await this.notificationsService.createFromTemplate(
          client.user.id,
          'status_change',
          'notifications.problem_resolved',
          {
            firstName: client.user.firstName || 'Cliente',
          },
        );
      } catch (err) {
        this.logger.error('Failed to send problem resolved notification', err);
      }
    }

    this.logger.log(`[updateStatus] Final updateData for taxCase ${taxCase.id}:`, {
      federalStatusNew: updateData.federalStatusNew,
      stateStatusNew: updateData.stateStatusNew,
      caseStatus: updateData.caseStatus,
      federalStatusNewChangedAt: updateData.federalStatusNewChangedAt,
      stateStatusNewChangedAt: updateData.stateStatusNewChangedAt,
      caseStatusChangedAt: updateData.caseStatusChangedAt,
      statusUpdatedAt: updateData.statusUpdatedAt,
      historyComment,
      statusChanges: statusChanges.join(', '),
    });

    await this.prisma.$transaction([
      this.prisma.taxCase.update({
        where: { id: taxCase.id },
        data: updateData,
      }),
      this.prisma.statusHistory.create({
        data: {
          taxCaseId: taxCase.id,
          previousStatus: previousStatusString,
          newStatus: statusChanges.join(', ') || 'status update',
          changedById,
          comment: historyComment || null,
        },
      }),
    ]);

    this.logger.log(`[updateStatus] Successfully updated taxCase ${taxCase.id} in database`);

    // Notify for federal status change
    if (statusData.federalStatusNew && statusData.federalStatusNew !== previousFederalStatusNew) {
      await this.notifyFederalStatusChangeV2(
        client.user.id,
        client.user.email,
        client.user.firstName,
        statusData.federalStatusNew,
        statusData.federalActualRefund,
      );
    }

    // Notify for state status change
    if (statusData.stateStatusNew && statusData.stateStatusNew !== previousStateStatusNew) {
      await this.notifyStateStatusChangeV2(
        client.user.id,
        client.user.email,
        client.user.firstName,
        statusData.stateStatusNew,
        statusData.stateActualRefund,
      );
    }

    // Mark referral as successful when first deposit date is set
    if (isFirstDepositDate) {
      try {
        await this.referralsService.markReferralSuccessful(
          client.user.id,
          taxCase.id,
        );
        this.logger.log(
          `Marked referral as successful for user ${client.user.id}`,
        );
      } catch (err) {
        this.logger.error('Failed to mark referral as successful', err);
      }
    }

    // Generate referral code when caseStatus changes to taxes_filed
    const isNewlyFiled =
      statusData.caseStatus === 'taxes_filed' && previousCaseStatus !== 'taxes_filed';
    if (isNewlyFiled && !client.user.referralCode) {
      try {
        const code = await this.referralsService.generateCode(client.user.id);
        this.logger.log(
          `Generated referral code ${code} for user ${client.user.id} (taxes marked as filed)`,
        );
      } catch (err) {
        this.logger.error('Failed to generate referral code', err);
      }
    }

    // Mark referral as successful when federal or state status becomes taxes_completados
    const isFederalCompleted =
      statusData.federalStatusNew === 'taxes_completados' &&
      previousFederalStatusNew !== 'taxes_completados';
    const isStateCompleted =
      statusData.stateStatusNew === 'taxes_completados' &&
      previousStateStatusNew !== 'taxes_completados';

    if (isFederalCompleted || isStateCompleted) {
      try {
        await this.referralsService.markReferralSuccessful(
          client.user.id,
          taxCase.id,
        );
        this.logger.log(
          `Marked referral as successful for user ${client.user.id} (taxes_completados)`,
        );
      } catch (err) {
        this.logger.error('Failed to mark referral as successful on taxes_completados', err);
      }
    }

    // Audit log - refund updates
    if (
      statusData.federalActualRefund !== undefined ||
      statusData.stateActualRefund !== undefined
    ) {
      this.auditLogsService.log({
        action: AuditAction.REFUND_UPDATE,
        userId: changedById,
        targetUserId: client.user.id,
        details: {
          taxCaseId: taxCase.id,
          taxYear: taxCase.taxYear,
          federalActualRefund: statusData.federalActualRefund,
          stateActualRefund: statusData.stateActualRefund,
          previousFederalRefund: taxCase.federalActualRefund,
          previousStateRefund: taxCase.stateActualRefund,
        },
      });
    }

    return { message: 'Status updated successfully' };
  }

  /**
   * Notify client about federal status change using v2 status values
   */
  private async notifyFederalStatusChangeV2(
    userId: string,
    email: string,
    firstName: string,
    status: string,
    refundAmount?: number,
  ) {
    const templateMap: Record<string, string> = {
      taxes_en_proceso: 'notifications.status_federal_processing',
      deposito_directo: 'notifications.status_federal_approved',
      cheque_en_camino: 'notifications.status_federal_approved',
      problemas: 'notifications.status_federal_rejected',
      comision_pendiente: 'notifications.status_federal_approved',
      taxes_completados: 'notifications.status_federal_deposited',
    };

    const templateKey = templateMap[status];
    if (templateKey) {
      const variables: Record<string, string | number> = { firstName };

      if (status === 'taxes_completados' && refundAmount) {
        variables.amount = formatUSDAmount(refundAmount);
      }

      if (status === 'deposito_directo' || status === 'cheque_en_camino' || status === 'comision_pendiente') {
        variables.estimatedDate = 'próximamente';
      }

      await this.notificationsService.createFromTemplate(
        userId,
        'status_change',
        templateKey,
        variables,
      );
    }
  }

  /**
   * Notify client about state status change using v2 status values
   */
  private async notifyStateStatusChangeV2(
    userId: string,
    email: string,
    firstName: string,
    status: string,
    refundAmount?: number,
  ) {
    const templateMap: Record<string, string> = {
      taxes_en_proceso: 'notifications.status_state_processing',
      deposito_directo: 'notifications.status_state_approved',
      cheque_en_camino: 'notifications.status_state_approved',
      problemas: 'notifications.status_state_rejected',
      comision_pendiente: 'notifications.status_state_approved',
      taxes_completados: 'notifications.status_state_deposited',
    };

    const templateKey = templateMap[status];
    if (templateKey) {
      const variables: Record<string, string | number> = { firstName };

      if (status === 'taxes_completados' && refundAmount) {
        variables.amount = formatUSDAmount(refundAmount);
      }

      if (status === 'deposito_directo' || status === 'cheque_en_camino' || status === 'comision_pendiente') {
        variables.estimatedDate = 'próximamente';
      }

      await this.notificationsService.createFromTemplate(
        userId,
        'status_change',
        templateKey,
        variables,
      );
    }
  }

  /**
   * Get valid status transitions for a client's tax case
   */
  async getValidTransitions(clientId: string) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id: clientId },
      include: {
        taxCases: {
          orderBy: { taxYear: 'desc' },
          take: 1,
          select: {
            id: true,
            caseStatus: true,
            federalStatusNew: true,
            stateStatusNew: true,
          },
        },
      },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    const taxCase = client.taxCases[0];

    return {
      taxCaseId: taxCase.id,
      caseStatus: {
        current: taxCase.caseStatus,
        validTransitions: getValidNextStatuses('case', taxCase.caseStatus),
      },
      federalStatusNew: {
        current: taxCase.federalStatusNew,
        validTransitions: getValidNextStatuses('federal', taxCase.federalStatusNew),
      },
      stateStatusNew: {
        current: taxCase.stateStatusNew,
        validTransitions: getValidNextStatuses('state', taxCase.stateStatusNew),
      },
    };
  }

  /**
   * Client confirms receipt of federal or state refund.
   */
  async confirmRefundReceived(userId: string, type: 'federal' | 'state') {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        clientProfile: {
          include: {
            taxCases: { orderBy: { taxYear: 'desc' }, take: 1 },
          },
        },
      },
    });

    if (!user?.clientProfile) {
      throw new NotFoundException('Client profile not found');
    }

    const taxCase = user.clientProfile.taxCases[0];
    if (!taxCase) {
      throw new NotFoundException('No tax case found');
    }

    // Validate based on type
    if (type === 'federal') {
      if (taxCase.federalRefundReceived) {
        throw new BadRequestException('Federal refund already confirmed');
      }
      const federalApprovedStatuses = ['deposito_directo', 'cheque_en_camino', 'comision_pendiente', 'taxes_completados'];
      if (!taxCase.federalStatusNew || !federalApprovedStatuses.includes(taxCase.federalStatusNew)) {
        throw new BadRequestException('Federal refund has not been sent yet');
      }
      if (!taxCase.federalActualRefund || Number(taxCase.federalActualRefund) <= 0) {
        throw new BadRequestException('No federal refund amount recorded');
      }
    } else {
      if (taxCase.stateRefundReceived) {
        throw new BadRequestException('State refund already confirmed');
      }
      const stateApprovedStatuses = ['deposito_directo', 'cheque_en_camino', 'comision_pendiente', 'taxes_completados'];
      if (!taxCase.stateStatusNew || !stateApprovedStatuses.includes(taxCase.stateStatusNew)) {
        throw new BadRequestException('State refund has not been sent yet');
      }
      if (!taxCase.stateActualRefund || Number(taxCase.stateActualRefund) <= 0) {
        throw new BadRequestException('No state refund amount recorded');
      }
    }

    // Update the confirmation fields AND auto-transition status to comision_pendiente
    const now = new Date();
    const updateData: any = {
      statusUpdatedAt: now,
    };

    if (type === 'federal') {
      updateData.federalRefundReceived = true;
      updateData.federalRefundReceivedAt = now;
      // Auto-transition to comision_pendiente
      if (taxCase.federalStatusNew !== 'comision_pendiente') {
        updateData.federalStatusNew = 'comision_pendiente';
        updateData.federalStatusNewChangedAt = now;
      }
    } else {
      updateData.stateRefundReceived = true;
      updateData.stateRefundReceivedAt = now;
      // Auto-transition to comision_pendiente
      if (taxCase.stateStatusNew !== 'comision_pendiente') {
        updateData.stateStatusNew = 'comision_pendiente';
        updateData.stateStatusNewChangedAt = now;
      }
    }

    await this.prisma.taxCase.update({
      where: { id: taxCase.id },
      data: updateData,
    });

    // Log status change to history if status was changed
    const statusChanged = type === 'federal'
      ? taxCase.federalStatusNew !== 'comision_pendiente'
      : taxCase.stateStatusNew !== 'comision_pendiente';

    if (statusChanged) {
      await this.prisma.statusHistory.create({
        data: {
          taxCaseId: taxCase.id,
          previousStatus: type === 'federal' ? taxCase.federalStatusNew : taxCase.stateStatusNew,
          newStatus: 'comision_pendiente',
          changedById: 'system',
          comment: `Cliente confirmó recepción de reembolso ${type}`,
        },
      });
    }

    // Apply referral discount if this is the FIRST branch confirmed
    const otherBranchConfirmed = type === 'federal'
      ? taxCase.stateRefundReceived
      : taxCase.federalRefundReceived;

    if (!otherBranchConfirmed) {
      await this.prisma.discountApplication.updateMany({
        where: {
          taxCaseId: taxCase.id,
          discountType: 'referral_bonus',
          status: 'pending',
        },
        data: { status: 'applied' },
      });
    }

    // Calculate fee information
    const refundAmount =
      type === 'federal'
        ? Number(taxCase.federalActualRefund)
        : Number(taxCase.stateActualRefund);
    const commissionRate =
      type === 'federal'
        ? Number(taxCase.federalCommissionRate || 0.11)
        : Number(taxCase.stateCommissionRate || 0.11);
    const fee = refundAmount * commissionRate;

    this.logger.log(
      `Client ${userId} confirmed ${type} refund receipt. Amount: $${refundAmount}, Fee: $${fee.toFixed(2)}`,
    );

    return {
      message: `${type === 'federal' ? 'Federal' : 'State'} refund receipt confirmed`,
      refundAmount,
      fee: Math.round(fee * 100) / 100,
      confirmedAt: now.toISOString(),
    };
  }
}
