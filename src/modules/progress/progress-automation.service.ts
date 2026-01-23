import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConfigService } from '@nestjs/config';
import { CaseStatus } from '@prisma/client';
import { redactUserId, sanitizeMetadata } from '../../common/utils/log-sanitizer';

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
    private configService: ConfigService,
  ) {}

  /**
   * Process a progress event and trigger appropriate automations
   */
  async processEvent(event: ProgressEvent): Promise<void> {
    this.logger.log(`=== PROGRESS AUTOMATION: Processing event ${event.type} ===`);
    this.logger.log(`User: ${redactUserId(event.userId)}, TaxCase: ${redactUserId(event.taxCaseId)}`);
    this.logger.log(`Metadata: ${JSON.stringify(sanitizeMetadata(event.metadata || {}))}`);

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

    // Only update if still in awaiting_form or awaiting_docs status
    if (taxCase && (taxCase.caseStatus === 'awaiting_form' || taxCase.caseStatus === 'awaiting_docs')) {
      await this.updateTaxCaseCaseStatus(event.taxCaseId, CaseStatus.awaiting_docs);
      this.logger.log(`Updated caseStatus to awaiting_docs for TaxCase ${redactUserId(event.taxCaseId)}`);
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
    this.logger.log(`Set paymentReceived = true for TaxCase ${redactUserId(event.taxCaseId)}`);

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
   * Update tax case caseStatus
   */
  private async updateTaxCaseCaseStatus(
    taxCaseId: string,
    caseStatus: CaseStatus,
  ): Promise<void> {
    await this.prisma.taxCase.update({
      where: { id: taxCaseId },
      data: {
        caseStatus,
        caseStatusChangedAt: new Date(),
        statusUpdatedAt: new Date(),
      },
    });
  }

  /**
   * Notify all admin users via in-app notifications
   * Uses batch insert (createMany) to avoid N+1 query pattern
   */
  private async notifyAdmins(title: string, message: string): Promise<void> {
    try {
      // Get all admin user IDs
      const admins = await this.prisma.user.findMany({
        where: { role: 'admin' },
        select: { id: true },
      });

      if (admins.length === 0) {
        this.logger.warn('No admin users found to notify');
        return;
      }

      const adminIds = admins.map((admin) => admin.id);
      this.logger.log(`Notifying ${adminIds.length} admin(s) via batch insert`);

      // Batch create notifications for all admins (single query instead of N queries)
      const result = await this.notificationsService.createMany(
        adminIds,
        'system',
        title,
        message,
      );

      this.logger.log(`Created ${result.count} admin notifications in batch`);
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

    this.logger.log(`Checking status advancement: hasW2=${hasW2}, profileComplete=${profileComplete}, currentStatus=${taxCase.caseStatus}`);

    // If profile complete AND W2 uploaded AND still in awaiting status
    if (
      profileComplete &&
      hasW2 &&
      (taxCase.caseStatus === 'awaiting_form' || taxCase.caseStatus === 'awaiting_docs')
    ) {
      await this.updateTaxCaseCaseStatus(taxCaseId, CaseStatus.preparing);
      this.logger.log(`Auto-advanced caseStatus to preparing`);
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
   * Check if documentation is complete and auto-transition to "preparing" status
   *
   * Completion conditions:
   * - At least 1 W2 uploaded
   * - Payment proof uploaded
   * - "Mi declaración" submitted (profileComplete = true, isDraft = false)
   *
   * If all conditions are met, automatically update caseStatus to 'preparing'
   */
  async checkDocumentationCompleteAndTransition(taxCaseId: string, userId: string): Promise<void> {
    this.logger.log(`=== CHECKING DOCUMENTATION COMPLETION for TaxCase ${taxCaseId} ===`);

    const taxCase = await this.prisma.taxCase.findUnique({
      where: { id: taxCaseId },
      include: {
        clientProfile: true,
        documents: true,
      },
    });

    if (!taxCase) {
      this.logger.warn(`TaxCase ${taxCaseId} not found`);
      return;
    }

    // Check all three conditions
    const hasW2 = taxCase.documents.some((d) => d.type === 'w2');
    const hasPaymentProof = taxCase.documents.some((d) => d.type === 'payment_proof');
    const declarationSubmitted = taxCase.clientProfile.profileComplete && !taxCase.clientProfile.isDraft;

    this.logger.log(`Documentation check: hasW2=${hasW2}, hasPaymentProof=${hasPaymentProof}, declarationSubmitted=${declarationSubmitted}`);
    this.logger.log(`Current caseStatus: ${taxCase.caseStatus}`);

    // If all conditions met AND current status is awaiting_docs, auto-transition to preparing
    if (hasW2 && hasPaymentProof && declarationSubmitted) {
      if (taxCase.caseStatus === 'awaiting_docs') {
        this.logger.log(`✓ All documentation complete - auto-transitioning to 'preparing' status`);

        // Update case status to 'preparing'
        await this.prisma.taxCase.update({
          where: { id: taxCaseId },
          data: {
            caseStatus: 'preparing',
            caseStatusChangedAt: new Date(),
            statusUpdatedAt: new Date(),
          },
        });

        // Add to status history with automatic transition marker
        await this.prisma.statusHistory.create({
          data: {
            taxCaseId,
            previousStatus: 'awaiting_docs',
            newStatus: 'preparing',
            comment: 'Automatic transition: All required documents uploaded and declaration submitted',
            changedById: null, // null = automatic system change
          },
        });

        // Notify admins
        const clientName = await this.getClientName(userId);
        await this.notifyAdmins(
          'Documentación Completa - Preparando Declaración',
          `El cliente ${clientName} ha completado toda la documentación requerida. El estado cambió automáticamente a "Preparando declaración".`,
        );

        this.logger.log(`✓ Successfully auto-transitioned TaxCase ${taxCaseId} to 'preparing' status`);
      } else {
        this.logger.log(`Documentation complete but current status is '${taxCase.caseStatus}' (not 'awaiting_docs') - no auto-transition`);
      }
    } else {
      this.logger.log(`Documentation incomplete - no auto-transition performed`);
    }
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

  /**
   * CRON JOB: Runs daily at 9:00 AM to check for missing documents
   * and notify clients who haven't uploaded required docs after 3 days
   * NOTE: Only runs if cron_missing_docs_enabled setting is 'true'
   */
  @Cron('0 9 * * *', {
    name: 'check-missing-documents',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  async handleMissingDocumentsCron(): Promise<void> {
    // Check if cron is enabled
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'cron_missing_docs_enabled' },
    });

    if (setting?.value !== 'true') {
      this.logger.log('=== CRON: Missing documents check is DISABLED - skipping ===');
      return;
    }

    this.logger.log('=== CRON: Starting daily missing documents check ===');
    const result = await this.checkAndNotifyMissingDocuments(3, 3);
    this.logger.log(`=== CRON: Completed - ${result.notified} notified, ${result.skipped} skipped ===`);
  }

  /**
   * Get the current status of the missing docs cron job
   */
  async getMissingDocsCronStatus(): Promise<{ enabled: boolean; lastUpdated: Date | null }> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'cron_missing_docs_enabled' },
    });

    return {
      enabled: setting?.value === 'true',
      lastUpdated: setting?.updatedAt || null,
    };
  }

  /**
   * Enable or disable the missing docs cron job
   */
  async setMissingDocsCronEnabled(enabled: boolean, adminId?: string): Promise<{ enabled: boolean }> {
    await this.prisma.systemSetting.upsert({
      where: { key: 'cron_missing_docs_enabled' },
      create: {
        key: 'cron_missing_docs_enabled',
        value: enabled ? 'true' : 'false',
        description: 'Enable/disable the daily missing documents reminder cron job',
        updatedBy: adminId,
      },
      update: {
        value: enabled ? 'true' : 'false',
        updatedBy: adminId,
      },
    });

    this.logger.log(`Missing docs cron ${enabled ? 'ENABLED' : 'DISABLED'} by admin ${adminId || 'unknown'}`);
    return { enabled };
  }

  /**
   * Check for clients with missing documents and send notifications
   * Called by cron job or manually via admin endpoint
   *
   * @param daysThreshold - Number of days since registration to wait before sending notification
   * @param maxNotificationsPerClient - Max docs_missing notifications per client (to avoid spam)
   */
  async checkAndNotifyMissingDocuments(
    daysThreshold: number = 3,
    maxNotificationsPerClient: number = 3,
  ): Promise<{ notified: number; skipped: number }> {
    this.logger.log(`=== CHECKING FOR MISSING DOCUMENTS (threshold: ${daysThreshold} days) ===`);

    let notified = 0;
    let skipped = 0;

    try {
      // Find clients who:
      // 1. Are in awaiting_form or awaiting_docs status
      // 2. Registered more than X days ago
      // 3. Missing required documents (W2 or profile incomplete)
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - daysThreshold);

      const taxCases = await this.prisma.taxCase.findMany({
        where: {
          OR: [
            { caseStatus: 'awaiting_form' },
            { caseStatus: 'awaiting_docs' },
          ],
          createdAt: { lte: thresholdDate },
        },
        include: {
          clientProfile: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  createdAt: true,
                },
              },
            },
          },
          documents: {
            select: { type: true },
          },
        },
      });

      this.logger.log(`Found ${taxCases.length} tax cases to check for missing documents`);

      for (const taxCase of taxCases) {
        const user = taxCase.clientProfile?.user;
        if (!user) continue;

        // Check what's missing
        const hasW2 = taxCase.documents.some((d) => d.type === 'w2');
        const profileComplete = taxCase.clientProfile?.profileComplete ?? false;

        // Skip if nothing is missing
        if (hasW2 && profileComplete) {
          continue;
        }

        // Check how many docs_missing notifications this client has received
        const existingNotifications = await this.prisma.notification.count({
          where: {
            userId: user.id,
            type: 'docs_missing',
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
          },
        });

        if (existingNotifications >= maxNotificationsPerClient) {
          this.logger.log(`Skipping client ${redactUserId(user.id)} - already received ${existingNotifications} docs_missing notifications`);
          skipped++;
          continue;
        }

        // Build the notification message
        const missingItems: string[] = [];
        if (!profileComplete) missingItems.push('completar tu perfil');
        if (!hasW2) missingItems.push('subir tu documento W2');

        // Send the notification using template
        await this.notificationsService.createFromTemplate(
          user.id,
          'docs_missing',
          'notifications.docs_missing',
          {
            firstName: user.firstName,
            missingDocs: missingItems.join(' y '),
          },
        );

        this.logger.log(`Sent docs_missing notification to client ${redactUserId(user.id)} (${user.firstName} ${user.lastName})`);
        notified++;
      }
    } catch (error) {
      this.logger.error('Error checking for missing documents:', error);
    }

    this.logger.log(`=== MISSING DOCUMENTS CHECK COMPLETE: ${notified} notified, ${skipped} skipped ===`);
    return { notified, skipped };
  }

  /**
   * Send docs_missing notification to a specific client
   * Can be called from admin endpoint or automation
   */
  async sendMissingDocsNotification(userId: string): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true },
      });

      if (!user) {
        this.logger.warn(`User ${userId} not found for docs_missing notification`);
        return false;
      }

      // Get their tax case to check what's missing
      const clientProfile = await this.prisma.clientProfile.findUnique({
        where: { userId },
        include: {
          taxCases: {
            orderBy: { taxYear: 'desc' },
            take: 1,
            include: {
              documents: { select: { type: true } },
            },
          },
        },
      });

      if (!clientProfile) {
        this.logger.warn(`Client profile not found for user ${redactUserId(userId)}`);
        return false;
      }

      const taxCase = clientProfile.taxCases[0];
      const hasW2 = taxCase?.documents.some((d) => d.type === 'w2') ?? false;
      const profileComplete = clientProfile.profileComplete;

      // Build message based on what's missing
      const missingItems: string[] = [];
      if (!profileComplete) missingItems.push('completar tu perfil');
      if (!hasW2) missingItems.push('subir tu documento W2');

      if (missingItems.length === 0) {
        this.logger.log(`No missing documents for user ${redactUserId(userId)}`);
        return false;
      }

      await this.notificationsService.createFromTemplate(
        userId,
        'docs_missing',
        'notifications.docs_missing',
        {
          firstName: user.firstName,
          missingDocs: missingItems.join(' y '),
        },
      );

      this.logger.log(`Sent docs_missing notification to user ${redactUserId(userId)}`);
      return true;
    } catch (error) {
      this.logger.error(`Error sending docs_missing notification to user ${redactUserId(userId)}:`, error);
      return false;
    }
  }
}
