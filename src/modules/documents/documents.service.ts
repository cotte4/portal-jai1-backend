import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DocumentsService {
  private readonly BUCKET_NAME = 'documents';

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
  ) {}

  async upload(
    userId: string,
    file: Express.Multer.File,
    uploadDto: UploadDocumentDto,
  ) {
    // Get user's client profile and tax case
    const clientProfile = await this.prisma.clientProfile.findUnique({
      where: { userId },
      include: { taxCases: { orderBy: { taxYear: 'desc' }, take: 1 } },
    });

    if (!clientProfile) {
      throw new BadRequestException('Client profile not found');
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

    // Generate unique storage path
    const fileExtension = file.originalname.split('.').pop();
    const storagePath = `${clientProfile.id}/${uuidv4()}.${fileExtension}`;

    // Upload to Supabase Storage
    await this.supabase.uploadFile(
      this.BUCKET_NAME,
      storagePath,
      file.buffer,
      file.mimetype,
    );

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

    return {
      document: {
        id: document.id,
        file_name: document.fileName,
        type: document.type,
        uploaded_at: document.uploadedAt,
      },
    };
  }

  async findByUserId(userId: string) {
    const clientProfile = await this.prisma.clientProfile.findUnique({
      where: { userId },
    });

    if (!clientProfile) {
      return [];
    }

    return this.findByClientId(clientProfile.id);
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
      file_name: doc.fileName,
      type: doc.type,
      is_reviewed: doc.isReviewed,
      uploaded_at: doc.uploadedAt,
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

    return { message: 'Document deleted successfully' };
  }

  async markAsReviewed(documentId: string) {
    return this.prisma.document.update({
      where: { id: documentId },
      data: { isReviewed: true },
    });
  }
}
