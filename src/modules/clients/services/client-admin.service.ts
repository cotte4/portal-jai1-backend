import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import { SupabaseService } from '../../../config/supabase.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ReferralsService } from '../../referrals/referrals.service';
import { EmailService } from '../../../common/services';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { SetProblemDto, SendNotificationDto } from '../dto/admin-update.dto';
import { redactEmail } from '../../../common/utils/log-sanitizer';

@Injectable()
export class ClientAdminService {
  private readonly logger = new Logger(ClientAdminService.name);
  private readonly PROFILE_PICTURES_BUCKET = 'profile-pictures';

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private notificationsService: NotificationsService,
    private referralsService: ReferralsService,
    private emailService: EmailService,
    private auditLogsService: AuditLogsService,
  ) {}

  async markPaid(id: string) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: { taxCases: { orderBy: { taxYear: 'desc' }, take: 1 } },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    await this.prisma.taxCase.update({
      where: { id: client.taxCases[0].id },
      data: { paymentReceived: true },
    });

    return { message: 'Payment marked as received' };
  }

  /**
   * Admin marks commission as paid for federal or state refund.
   */
  async markCommissionPaid(clientProfileId: string, type: 'federal' | 'state', adminId: string) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id: clientProfileId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        taxCases: { orderBy: { taxYear: 'desc' }, take: 1 },
      },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    const taxCase = client.taxCases[0];

    // Validate based on type
    if (type === 'federal') {
      if (!taxCase.federalRefundReceived) {
        throw new BadRequestException('Client has not confirmed federal refund receipt');
      }
      if (taxCase.federalCommissionPaid) {
        throw new BadRequestException('Federal commission already marked as paid');
      }
      if (!taxCase.federalActualRefund || Number(taxCase.federalActualRefund) <= 0) {
        throw new BadRequestException('No federal refund amount recorded');
      }
    } else {
      if (!taxCase.stateRefundReceived) {
        throw new BadRequestException('Client has not confirmed state refund receipt');
      }
      if (taxCase.stateCommissionPaid) {
        throw new BadRequestException('State commission already marked as paid');
      }
      if (!taxCase.stateActualRefund || Number(taxCase.stateActualRefund) <= 0) {
        throw new BadRequestException('No state refund amount recorded');
      }
    }

    // Update the commission paid fields
    const now = new Date();
    const updateData =
      type === 'federal'
        ? { federalCommissionPaid: true, federalCommissionPaidAt: now }
        : { stateCommissionPaid: true, stateCommissionPaidAt: now };

    // Also update legacy commissionPaid if both are now paid
    const willBothBePaid =
      (type === 'federal' && taxCase.stateCommissionPaid) ||
      (type === 'state' && taxCase.federalCommissionPaid) ||
      (type === 'federal' && (!taxCase.stateActualRefund || Number(taxCase.stateActualRefund) === 0)) ||
      (type === 'state' && (!taxCase.federalActualRefund || Number(taxCase.federalActualRefund) === 0));

    if (willBothBePaid) {
      Object.assign(updateData, { commissionPaid: true });
    }

    await this.prisma.taxCase.update({
      where: { id: taxCase.id },
      data: updateData,
    });

    const refundAmount =
      type === 'federal'
        ? Number(taxCase.federalActualRefund)
        : Number(taxCase.stateActualRefund);
    const commissionRate =
      type === 'federal'
        ? Number(taxCase.federalCommissionRate || 0.11)
        : Number(taxCase.stateCommissionRate || 0.11);
    const commissionAmount = refundAmount * commissionRate;

    this.logger.log(
      `Admin ${adminId} marked ${type} commission as paid for client ${clientProfileId}. Amount: $${commissionAmount.toFixed(2)}`,
    );

    return {
      message: `${type === 'federal' ? 'Federal' : 'State'} commission marked as paid`,
      refundAmount,
      commissionAmount: Math.round(commissionAmount * 100) / 100,
      paidAt: now.toISOString(),
      clientName: `${client.user.firstName} ${client.user.lastName}`,
    };
  }

  /**
   * Get clients who have confirmed refund receipt but have unpaid commissions.
   */
  async getUnpaidCommissions(params: { cursor?: string; limit: number }) {
    const { cursor, limit } = params;

    const clients = await this.prisma.clientProfile.findMany({
      where: {
        taxCases: {
          some: {
            OR: [
              {
                federalRefundReceived: true,
                federalCommissionPaid: false,
                federalActualRefund: { gt: 0 },
              },
              {
                stateRefundReceived: true,
                stateCommissionPaid: false,
                stateActualRefund: { gt: 0 },
              },
            ],
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        taxCases: {
          orderBy: { taxYear: 'desc' },
          take: 1,
          select: {
            id: true,
            taxYear: true,
            federalActualRefund: true,
            stateActualRefund: true,
            federalRefundReceived: true,
            stateRefundReceived: true,
            federalRefundReceivedAt: true,
            stateRefundReceivedAt: true,
            federalCommissionPaid: true,
            stateCommissionPaid: true,
            federalCommissionPaidAt: true,
            stateCommissionPaidAt: true,
            federalCommissionRate: true,
            stateCommissionRate: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const hasMore = clients.length > limit;
    const clientsToReturn = hasMore ? clients.slice(0, limit) : clients;
    const nextCursor = hasMore ? clientsToReturn[clientsToReturn.length - 1].id : null;

    // Calculate totals
    let totalUnpaidFederal = 0;
    let totalUnpaidState = 0;

    const formattedClients = clientsToReturn.map((client) => {
      const taxCase = client.taxCases[0];
      const federalRefund = Number(taxCase?.federalActualRefund || 0);
      const stateRefund = Number(taxCase?.stateActualRefund || 0);
      const fedRate = Number(taxCase?.federalCommissionRate || 0.11);
      const stateRate = Number(taxCase?.stateCommissionRate || 0.11);
      const federalCommission = federalRefund * fedRate;
      const stateCommission = stateRefund * stateRate;

      const federalUnpaid = taxCase?.federalRefundReceived && !taxCase?.federalCommissionPaid;
      const stateUnpaid = taxCase?.stateRefundReceived && !taxCase?.stateCommissionPaid;

      if (federalUnpaid) totalUnpaidFederal += federalCommission;
      if (stateUnpaid) totalUnpaidState += stateCommission;

      return {
        id: client.id,
        userId: client.user.id,
        name: `${client.user.firstName} ${client.user.lastName}`,
        email: client.user.email,
        phone: client.user.phone,
        taxYear: taxCase?.taxYear,
        federal: {
          refundAmount: federalRefund,
          commission: Math.round(federalCommission * 100) / 100,
          refundReceived: taxCase?.federalRefundReceived || false,
          refundReceivedAt: taxCase?.federalRefundReceivedAt?.toISOString() || null,
          commissionPaid: taxCase?.federalCommissionPaid || false,
          commissionPaidAt: taxCase?.federalCommissionPaidAt?.toISOString() || null,
        },
        state: {
          refundAmount: stateRefund,
          commission: Math.round(stateCommission * 100) / 100,
          refundReceived: taxCase?.stateRefundReceived || false,
          refundReceivedAt: taxCase?.stateRefundReceivedAt?.toISOString() || null,
          commissionPaid: taxCase?.stateCommissionPaid || false,
          commissionPaidAt: taxCase?.stateCommissionPaidAt?.toISOString() || null,
        },
        totalUnpaidCommission: Math.round(
          ((federalUnpaid ? federalCommission : 0) + (stateUnpaid ? stateCommission : 0)) * 100
        ) / 100,
      };
    });

    return {
      clients: formattedClients,
      nextCursor,
      hasMore,
      totals: {
        unpaidFederalCommission: Math.round(totalUnpaidFederal * 100) / 100,
        unpaidStateCommission: Math.round(totalUnpaidState * 100) / 100,
        totalUnpaidCommission: Math.round((totalUnpaidFederal + totalUnpaidState) * 100) / 100,
        clientCount: formattedClients.length,
      },
    };
  }

  async updateAdminStep(id: string, step: number, changedById: string) {
    if (step < 1 || step > 5) {
      throw new BadRequestException('Step must be between 1 and 5');
    }

    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, referralCode: true },
        },
        taxCases: { orderBy: { taxYear: 'desc' }, take: 1 },
      },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    const taxCase = client.taxCases[0];

    await this.prisma.$transaction([
      this.prisma.taxCase.update({
        where: { id: taxCase.id },
        data: { adminStep: step },
      }),
      this.prisma.statusHistory.create({
        data: {
          taxCaseId: taxCase.id,
          previousStatus: `step:${taxCase.adminStep || 1}`,
          newStatus: `step:${step}`,
          changedById,
          comment: `Admin step changed to ${step}`,
        },
      }),
    ]);

    // Generate referral code when step >= 3
    if (step >= 3 && !client.user.referralCode) {
      try {
        const code = await this.referralsService.generateCode(client.user.id);
        this.logger.log(
          `Generated referral code ${code} for user ${client.user.id}`,
        );
      } catch (err) {
        this.logger.error('Failed to generate referral code', err);
      }
    }

    return { message: 'Admin step updated successfully', step };
  }

  async setProblem(id: string, problemData: SetProblemDto) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, firstName: true } },
        taxCases: { orderBy: { taxYear: 'desc' }, take: 1 },
      },
    });

    if (!client || !client.taxCases[0]) {
      throw new NotFoundException('Client or tax case not found');
    }

    const taxCase = client.taxCases[0];
    const wasAlreadyProblem = taxCase.hasProblem;

    const updateData: any = {
      hasProblem: problemData.hasProblem,
    };

    if (problemData.hasProblem) {
      updateData.problemStep = taxCase.adminStep || 1;
      updateData.problemType = problemData.problemType || null;
      updateData.problemDescription = problemData.problemDescription || null;
      updateData.problemResolvedAt = null;
    } else {
      updateData.problemResolvedAt = new Date();
      updateData.problemStep = null;
      updateData.problemType = null;
      updateData.problemDescription = null;
    }

    await this.prisma.taxCase.update({
      where: { id: taxCase.id },
      data: updateData,
    });

    // Auto-notify client when problem is marked
    if (problemData.hasProblem && !wasAlreadyProblem) {
      await this.notificationsService.createFromTemplate(
        client.user.id,
        'problem_alert',
        'notifications.problem_set',
        {
          firstName: client.user.firstName,
          description: problemData.problemDescription || 'Hay un inconveniente con tu trámite',
        },
      );
      this.logger.log(`Problem notification sent to user ${client.user.id}`);
    }

    // Notify when problem is resolved
    if (!problemData.hasProblem && wasAlreadyProblem) {
      await this.notificationsService.createFromTemplate(
        client.user.id,
        'status_change',
        'notifications.problem_resolved',
        {
          firstName: client.user.firstName,
        },
      );
      this.logger.log(
        `Problem resolved notification sent to user ${client.user.id}`,
      );
    }

    return {
      message: problemData.hasProblem
        ? 'Problem marked on case'
        : 'Problem resolved',
      hasProblem: problemData.hasProblem,
    };
  }

  async sendClientNotification(id: string, notifyData: SendNotificationDto) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    // Rate limiting: max 5 admin notifications per client per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentNotifications = await this.prisma.notification.count({
      where: {
        userId: client.user.id,
        type: { in: ['system', 'status_change', 'problem_alert'] },
        createdAt: { gte: oneHourAgo },
      },
    });

    const RATE_LIMIT = 5;
    if (recentNotifications >= RATE_LIMIT) {
      throw new BadRequestException(
        `Rate limit exceeded: maximum ${RATE_LIMIT} notifications per client per hour. Please wait before sending another notification.`,
      );
    }

    // Create in-app notification
    await this.notificationsService.createFromTemplate(
      client.user.id,
      'system',
      'notifications.admin_custom_message',
      {
        firstName: client.user.firstName,
        title: notifyData.title,
        message: notifyData.message,
      },
    );

    // Send email if requested
    let emailSent = false;
    if (notifyData.sendEmail) {
      try {
        emailSent = await this.emailService.sendNotificationEmail(
          client.user.email,
          client.user.firstName || 'Cliente',
          notifyData.title,
          notifyData.message,
        );
        if (emailSent) {
          this.logger.log(`Notification email sent to ${redactEmail(client.user.email)}`);
        } else {
          this.logger.warn(
            `Email not sent to ${redactEmail(client.user.email)} (service not configured or failed)`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Failed to send notification email to ${redactEmail(client.user.email)}`,
          err,
        );
      }
    }

    return {
      message: 'Notification sent successfully',
      emailSent,
    };
  }

  async remove(id: string) {
    // Fetch all documents and user profile picture BEFORE cascade delete
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: { profilePicturePath: true },
        },
        taxCases: {
          include: {
            documents: {
              select: { storagePath: true },
            },
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    // Collect all document storage paths
    const storagePaths: string[] = [];
    for (const taxCase of client.taxCases) {
      for (const doc of taxCase.documents) {
        if (doc.storagePath) {
          storagePaths.push(doc.storagePath);
        }
      }
    }

    // Delete document S3 files first
    const DOCUMENTS_BUCKET = 'documents';
    for (const storagePath of storagePaths) {
      try {
        await this.supabase.deleteFile(DOCUMENTS_BUCKET, storagePath);
        this.logger.log(`Deleted S3 document file: ${storagePath}`);
      } catch (err) {
        this.logger.error(`Failed to delete S3 document file ${storagePath}: ${err}`);
      }
    }

    // Delete profile picture from S3 if it exists
    let profilePictureDeleted = false;
    if (client.user?.profilePicturePath) {
      try {
        await this.supabase.deleteFile(
          this.PROFILE_PICTURES_BUCKET,
          client.user.profilePicturePath,
        );
        this.logger.log(`Deleted S3 profile picture: ${client.user.profilePicturePath}`);
        profilePictureDeleted = true;
      } catch (err) {
        this.logger.error(
          `Failed to delete S3 profile picture ${client.user.profilePicturePath}: ${err}`,
        );
      }
    }

    // Now delete the client (cascade will handle database records)
    await this.prisma.clientProfile.delete({
      where: { id },
    });

    this.logger.log(
      `Client ${id} deleted successfully. Cleaned up ${storagePaths.length} document files${profilePictureDeleted ? ' and 1 profile picture' : ''}.`,
    );
    return { message: 'Client deleted successfully' };
  }
}
