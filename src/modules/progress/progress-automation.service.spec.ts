import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProgressAutomationService, ProgressEvent } from './progress-automation.service';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// Mock data
const mockUser = {
  id: 'user-1',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  createdAt: new Date('2024-01-01'),
};

const mockAdmin = {
  id: 'admin-1',
  firstName: 'Admin',
  lastName: 'User',
  email: 'admin@example.com',
};

const mockClientProfile = {
  id: 'profile-1',
  userId: 'user-1',
  profileComplete: true,
  user: mockUser,
  taxCases: [],
};

const mockTaxCase = {
  id: 'taxcase-1',
  preFilingStatus: 'awaiting_documents',
  clientProfileId: 'profile-1',
  clientProfile: mockClientProfile,
  documents: [],
  paymentReceived: false,
};

describe('ProgressAutomationService', () => {
  let service: ProgressAutomationService;
  let prisma: any;
  let notificationsService: any;
  let configService: any;

  beforeEach(async () => {
    // Create mock services
    prisma = {
      taxCase: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      clientProfile: {
        findUnique: jest.fn(),
      },
      notification: {
        count: jest.fn(),
      },
      systemSetting: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };

    notificationsService = {
      create: jest.fn().mockResolvedValue(undefined),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      createFromTemplate: jest.fn().mockResolvedValue(undefined),
    };

    configService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressAutomationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<ProgressAutomationService>(ProgressAutomationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processEvent', () => {
    it('should handle PROFILE_COMPLETED event', async () => {
      prisma.taxCase.findUnique.mockResolvedValue({
        ...mockTaxCase,
        caseStatus: 'awaiting_form',
      });
      prisma.taxCase.update.mockResolvedValue({
        ...mockTaxCase,
        caseStatus: 'awaiting_docs',
      });
      prisma.user.findMany.mockResolvedValue([mockAdmin]);

      const event: ProgressEvent = {
        type: 'PROFILE_COMPLETED',
        userId: 'user-1',
        taxCaseId: 'taxcase-1',
        metadata: { clientName: 'John Doe' },
      };

      await service.processEvent(event);

      // Check that update was called with the right parameters
      expect(prisma.taxCase.update).toHaveBeenCalled();
      const updateCall = prisma.taxCase.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe('taxcase-1');
      expect(updateCall.data.caseStatus).toBe('awaiting_docs');
      expect(notificationsService.createMany).toHaveBeenCalled();
    });

    it('should handle W2_UPLOADED event', async () => {
      prisma.taxCase.findUnique.mockResolvedValue({
        ...mockTaxCase,
        documents: [{ type: 'w2' }],
        clientProfile: { ...mockClientProfile, profileComplete: true },
      });
      prisma.user.findMany.mockResolvedValue([mockAdmin]);

      const event: ProgressEvent = {
        type: 'W2_UPLOADED',
        userId: 'user-1',
        taxCaseId: 'taxcase-1',
        metadata: { clientName: 'John Doe', fileName: 'w2-2024.pdf' },
      };

      await service.processEvent(event);

      expect(notificationsService.createMany).toHaveBeenCalledWith(
        ['admin-1'],
        'system',
        'Documento W2 Subido',
        expect.stringContaining('John Doe'),
      );
    });

    it('should handle PAYMENT_PROOF_UPLOADED event', async () => {
      prisma.taxCase.update.mockResolvedValue({ ...mockTaxCase, paymentReceived: true });
      prisma.user.findMany.mockResolvedValue([mockAdmin]);

      const event: ProgressEvent = {
        type: 'PAYMENT_PROOF_UPLOADED',
        userId: 'user-1',
        taxCaseId: 'taxcase-1',
        metadata: { clientName: 'John Doe' },
      };

      await service.processEvent(event);

      expect(prisma.taxCase.update).toHaveBeenCalledWith({
        where: { id: 'taxcase-1' },
        data: { paymentReceived: true },
      });
      expect(notificationsService.createMany).toHaveBeenCalled();
    });

    it('should handle ALL_DOCS_COMPLETE event', async () => {
      prisma.user.findMany.mockResolvedValue([mockAdmin]);

      const event: ProgressEvent = {
        type: 'ALL_DOCS_COMPLETE',
        userId: 'user-1',
        taxCaseId: 'taxcase-1',
        metadata: { clientName: 'John Doe' },
      };

      await service.processEvent(event);

      expect(notificationsService.createMany).toHaveBeenCalledWith(
        ['admin-1'],
        'system',
        'Documentación Completa',
        expect.stringContaining('completado toda la documentación'),
      );
    });

    it('should handle DOCUMENT_UPLOADED event', async () => {
      prisma.user.findMany.mockResolvedValue([mockAdmin]);

      const event: ProgressEvent = {
        type: 'DOCUMENT_UPLOADED',
        userId: 'user-1',
        taxCaseId: 'taxcase-1',
        metadata: { clientName: 'John Doe', fileName: 'id.pdf', documentType: 'id' },
      };

      await service.processEvent(event);

      expect(notificationsService.createMany).toHaveBeenCalledWith(
        ['admin-1'],
        'system',
        'Nuevo Documento Subido',
        expect.stringContaining('id.pdf'),
      );
    });

    it('should not throw on error', async () => {
      prisma.taxCase.findUnique.mockRejectedValue(new Error('DB error'));

      const event: ProgressEvent = {
        type: 'PROFILE_COMPLETED',
        userId: 'user-1',
        taxCaseId: 'taxcase-1',
      };

      await expect(service.processEvent(event)).resolves.not.toThrow();
    });

    it('should notify all admins', async () => {
      const admins = [
        { id: 'admin-1', email: 'admin1@example.com', firstName: 'Admin1' },
        { id: 'admin-2', email: 'admin2@example.com', firstName: 'Admin2' },
      ];
      prisma.user.findMany.mockResolvedValue(admins);

      const event: ProgressEvent = {
        type: 'ALL_DOCS_COMPLETE',
        userId: 'user-1',
        taxCaseId: 'taxcase-1',
        metadata: { clientName: 'John' },
      };

      await service.processEvent(event);

      expect(notificationsService.createMany).toHaveBeenCalledWith(
        ['admin-1', 'admin-2'],
        'system',
        expect.any(String),
        expect.any(String),
      );
    });
  });

  describe('checkAllDocsComplete', () => {
    it('should return true when all docs are complete', async () => {
      prisma.taxCase.findUnique.mockResolvedValue({
        ...mockTaxCase,
        documents: [{ type: 'w2' }, { type: 'payment_proof' }],
        clientProfile: { ...mockClientProfile, profileComplete: true },
      });
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.findMany.mockResolvedValue([mockAdmin]);

      const result = await service.checkAllDocsComplete('taxcase-1', 'user-1');

      expect(result).toBe(true);
    });

    it('should return false when W2 is missing', async () => {
      prisma.taxCase.findUnique.mockResolvedValue({
        ...mockTaxCase,
        documents: [{ type: 'payment_proof' }],
        clientProfile: { ...mockClientProfile, profileComplete: true },
      });

      const result = await service.checkAllDocsComplete('taxcase-1', 'user-1');

      expect(result).toBe(false);
    });

    it('should return false when payment proof is missing', async () => {
      prisma.taxCase.findUnique.mockResolvedValue({
        ...mockTaxCase,
        documents: [{ type: 'w2' }],
        clientProfile: { ...mockClientProfile, profileComplete: true },
      });

      const result = await service.checkAllDocsComplete('taxcase-1', 'user-1');

      expect(result).toBe(false);
    });

    it('should return false when profile is incomplete', async () => {
      prisma.taxCase.findUnique.mockResolvedValue({
        ...mockTaxCase,
        documents: [{ type: 'w2' }, { type: 'payment_proof' }],
        clientProfile: { ...mockClientProfile, profileComplete: false },
      });

      const result = await service.checkAllDocsComplete('taxcase-1', 'user-1');

      expect(result).toBe(false);
    });

    it('should return false when tax case not found', async () => {
      prisma.taxCase.findUnique.mockResolvedValue(null);

      const result = await service.checkAllDocsComplete('invalid-id', 'user-1');

      expect(result).toBe(false);
    });

    it('should emit ALL_DOCS_COMPLETE event when complete', async () => {
      prisma.taxCase.findUnique.mockResolvedValue({
        ...mockTaxCase,
        documents: [{ type: 'w2' }, { type: 'payment_proof' }],
        clientProfile: { ...mockClientProfile, profileComplete: true },
      });
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.findMany.mockResolvedValue([mockAdmin]);

      await service.checkAllDocsComplete('taxcase-1', 'user-1');

      expect(notificationsService.createMany).toHaveBeenCalledWith(
        ['admin-1'],
        'system',
        'Documentación Completa',
        expect.any(String),
      );
    });
  });

  describe('getClientName', () => {
    it('should return full name', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const name = await service.getClientName('user-1');

      expect(name).toBe('John Doe');
    });

    it('should return Unknown when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const name = await service.getClientName('invalid-id');

      expect(name).toBe('Unknown');
    });

    it('should handle missing first or last name', async () => {
      prisma.user.findUnique.mockResolvedValue({ firstName: 'John', lastName: null });

      const name = await service.getClientName('user-1');

      expect(name).toBe('John');
    });
  });

  describe('handleMissingDocumentsCron', () => {
    it('should skip when cron is disabled', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({ value: 'false' });

      await service.handleMissingDocumentsCron();

      expect(prisma.taxCase.findMany).not.toHaveBeenCalled();
    });

    it('should run when cron is enabled', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({ value: 'true' });
      prisma.taxCase.findMany.mockResolvedValue([]);

      await service.handleMissingDocumentsCron();

      expect(prisma.taxCase.findMany).toHaveBeenCalled();
    });
  });

  describe('getMissingDocsCronStatus', () => {
    it('should return enabled status', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: 'true',
        updatedAt: new Date('2024-01-15'),
      });

      const status = await service.getMissingDocsCronStatus();

      expect(status.enabled).toBe(true);
      expect(status.lastUpdated).toEqual(new Date('2024-01-15'));
    });

    it('should return disabled status', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({ value: 'false' });

      const status = await service.getMissingDocsCronStatus();

      expect(status.enabled).toBe(false);
    });

    it('should handle missing setting', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);

      const status = await service.getMissingDocsCronStatus();

      expect(status.enabled).toBe(false);
      expect(status.lastUpdated).toBeNull();
    });
  });

  describe('setMissingDocsCronEnabled', () => {
    it('should enable cron', async () => {
      prisma.systemSetting.upsert.mockResolvedValue({});

      const result = await service.setMissingDocsCronEnabled(true, 'admin-1');

      expect(result.enabled).toBe(true);
      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ value: 'true' }),
          update: expect.objectContaining({ value: 'true' }),
        }),
      );
    });

    it('should disable cron', async () => {
      prisma.systemSetting.upsert.mockResolvedValue({});

      const result = await service.setMissingDocsCronEnabled(false, 'admin-1');

      expect(result.enabled).toBe(false);
      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ value: 'false' }),
        }),
      );
    });
  });

  describe('checkAndNotifyMissingDocuments', () => {
    it('should notify clients with missing documents', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 5); // 5 days ago

      prisma.taxCase.findMany.mockResolvedValue([
        {
          ...mockTaxCase,
          caseStatus: 'awaiting_docs',
          createdAt: oldDate,
          documents: [], // No W2
          clientProfile: {
            ...mockClientProfile,
            profileComplete: false,
            user: mockUser,
          },
        },
      ]);
      prisma.notification.count.mockResolvedValue(0);

      const result = await service.checkAndNotifyMissingDocuments(3, 3);

      expect(result.notified).toBe(1);
      expect(notificationsService.createFromTemplate).toHaveBeenCalledWith(
        'user-1',
        'docs_missing',
        'notifications.docs_missing',
        expect.objectContaining({
          firstName: 'John',
          missingDocs: expect.stringContaining('completar tu perfil'),
        }),
      );
    });

    it('should skip clients with complete docs', async () => {
      prisma.taxCase.findMany.mockResolvedValue([
        {
          ...mockTaxCase,
          caseStatus: 'awaiting_docs',
          documents: [{ type: 'w2' }],
          clientProfile: {
            ...mockClientProfile,
            profileComplete: true,
            user: mockUser,
          },
        },
      ]);

      const result = await service.checkAndNotifyMissingDocuments();

      expect(result.notified).toBe(0);
      expect(notificationsService.createFromTemplate).not.toHaveBeenCalled();
    });

    it('should respect max notifications per client', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 5);

      prisma.taxCase.findMany.mockResolvedValue([
        {
          ...mockTaxCase,
          caseStatus: 'awaiting_docs',
          createdAt: oldDate,
          documents: [],
          clientProfile: {
            ...mockClientProfile,
            profileComplete: false,
            user: mockUser,
          },
        },
      ]);
      prisma.notification.count.mockResolvedValue(3); // Already received 3 notifications

      const result = await service.checkAndNotifyMissingDocuments(3, 3);

      expect(result.skipped).toBe(1);
      expect(result.notified).toBe(0);
    });
  });

  describe('sendMissingDocsNotification', () => {
    it('should send notification to user with missing docs', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...mockClientProfile,
        profileComplete: false,
        taxCases: [{ documents: [] }],
      });

      const result = await service.sendMissingDocsNotification('user-1');

      expect(result).toBe(true);
      expect(notificationsService.createFromTemplate).toHaveBeenCalledWith(
        'user-1',
        'docs_missing',
        'notifications.docs_missing',
        expect.objectContaining({
          firstName: 'John',
          missingDocs: expect.any(String),
        }),
      );
    });

    it('should return false for user with complete docs', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...mockClientProfile,
        profileComplete: true,
        taxCases: [{ documents: [{ type: 'w2' }] }],
      });

      const result = await service.sendMissingDocsNotification('user-1');

      expect(result).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.sendMissingDocsNotification('invalid-id');

      expect(result).toBe(false);
    });

    it('should return false for user without profile', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.clientProfile.findUnique.mockResolvedValue(null);

      const result = await service.sendMissingDocsNotification('user-1');

      expect(result).toBe(false);
    });
  });
});
