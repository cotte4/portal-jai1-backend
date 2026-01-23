import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { StoragePathService } from '../../common/services';
import { ProgressAutomationService } from '../progress/progress-automation.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { I18nService } from '../../i18n';
import { UploadDocumentDto } from './dto/upload-document.dto';
import {
  logStorageSuccess,
  logStorageError,
  logStorageWarning,
} from '../../common/utils/storage-logger';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly BUCKET_NAME = 'documents';

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private storagePath: StoragePathService,
    private progressAutomation: ProgressAutomationService,
    private auditLogsService: AuditLogsService,
    private notificationsService: NotificationsService,
    private i18n: I18nService,
  ) {}

  /**
   * Update computed status fields for a client profile.
   * This is called after document uploads/deletions to keep the fields in sync.
   */
  private async updateClientComputedStatus(clientProfileId: string): Promise<void> {
    try {
      // Get the client profile with their most recent tax case and documents
      const clientProfile = await this.prisma.clientProfile.findUnique({
        where: { id: clientProfileId },
        include: {
          taxCases: {
            orderBy: { taxYear: 'desc' },
            take: 1,
            include: {
              documents: {
                where: { type: 'w2' },
                select: { id: true },
              },
            },
          },
        },
      });

      if (!clientProfile) {
        return;
      }

      const taxCase = clientProfile.taxCases[0];
      const hasW2 = taxCase?.documents && taxCase.documents.length > 0;

      const isReadyToPresent =
        clientProfile.profileComplete &&
        !clientProfile.isDraft &&
        hasW2;

      const isIncomplete = !isReadyToPresent;

      // Only update if values changed
      if (
        clientProfile.isReadyToPresent !== isReadyToPresent ||
        clientProfile.isIncomplete !== isIncomplete
      ) {
        await this.prisma.clientProfile.update({
          where: { id: clientProfileId },
          data: {
            isReadyToPresent,
            isIncomplete,
          },
        });

        this.logger.log(
          `Updated computed status for client ${clientProfileId}: ready=${isReadyToPresent}`
        );
      }
    } catch (error) {
      this.logger.error(`Failed to update computed status:`, error);
    }
  }

  async upload(
    userId: string,
    file: Express.Multer.File,
    uploadDto: UploadDocumentDto,
  ) {
    // Validate file type
    const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type. Allowed types: PDF, JPEG, PNG`,
      );
    }

    // Get or create user's client profile and tax case
    // This allows users to upload documents even if they haven't completed "Mi declaracion" yet
    let clientProfile = await this.prisma.clientProfile.findUnique({
      where: { userId },
      include: { taxCases: { orderBy: { taxYear: 'desc' }, take: 1 } },
    });

    // Auto-create client profile if it doesn't exist (allows document upload before completing tax form)
    if (!clientProfile) {
      this.logger.log(`Auto-creating client profile for user ${userId} during document upload`);
      clientProfile = await this.prisma.clientProfile.create({
        data: {
          userId,
          isDraft: true,
          profileComplete: false,
        },
        include: { taxCases: { orderBy: { taxYear: 'desc' }, take: 1 } },
      });
    }

    let taxCase = clientProfile.taxCases[0];

    // Create tax case if it doesn't exist
    if (!taxCase) {
      taxCase = await this.prisma.taxCase.create({
        data: {
          clientProfileId: clientProfile.id,
          taxYear: uploadDto.tax_year || new Date().getFullYear(),
        },
      });
    }

    // Generate unique storage path using centralized service
    const taxYear = uploadDto.tax_year || taxCase.taxYear || new Date().getFullYear();
    const storagePath = this.storagePath.generateDocumentPath({
      userId,
      taxYear,
      documentType: uploadDto.type,
      originalFileName: file.originalname,
    });

    const uploadStartTime = Date.now();

    logStorageSuccess(this.logger, {
      operation: 'DOCUMENT_UPLOAD_START',
      userId,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      bucket: this.BUCKET_NAME,
      storagePath,
      documentType: uploadDto.type,
      taxYear,
    });

    // Upload to Supabase Storage
    try {
      await this.supabase.uploadFile(
        this.BUCKET_NAME,
        storagePath,
        file.buffer,
        file.mimetype,
      );
    } catch (uploadError) {
      logStorageError(this.logger, {
        operation: 'DOCUMENT_UPLOAD_FAILED',
        userId,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        bucket: this.BUCKET_NAME,
        storagePath,
        error: uploadError instanceof Error ? uploadError.message : 'Unknown error',
        durationMs: Date.now() - uploadStartTime,
      });
      throw uploadError;
    }

    // Save document metadata
    const document = await this.prisma.document.create({
      data: {
        taxCaseId: taxCase.id,
        type: uploadDto.type,
        fileName: file.originalname,
        storagePath,
        mimeType: file.mimetype,
        fileSize: file.size,
        taxYear: uploadDto.tax_year,
      },
    });

    logStorageSuccess(this.logger, {
      operation: 'DOCUMENT_UPLOAD_SUCCESS',
      userId,
      documentId: document.id,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      bucket: this.BUCKET_NAME,
      storagePath,
      documentType: uploadDto.type,
      taxYear,
      durationMs: Date.now() - uploadStartTime,
    });

    // === Update computed status fields (for W2 documents especially) ===
    if (uploadDto.type === 'w2') {
      await this.updateClientComputedStatus(clientProfile.id);
    }

    // === PROGRESS AUTOMATION: Emit events based on document type ===
    try {
      const clientName = await this.progressAutomation.getClientName(userId);

      if (uploadDto.type === 'w2') {
        // W2 document uploaded - notify admins and check status
        await this.progressAutomation.processEvent({
          type: 'W2_UPLOADED',
          userId,
          taxCaseId: taxCase.id,
          metadata: { clientName, fileName: file.originalname },
        });
        this.logger.log(`Emitted W2_UPLOADED event for user ${userId}`);
      } else if (uploadDto.type === 'payment_proof') {
        // Payment proof uploaded - set flag and notify admins
        await this.progressAutomation.processEvent({
          type: 'PAYMENT_PROOF_UPLOADED',
          userId,
          taxCaseId: taxCase.id,
          metadata: { clientName, fileName: file.originalname },
        });
        this.logger.log(`Emitted PAYMENT_PROOF_UPLOADED event for user ${userId}`);
      } else {
        // Other document - just notify admins
        await this.progressAutomation.processEvent({
          type: 'DOCUMENT_UPLOADED',
          userId,
          taxCaseId: taxCase.id,
          metadata: { clientName, fileName: file.originalname, documentType: uploadDto.type },
        });
        this.logger.log(`Emitted DOCUMENT_UPLOADED event for user ${userId}`);
      }

      // Check if all required documents are now complete
      await this.progressAutomation.checkAllDocsComplete(taxCase.id, userId);

      // Check if documentation is complete and auto-transition to "preparing" status
      await this.progressAutomation.checkDocumentationCompleteAndTransition(taxCase.id, userId);
    } catch (error) {
      // Don't fail the upload if progress automation fails
      this.logger.error('Progress automation error (non-fatal):', error);
    }

    return {
      document: {
        id: document.id,
        taxCaseId: taxCase.id,
        type: document.type,
        fileName: document.fileName,
        storagePath: document.storagePath,
        mimeType: document.mimeType,
        fileSize: document.fileSize,
        taxYear: document.taxYear,
        isReviewed: document.isReviewed,
        uploadedAt: document.uploadedAt,
      },
    };
  }

  async findByUserId(userId: string) {
    // Single query with join instead of two separate queries
    const documents = await this.prisma.document.findMany({
      where: {
        taxCase: {
          clientProfile: { userId },
        },
      },
      orderBy: { uploadedAt: 'desc' },
    });

    return documents.map((doc) => ({
      id: doc.id,
      taxCaseId: doc.taxCaseId,
      fileName: doc.fileName,
      type: doc.type,
      isReviewed: doc.isReviewed,
      uploadedAt: doc.uploadedAt,
      storagePath: doc.storagePath,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
      taxYear: doc.taxYear,
    }));
  }

  async findByClientId(clientProfileId: string) {
    const documents = await this.prisma.document.findMany({
      where: {
        taxCase: { clientProfileId },
      },
      orderBy: { uploadedAt: 'desc' },
    });

    return documents.map((doc) => ({
      id: doc.id,
      taxCaseId: doc.taxCaseId,
      fileName: doc.fileName,
      type: doc.type,
      isReviewed: doc.isReviewed,
      uploadedAt: doc.uploadedAt,
      storagePath: doc.storagePath,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
      taxYear: doc.taxYear,
    }));
  }

  async getDownloadUrl(documentId: string, userId: string, userRole: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        taxCase: {
          include: {
            clientProfile: {
              include: { user: true },
            },
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Check access
    if (
      userRole !== 'admin' &&
      document.taxCase.clientProfile.user.id !== userId
    ) {
      throw new ForbiddenException('Access denied');
    }

    const signedUrl = await this.supabase.getSignedUrl(
      this.BUCKET_NAME,
      document.storagePath,
      3600, // 1 hour
    );

    return { url: signedUrl };
  }

  async remove(documentId: string, userId: string, userRole: string) {
    logStorageSuccess(this.logger, {
      operation: 'DOCUMENT_DELETE',
      userId,
      userRole,
      documentId,
    });

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        taxCase: {
          include: {
            clientProfile: {
              include: { user: true },
            },
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Check access
    if (
      userRole !== 'admin' &&
      document.taxCase.clientProfile.user.id !== userId
    ) {
      throw new ForbiddenException('Access denied');
    }

    // Client can only delete if not reviewed
    if (userRole !== 'admin' && document.isReviewed) {
      throw new BadRequestException(
        'Cannot delete reviewed document. Please contact support.',
      );
    }

    // Delete from Supabase Storage
    await this.supabase.deleteFile(this.BUCKET_NAME, document.storagePath);

    // Delete from database
    await this.prisma.document.delete({
      where: { id: documentId },
    });

    // Update computed status fields if W2 was deleted
    if (document.type === 'w2') {
      await this.updateClientComputedStatus(document.taxCase.clientProfile.id);
    }

    // Audit log - document deletion (keep forever for legal protection)
    this.auditLogsService.log({
      action: AuditAction.DOCUMENT_DELETE,
      userId,
      targetUserId: document.taxCase.clientProfile.userId,
      details: {
        documentId,
        fileName: document.fileName,
        documentType: document.type,
        deletedByRole: userRole,
      },
    });

    return { message: 'Document deleted successfully' };
  }

  async markAsReviewed(documentId: string) {
    // Get document with client info for notification
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        taxCase: {
          include: {
            clientProfile: {
              include: { user: true },
            },
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Update document as reviewed
    const updatedDocument = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        isReviewed: true,
        reviewedAt: new Date(),
      },
    });

    // Notify client that their document has been reviewed
    const userId = document.taxCase.clientProfile.userId;
    const documentType = this.i18n.getDocumentType(document.type);

    this.notificationsService
      .createFromTemplate(
        userId,
        'status_change',
        'notifications.document_reviewed',
        { documentType, fileName: document.fileName },
      )
      .catch((err) => this.logger.error('Failed to send document review notification', err));

    return updatedDocument;
  }
}
