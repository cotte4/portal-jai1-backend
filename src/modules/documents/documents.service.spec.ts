import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { StoragePathService } from '../../common/services';
import { ProgressAutomationService } from '../progress/progress-automation.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { I18nService } from '../../i18n';

// Mock data
const mockUser = {
  id: 'user-1',
  email: 'john@example.com',
  firstName: 'John',
  lastName: 'Doe',
};

const mockClientProfile = {
  id: 'profile-1',
  userId: 'user-1',
  user: mockUser,
  taxCases: [
    {
      id: 'taxcase-1',
      taxYear: 2024,
      clientProfileId: 'profile-1',
    },
  ],
};

const mockDocument = {
  id: 'doc-1',
  taxCaseId: 'taxcase-1',
  type: 'w2',
  fileName: 'w2-2024.pdf',
  storagePath: 'users/user-1/documents/2024/w2/w2-2024.pdf',
  mimeType: 'application/pdf',
  fileSize: 1024,
  taxYear: 2024,
  isReviewed: false,
  reviewedAt: null,
  uploadedAt: new Date('2024-01-15'),
  taxCase: {
    id: 'taxcase-1',
    clientProfile: {
      ...mockClientProfile,
      user: mockUser,
      userId: 'user-1',
    },
    clientProfileId: 'profile-1',
  },
};

