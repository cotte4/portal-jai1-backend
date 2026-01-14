import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../../common/services';
import { ConfigService } from '@nestjs/config';
import { ClientStatus } from '@prisma/client';

export type ProgressEventType =
  | 'PROFILE_COMPLETED'
  | 'W2_UPLOADED'
  | 'PAYMENT_PROOF_UPLOADED'
  | 'ALL_DOCS_COMPLETE'
  | 'DOCUMENT_UPLOADED';

export interface ProgressEvent {
  type: ProgressEventType;
  userId: string;
  taxCaseId: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class ProgressAutomationService {
  private readonly logger = new Logger(ProgressAutomationService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private emailService: EmailService,
    private configService: ConfigService,
  ) {}

  /**
   * Process a progress event and trigger appropriate automations
   */
  async processEvent(event: ProgressEvent): Promise<void> {
    this.logger.log(`=== PROGRESS AUTOMATION: Processing event ${event.type} ===`);
    this.logger.log(`User: ${event.userId}, TaxCase: ${event.taxCaseId}`);
    this.logger.log(`Metadata: ${JSON.stringify(event.metadata)}`);

    try {
      switch (event.type) {
        case 'PROFILE_COMPLETED':
          await this.handleProfileCompleted(event);
          break;
        case 'W2_UPLOADED':
          await this.handleW2Uploaded(event);
          break;
        case 'PAYMENT_PROOF_UPLOADED':
          await this.handlePaymentProofUploaded(event);
          break;
        case 'ALL_DOCS_COMPLETE':
          await this.handleAllDocsComplete(event);
          break;
        case 'DOCUMENT_UPLOADED':
          await this.handleDocumentUploaded(event);
          break;
      }
    } catch (error) {
      this.logger.error(`Error processing event ${event.type}:`, error);
      // Don't throw - we don't want to break the main flow
    }
  }

  /**
   * Handle profile completion - update status and notify admins
   */
  private async handleProfileCompleted(event: ProgressEvent): Promise<void> {
    this.logger.log('Handling PROFILE_COMPLETED event');

    // Get current tax case status
    const taxCase = await this.prisma.taxCase.findUnique({
      where: { id: event.taxCaseId },
    });

    // Only update if still in esperando_datos status
    if (taxCase && taxCase.clientStatus === 'esperando_datos') {
      await this.updateTaxCaseStatus(event.taxCaseId, 'cuenta_en_revision');
      this.logger.log(`Updated clientStatus to cuenta_en_revision for TaxCase ${event.taxCaseId}`);
    }

    // Notify all admins
    await this.notifyAdmins(
      'Perfil Completado',
      `El cliente ${event.metadata?.clientName || 'Unknown'} ha completado su perfil y está listo para revisión.`,
    );
  }

  /**
   * Handle W2 document upload - notify admins and check if ready to advance
   */
  private async handleW2Uploaded(event: ProgressEvent): Promise<void> {
    this.logger.log('Handling W2_UPLOADED event');

    // Notify admins about W2 upload
    await this.notifyAdmins(
      'Documento W2 Subido',
      `El cliente ${event.metadata?.clientName || 'Unknown'} ha subido su documento W2: ${event.metadata?.fileName || 'Unknown'}`,
    );

    // Check if all requirements are met to advance status
    await this.checkAndAdvanceStatus(event.taxCaseId, event.userId);
  }

  /**
   * Handle payment proof upload - set flag and notify admins
   */
  private async handlePaymentProofUploaded(event: ProgressEvent): Promise<void> {
    this.logger.log('Handling PAYMENT_PROOF_UPLOADED event');

    // Set paymentReceived = true
    await this.prisma.taxCase.update({
      where: { id: event.taxCaseId },
      data: { paymentReceived: true },
    });
    this.logger.log(`Set paymentReceived = true for TaxCase ${event.taxCaseId}`);

    // Notify admins
    await this.notifyAdmins(
      'Comprobante de Pago Recibido',
      `El cliente ${event.metadata?.clientName || 'Unknown'} ha subido comprobante de pago.`,
    );
  }

  /**
   * Handle all docs complete - notify admins that client is ready for review
   * NOTE: adminStep auto-advance removed - admin should manually update internalStatus
   */
  private async handleAllDocsComplete(event: ProgressEvent): Promise<void> {
    this.logger.log('Handling ALL_DOCS_COMPLETE event');

    // Notify admins that client is ready for review
    await this.notifyAdmins(
      'Documentación Completa',
      `El cliente ${event.metadata?.clientName || 'Unknown'} ha completado toda la documentación requerida. Listo para revisión.`,
    );
  }

  /**
   * Handle generic document upload - just notify admins
   */
  private async handleDocumentUploaded(event: ProgressEvent): Promise<void> {
    this.logger.log('Handling DOCUMENT_UPLOADED event');

    await this.notifyAdmins(
      'Nuevo Documento Subido',
      `El cliente ${event.metadata?.clientName || 'Unknown'} ha subido un documento: ${event.metadata?.fileName || 'Unknown'} (${event.metadata?.documentType || 'other'})`,
    );
  }

  /**
   * Update tax case client status
   */
  private async updateTaxCaseStatus(
    taxCaseId: string,
    clientStatus: ClientStatus,
  ): Promise<void> {
    await this.prisma.taxCase.update({
      where: { id: taxCaseId },
      data: {
        clientStatus,
        statusUpdatedAt: new Date(),
      },
    });
  }

  /**
   * Notify all admin users via in-app notifications and email
   */
  private async notifyAdmins(title: string, message: string): Promise<void> {
    try {
      // Get all admin users
      const admins = await this.prisma.user.findMany({
        where: { role: 'admin' },
        select: { id: true, email: true, firstName: true },
      });

      this.logger.log(`Notifying ${admins.length} admin(s)`);

      // Create in-app notifications for all admins
      for (const admin of admins) {
        try {
          await this.notificationsService.create(
            admin.id,
            'system',
            title,
            message,
          );
          this.logger.log(`Created in-app notification for admin ${admin.id}`);
        } catch (error) {
          this.logger.error(`Failed to create notification for admin ${admin.id}:`, error);
        }
      }

      // TODO: Re-enable when needed
      // Send email to admin (using configured ADMIN_EMAIL or first admin)
      // const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
      // const targetEmail = adminEmail || admins[0]?.email;

      // if (targetEmail) {
      //   try {
      //     await this.emailService.sendNotificationEmail(
      //       targetEmail,
      //       'Admin',
      //       title,
      //       message,
      //     );
      //     this.logger.log(`Sent admin email to ${targetEmail}`);
      //   } catch (error) {
      //     this.logger.error(`Failed to send admin email:`, error);
      //   }
      // }
    } catch (error) {
      this.logger.error('Error notifying admins:', error);
    }
  }

  /**
   * Check if conditions are met to advance status
   */
  private async checkAndAdvanceStatus(
    taxCaseId: string,
    userId: string,
  ): Promise<void> {
    const taxCase = await this.prisma.taxCase.findUnique({
      where: { id: taxCaseId },
      include: {
        clientProfile: true,
        documents: true,
      },
    });

    if (!taxCase) return;

    const hasW2 = taxCase.documents.some((d) => d.type === 'w2');
    const profileComplete = taxCase.clientProfile.profileComplete;

    this.logger.log(`Checking status advancement: hasW2=${hasW2}, profileComplete=${profileComplete}, currentStatus=${taxCase.clientStatus}`);

    // If profile complete AND W2 uploaded AND still in esperando_datos
    if (
      profileComplete &&
      hasW2 &&
      taxCase.clientStatus === 'esperando_datos'
    ) {
      await this.updateTaxCaseStatus(taxCaseId, 'cuenta_en_revision');
      this.logger.log(`Auto-advanced status to cuenta_en_revision`);
    }
  }

  /**
   * Check if all required documents are uploaded
   */
  async checkAllDocsComplete(taxCaseId: string, userId: string): Promise<boolean> {
    const taxCase = await this.prisma.taxCase.findUnique({
      where: { id: taxCaseId },
      include: {
        clientProfile: true,
        documents: true,
      },
    });

    if (!taxCase) return false;

    const hasW2 = taxCase.documents.some((d) => d.type === 'w2');
    const hasPaymentProof = taxCase.documents.some((d) => d.type === 'payment_proof');
    const profileComplete = taxCase.clientProfile.profileComplete;

    const allComplete = hasW2 && hasPaymentProof && profileComplete;

    if (allComplete) {
      const clientName = await this.getClientName(userId);
      await this.processEvent({
        type: 'ALL_DOCS_COMPLETE',
        userId,
        taxCaseId,
        metadata: { clientName },
      });
    }

    return allComplete;
  }

  /**
   * Get client's full name
   */
  async getClientName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    return user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown' : 'Unknown';
  }
}