const mockFile: Express.Multer.File = {
  fieldname: 'file',
  originalname: 'w2-2024.pdf',
  encoding: '7bit',
  mimetype: 'application/pdf',
  buffer: Buffer.from('fake-pdf-content'),
  size: 1024,
  stream: null as any,
  destination: '',
  filename: '',
  path: '',
};

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: any;
  let supabase: any;
  let storagePath: any;
  let progressAutomation: any;
  let auditLogsService: any;
  let notificationsService: any;
  let i18n: any;

  beforeEach(async () => {
    // Create mock services
    prisma = {
      clientProfile: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      taxCase: {
        create: jest.fn(),
      },
      document: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    supabase = {
      uploadFile: jest.fn().mockResolvedValue(undefined),
      getSignedUrl: jest.fn().mockResolvedValue('https://signed-url.com/doc'),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };

    storagePath = {
      generateDocumentPath: jest.fn().mockReturnValue('users/user-1/documents/2024/w2/w2-2024.pdf'),
    };

    progressAutomation = {
      processEvent: jest.fn().mockResolvedValue(undefined),
      getClientName: jest.fn().mockResolvedValue('John Doe'),
      checkAllDocsComplete: jest.fn().mockResolvedValue(undefined),
    };

    auditLogsService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    notificationsService = {
      createFromTemplate: jest.fn().mockResolvedValue(undefined),
    };

    i18n = {
      getDocumentType: jest.fn().mockImplementation((type) => {
        const types: Record<string, string> = {
          w2: 'W2',
          id: 'Identificación',
          payment_proof: 'Comprobante de pago',
        };
        return types[type] || type;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SupabaseService, useValue: supabase },
        { provide: StoragePathService, useValue: storagePath },
        { provide: ProgressAutomationService, useValue: progressAutomation },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: I18nService, useValue: i18n },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('upload', () => {
    beforeEach(() => {
      prisma.clientProfile.findUnique.mockResolvedValue(mockClientProfile);
      prisma.document.create.mockResolvedValue(mockDocument);
    });

    it('should upload a valid PDF document', async () => {
      const result = await service.upload('user-1', mockFile, { type: 'w2' });

      expect(supabase.uploadFile).toHaveBeenCalled();
      expect(prisma.document.create).toHaveBeenCalled();
      expect(result.document.id).toBe('doc-1');
    });

    it('should upload a valid JPEG document', async () => {
      const jpgFile = { ...mockFile, mimetype: 'image/jpeg', originalname: 'w2.jpg' };

      await service.upload('user-1', jpgFile, { type: 'w2' });

      expect(supabase.uploadFile).toHaveBeenCalled();
    });

    it('should upload a valid PNG document', async () => {
      const pngFile = { ...mockFile, mimetype: 'image/png', originalname: 'w2.png' };

      await service.upload('user-1', pngFile, { type: 'w2' });

      expect(supabase.uploadFile).toHaveBeenCalled();
    });

    it('should reject invalid file types', async () => {
      const invalidFile = { ...mockFile, mimetype: 'text/plain' };

      await expect(
        service.upload('user-1', invalidFile, { type: 'w2' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should auto-create client profile if not found', async () => {
      const newProfile = {
        id: 'new-profile-1',
        userId: 'user-1',
        isDraft: true,
        profileComplete: false,
        taxCases: [],
      };
      prisma.clientProfile.findUnique.mockResolvedValue(null);
      prisma.clientProfile.create.mockResolvedValue(newProfile);
      prisma.taxCase.create.mockResolvedValue({
        id: 'new-taxcase',
        taxYear: 2024,
        clientProfileId: 'new-profile-1',
      });

      const result = await service.upload('user-1', mockFile, { type: 'w2' });

      expect(prisma.clientProfile.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          isDraft: true,
          profileComplete: false,
        },
        include: { taxCases: { orderBy: { taxYear: 'desc' }, take: 1 } },
      });
      expect(prisma.taxCase.create).toHaveBeenCalled();
      expect(result.document.id).toBe('doc-1');
    });

    it('should create tax case if not exists', async () => {
      const profileWithoutTaxCase = {
        ...mockClientProfile,
        taxCases: [],
      };
      prisma.clientProfile.findUnique.mockResolvedValue(profileWithoutTaxCase);
      prisma.taxCase.create.mockResolvedValue({
        id: 'new-taxcase',
        taxYear: 2024,
      });

      await service.upload('user-1', mockFile, { type: 'w2' });

      expect(prisma.taxCase.create).toHaveBeenCalled();
    });

    it('should emit W2_UPLOADED event for W2 documents', async () => {
      await service.upload('user-1', mockFile, { type: 'w2' });

      expect(progressAutomation.processEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'W2_UPLOADED',
        }),
      );
    });

    it('should emit PAYMENT_PROOF_UPLOADED event for payment proofs', async () => {
      await service.upload('user-1', mockFile, { type: 'payment_proof' });

      expect(progressAutomation.processEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PAYMENT_PROOF_UPLOADED',
        }),
      );
    });

    it('should emit DOCUMENT_UPLOADED event for other documents', async () => {
      await service.upload('user-1', mockFile, { type: 'id' });

      expect(progressAutomation.processEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'DOCUMENT_UPLOADED',
        }),
      );
    });

    it('should check if all docs are complete after upload', async () => {
      await service.upload('user-1', mockFile, { type: 'w2' });

      expect(progressAutomation.checkAllDocsComplete).toHaveBeenCalled();
    });
  });

  describe('findByUserId', () => {
    it('should return documents for user', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue(mockClientProfile);
      prisma.document.findMany.mockResolvedValue([mockDocument]);

      const result = await service.findByUserId('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doc-1');
    });

    it('should return empty array if no documents exist', async () => {
      prisma.document.findMany.mockResolvedValue([]);

      const result = await service.findByUserId('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('findByClientId', () => {
    it('should return documents for client', async () => {
      prisma.document.findMany.mockResolvedValue([mockDocument]);

      const result = await service.findByClientId('profile-1');

      expect(prisma.document.findMany).toHaveBeenCalledWith({
        where: {
          taxCase: { clientProfileId: 'profile-1' },
        },
        orderBy: { uploadedAt: 'desc' },
      });
      expect(result).toHaveLength(1);
    });

    it('should order by uploadedAt descending', async () => {
      prisma.document.findMany.mockResolvedValue([]);

      await service.findByClientId('profile-1');

      expect(prisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { uploadedAt: 'desc' },
        }),
      );
    });
  });

  describe('getDownloadUrl', () => {
    it('should return signed URL for document owner', async () => {
      prisma.document.findUnique.mockResolvedValue(mockDocument);

      const result = await service.getDownloadUrl('doc-1', 'user-1', 'client');

      expect(result.url).toBe('https://signed-url.com/doc');
      expect(supabase.getSignedUrl).toHaveBeenCalledWith(
        'documents',
        mockDocument.storagePath,
        3600,
      );
    });

    it('should return signed URL for admin', async () => {
      prisma.document.findUnique.mockResolvedValue(mockDocument);

      const result = await service.getDownloadUrl('doc-1', 'admin-1', 'admin');

      expect(result.url).toBe('https://signed-url.com/doc');
    });

    it('should throw NotFoundException if document not found', async () => {
      prisma.document.findUnique.mockResolvedValue(null);

      await expect(
        service.getDownloadUrl('invalid-id', 'user-1', 'client'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not owner', async () => {
      prisma.document.findUnique.mockResolvedValue(mockDocument);

      await expect(
        service.getDownloadUrl('doc-1', 'other-user', 'client'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('should delete document for owner', async () => {
      const unreviewed = { ...mockDocument, isReviewed: false };
      prisma.document.findUnique.mockResolvedValue(unreviewed);
      prisma.document.delete.mockResolvedValue(unreviewed);

      const result = await service.remove('doc-1', 'user-1', 'client');

      expect(supabase.deleteFile).toHaveBeenCalled();
      expect(prisma.document.delete).toHaveBeenCalled();
      expect(auditLogsService.log).toHaveBeenCalled();
      expect(result.message).toBe('Document deleted successfully');
    });

    it('should delete document for admin regardless of review status', async () => {
      const reviewed = { ...mockDocument, isReviewed: true };
      prisma.document.findUnique.mockResolvedValue(reviewed);
      prisma.document.delete.mockResolvedValue(reviewed);

      await service.remove('doc-1', 'admin-1', 'admin');

      expect(prisma.document.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException if document not found', async () => {
      prisma.document.findUnique.mockResolvedValue(null);

      await expect(
        service.remove('invalid-id', 'user-1', 'client'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not owner', async () => {
      prisma.document.findUnique.mockResolvedValue(mockDocument);

      await expect(
        service.remove('doc-1', 'other-user', 'client'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if client tries to delete reviewed document', async () => {
      const reviewed = { ...mockDocument, isReviewed: true };
      prisma.document.findUnique.mockResolvedValue(reviewed);

      await expect(service.remove('doc-1', 'user-1', 'client')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should log deletion to audit log', async () => {
      const unreviewed = { ...mockDocument, isReviewed: false };
      prisma.document.findUnique.mockResolvedValue(unreviewed);
      prisma.document.delete.mockResolvedValue(unreviewed);

      await service.remove('doc-1', 'admin-1', 'admin');

      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DOCUMENT_DELETE',
          userId: 'admin-1',
        }),
      );
    });
  });

  describe('markAsReviewed', () => {
    it('should mark document as reviewed', async () => {
      prisma.document.findUnique.mockResolvedValue(mockDocument);
      prisma.document.update.mockResolvedValue({
        ...mockDocument,
        isReviewed: true,
        reviewedAt: new Date(),
      });

      const result = await service.markAsReviewed('doc-1');

      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: {
          isReviewed: true,
          reviewedAt: expect.any(Date),
        },
      });
      expect(result.isReviewed).toBe(true);
    });

    it('should throw NotFoundException if document not found', async () => {
      prisma.document.findUnique.mockResolvedValue(null);

      await expect(service.markAsReviewed('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should notify client about review', async () => {
      prisma.document.findUnique.mockResolvedValue(mockDocument);
      prisma.document.update.mockResolvedValue({
        ...mockDocument,
        isReviewed: true,
      });

      await service.markAsReviewed('doc-1');

      expect(notificationsService.createFromTemplate).toHaveBeenCalledWith(
        'user-1',
        'status_change',
        'notifications.document_reviewed',
        expect.objectContaining({
          documentType: expect.any(String),
          fileName: 'w2-2024.pdf',
        }),
      );
    });

    it('should use i18n to translate document type', async () => {
      prisma.document.findUnique.mockResolvedValue(mockDocument);
      prisma.document.update.mockResolvedValue({
        ...mockDocument,
        isReviewed: true,
      });

      await service.markAsReviewed('doc-1');

      expect(i18n.getDocumentType).toHaveBeenCalledWith('w2');
    });
  });

  describe('File type validation', () => {
    const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    const invalidTypes = ['text/plain', 'image/gif', 'application/zip'];

    beforeEach(() => {
      prisma.clientProfile.findUnique.mockResolvedValue(mockClientProfile);
      prisma.document.create.mockResolvedValue(mockDocument);
    });

    validTypes.forEach((mimeType) => {
      it(`should accept ${mimeType}`, async () => {
        const file = { ...mockFile, mimetype: mimeType };

        await expect(
          service.upload('user-1', file, { type: 'w2' }),
        ).resolves.not.toThrow();
      });
    });

    invalidTypes.forEach((mimeType) => {
      it(`should reject ${mimeType}`, async () => {
        const file = { ...mockFile, mimetype: mimeType };

        await expect(
          service.upload('user-1', file, { type: 'w2' }),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });
});
