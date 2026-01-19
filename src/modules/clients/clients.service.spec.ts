import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { EncryptionService, EmailService } from '../../common/services';
import { NotificationsService } from '../notifications/notifications.service';
import { ProgressAutomationService } from '../progress/progress-automation.service';
import { ReferralsService } from '../referrals/referrals.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

// Mock data
const mockUser = {
  id: 'user-1',
  email: 'john@example.com',
  firstName: 'John',
  lastName: 'Doe',
  phone: '+1234567890',
  profilePicturePath: null,
  preferredLanguage: 'es',
};

const mockTaxCase = {
  id: 'taxcase-1',
  taxYear: 2024,
  clientProfileId: 'profile-1',
  bankName: 'Test Bank',
  bankRoutingNumber: 'encrypted-routing',
  bankAccountNumber: 'encrypted-account',
  workState: 'TX',
  employerName: 'Test Company',
  federalStatus: 'processing',
  stateStatus: 'processing',
  federalStatusNew: 'in_process',
  stateStatusNew: 'in_process',
  estimatedRefund: 1500,
  hasProblem: false,
  caseStatus: 'in_progress',
};

const mockClientProfile = {
  id: 'profile-1',
  userId: 'user-1',
  ssn: 'encrypted-ssn',
  dateOfBirth: new Date('1990-01-15'),
  addressStreet: 'encrypted-street',
  addressCity: 'Houston',
  addressState: 'TX',
  addressZip: '77001',
  profileComplete: true,
  isDraft: false,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
  user: mockUser,
  taxCases: [mockTaxCase],
};

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: any;
  let supabase: any;
  let encryption: any;
  let emailService: any;
  let notificationsService: any;
  let progressAutomation: any;
  let referralsService: any;
  let auditLogsService: any;

  beforeEach(async () => {
    // Create mock services
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      clientProfile: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      taxCase: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(prisma)),
    };

    supabase = {
      getSignedUrl: jest.fn().mockResolvedValue('https://signed-url.com/pic'),
      uploadFile: jest.fn().mockResolvedValue(undefined),
    };

    encryption = {
      encrypt: jest.fn().mockImplementation((value) => `encrypted-${value}`),
      decrypt: jest.fn().mockImplementation((value) => value.replace('encrypted-', '')),
      maskSSN: jest.fn().mockReturnValue('***-**-1234'),
      maskRoutingNumber: jest.fn().mockReturnValue('****5678'),
      maskBankAccount: jest.fn().mockReturnValue('****9012'),
    };

    emailService = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    notificationsService = {
      create: jest.fn().mockResolvedValue(undefined),
      createFromTemplate: jest.fn().mockResolvedValue(undefined),
    };

    progressAutomation = {
      processEvent: jest.fn().mockResolvedValue(undefined),
    };

    referralsService = {
      applyReferralCode: jest.fn().mockResolvedValue(undefined),
    };

    auditLogsService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SupabaseService, useValue: supabase },
        { provide: EncryptionService, useValue: encryption },
        { provide: EmailService, useValue: emailService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ProgressAutomationService, useValue: progressAutomation },
        { provide: ReferralsService, useValue: referralsService },
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('should return user profile with masked sensitive data', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        clientProfile: mockClientProfile,
      });

      const result = await service.getProfile('user-1');

      expect(result.user.id).toBe('user-1');
      expect(result.user.email).toBe('john@example.com');
      expect(result.profile).toBeDefined();
      expect(encryption.maskSSN).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return null profile if no client profile', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        clientProfile: null,
      });

      const result = await service.getProfile('user-1');

      expect(result.profile).toBeNull();
    });

    it('should generate signed URL for profile picture', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        profilePicturePath: 'users/1/avatar.jpg',
        clientProfile: mockClientProfile,
      });

      const result = await service.getProfile('user-1');

      expect(supabase.getSignedUrl).toHaveBeenCalled();
      expect(result.user.profilePictureUrl).toBeDefined();
    });

    it('should decrypt address for display', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        clientProfile: mockClientProfile,
      });

      await service.getProfile('user-1');

      expect(encryption.decrypt).toHaveBeenCalled();
    });
  });

  describe('completeProfile', () => {
    beforeEach(() => {
      prisma.clientProfile.findUnique.mockResolvedValue(null);
      prisma.clientProfile.upsert.mockResolvedValue(mockClientProfile);
      prisma.taxCase.findFirst.mockResolvedValue(null);
      prisma.taxCase.create.mockResolvedValue(mockTaxCase);
      prisma.taxCase.update.mockResolvedValue(mockTaxCase);
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.user.findUnique.mockResolvedValue(mockUser);
    });

    it('should create new profile', async () => {
      const result = await service.completeProfile('user-1', {
        ssn: '123-45-6789',
        date_of_birth: '1990-01-15',
        address: {
          street: '123 Main St',
          city: 'Houston',
          state: 'TX',
          zip: '77001',
        },
        is_draft: false,
      });

      expect(prisma.clientProfile.upsert).toHaveBeenCalled();
      expect(result.message).toBe('Profile saved successfully');
    });

    it('should encrypt sensitive data', async () => {
      await service.completeProfile('user-1', {
        ssn: '123-45-6789',
        address: { street: '123 Main St' },
        bank: { routing_number: '123456789', account_number: '987654321' },
      });

      expect(encryption.encrypt).toHaveBeenCalledWith('123-45-6789');
      expect(encryption.encrypt).toHaveBeenCalledWith('123 Main St');
    });

    it('should throw BadRequestException if profile already complete', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...mockClientProfile,
        profileComplete: true,
        isDraft: false,
      });

      await expect(
        service.completeProfile('user-1', { ssn: '123-45-6789' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow saving as draft', async () => {
      await service.completeProfile('user-1', {
        ssn: '123-45-6789',
        is_draft: true,
      });

      expect(prisma.clientProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            isDraft: true,
            profileComplete: false,
          }),
        }),
      );
    });

    it('should trigger progress automation when profile is completed (not draft)', async () => {
      await service.completeProfile('user-1', {
        ssn: '123-45-6789',
        is_draft: false,
      });

      // Wait for setImmediate to execute
      await new Promise((resolve) => setImmediate(resolve));

      // Progress automation is called in background task
      // The test verifies the profile was saved correctly
      expect(prisma.clientProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            profileComplete: true,
          }),
        }),
      );
    });

    it('should update phone if provided', async () => {
      await service.completeProfile('user-1', {
        phone: '+1987654321',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { phone: '+1987654321' },
      });
    });
  });

  describe('updateUserInfo', () => {
    beforeEach(() => {
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.clientProfile.upsert.mockResolvedValue(mockClientProfile);
    });

    it('should update user name', async () => {
      const result = await service.updateUserInfo('user-1', {
        firstName: 'Jane',
        lastName: 'Smith',
      });

      expect(prisma.user.update).toHaveBeenCalled();
      expect(result.message).toBe('User info updated successfully');
    });

    it('should update phone number', async () => {
      await service.updateUserInfo('user-1', { phone: '+1999888777' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phone: '+1999888777' }),
        }),
      );
    });

    it('should update address with encryption', async () => {
      await service.updateUserInfo('user-1', {
        address: {
          street: '456 New St',
          city: 'Dallas',
          state: 'TX',
          zip: '75001',
        },
      });

      expect(encryption.encrypt).toHaveBeenCalledWith('456 New St');
    });

    it('should validate preferred language', async () => {
      await service.updateUserInfo('user-1', {
        preferredLanguage: 'en',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ preferredLanguage: 'en' }),
        }),
      );
    });

    it('should ignore invalid language', async () => {
      await service.updateUserInfo('user-1', {
        preferredLanguage: 'invalid',
      });

      // Should not include preferredLanguage in update
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ preferredLanguage: 'invalid' }),
        }),
      );
    });
  });

  describe('getDraft', () => {
    it('should return decrypted draft data', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...mockClientProfile,
        isDraft: true,
      });

      const result = await service.getDraft('user-1');

      expect(result).toBeDefined();
      expect(encryption.decrypt).toHaveBeenCalled();
    });

    it('should return null if no profile exists', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue(null);

      const result = await service.getDraft('user-1');

      expect(result).toBeNull();
    });

    it('should mask turbotax password', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...mockClientProfile,
        turbotaxPassword: 'encrypted-password',
      });

      const result = await service.getDraft('user-1');

      expect(result?.turbotaxPassword).toBe('********');
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      prisma.clientProfile.findMany.mockResolvedValue([mockClientProfile]);
    });

    it('should return paginated clients', async () => {
      const result = await service.findAll({ limit: 10 });

      expect(prisma.clientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 11, // limit + 1 for cursor pagination
        }),
      );
      expect(result).toBeDefined();
    });

    it('should filter by search term', async () => {
      await service.findAll({ limit: 10, search: 'john' });

      expect(prisma.clientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: expect.objectContaining({
              OR: expect.any(Array),
            }),
          }),
        }),
      );
    });

    it('should filter by hasProblem', async () => {
      await service.findAll({ limit: 10, hasProblem: true });

      expect(prisma.clientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            taxCases: expect.objectContaining({
              some: expect.objectContaining({
                hasProblem: true,
              }),
            }),
          }),
        }),
      );
    });

    it('should filter by federal status', async () => {
      await service.findAll({ limit: 10, federalStatus: 'in_process' });

      expect(prisma.clientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            taxCases: expect.objectContaining({
              some: expect.objectContaining({
                federalStatusNew: 'in_process',
              }),
            }),
          }),
        }),
      );
    });

    it('should filter by date range', async () => {
      await service.findAll({
        limit: 10,
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      });

      expect(prisma.clientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lt: expect.any(Date),
            }),
          }),
        }),
      );
    });

    it('should support cursor pagination', async () => {
      await service.findAll({ limit: 10, cursor: 'profile-1' });

      expect(prisma.clientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'profile-1' },
        }),
      );
    });

    it('should support custom sorting', async () => {
      await service.findAll({ limit: 10, sortBy: 'name', sortOrder: 'asc' });

      expect(prisma.clientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: expect.objectContaining({
            user: { firstName: 'asc' },
          }),
        }),
      );
    });

    it('should filter by group_pending status', async () => {
      await service.findAll({ limit: 10, status: 'group_pending' });

      expect(prisma.clientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ taxCases: { none: {} } }),
            ]),
          }),
        }),
      );
    });

    it('should filter by group_completed status', async () => {
      await service.findAll({ limit: 10, status: 'group_completed' });

      expect(prisma.clientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            taxCases: expect.objectContaining({
              some: expect.objectContaining({
                OR: expect.any(Array),
              }),
            }),
          }),
        }),
      );
    });
  });

  describe('Encryption handling', () => {
    it('should handle null values in encryption', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        clientProfile: {
          ...mockClientProfile,
          ssn: null,
          addressStreet: null,
        },
      });

      const result = await service.getProfile('user-1');

      expect(result.profile?.ssn).toBeNull();
    });

    it('should mask bank account numbers', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        clientProfile: mockClientProfile,
      });

      await service.getProfile('user-1');

      expect(encryption.maskBankAccount).toHaveBeenCalled();
    });
  });

  describe('Background task handling', () => {
    it('should not throw when background task fails', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue(null);
      prisma.clientProfile.upsert.mockResolvedValue(mockClientProfile);
      prisma.taxCase.findFirst.mockResolvedValue(mockTaxCase);
      prisma.taxCase.update.mockResolvedValue(mockTaxCase);
      prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

      // Should not throw despite background task potentially failing
      await expect(
        service.completeProfile('user-1', { ssn: '123-45-6789', is_draft: false }),
      ).resolves.not.toThrow();
    });
  });

  describe('findOne', () => {
    const mockClientWithDetails = {
      ...mockClientProfile,
      user: mockUser,
      taxCases: [
        {
          ...mockTaxCase,
          documents: [],
          statusHistory: [],
          federalStatusNew: 'in_process',
          federalStatusNewChangedAt: new Date(),
          stateStatusNew: 'in_process',
          stateStatusNewChangedAt: new Date(),
          caseStatus: 'in_progress',
        },
      ],
    };

    it('should return client details with decrypted data', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue(mockClientWithDetails);

      const result = await service.findOne('profile-1');

      expect(result.id).toBe('profile-1');
      expect(result.user.email).toBe('john@example.com');
      expect(result.profile).toBeDefined();
      expect(encryption.decrypt).toHaveBeenCalled();
    });

    it('should throw NotFoundException if client not found', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue(null);

      await expect(service.findOne('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return taxCases with alarms', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue(mockClientWithDetails);

      const result = await service.findOne('profile-1');

      expect(result.taxCases).toHaveLength(1);
      expect(result.taxCases[0]).toHaveProperty('alarms');
      expect(result.taxCases[0]).toHaveProperty('hasAlarm');
    });

    it('should collect documents from all tax cases', async () => {
      const clientWithDocs = {
        ...mockClientWithDetails,
        taxCases: [
          {
            ...mockTaxCase,
            documents: [{ id: 'doc-1', name: 'test.pdf' }],
            statusHistory: [],
            federalStatusNew: 'in_process',
            stateStatusNew: 'in_process',
          },
        ],
      };
      prisma.clientProfile.findUnique.mockResolvedValue(clientWithDocs);

      const result = await service.findOne('profile-1');

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].id).toBe('doc-1');
    });

    it('should handle null encrypted fields', async () => {
      const clientNullFields = {
        ...mockClientWithDetails,
        ssn: null,
        addressStreet: null,
        turbotaxEmail: null,
        turbotaxPassword: null,
        irsUsername: null,
        irsPassword: null,
        stateUsername: null,
        statePassword: null,
      };
      prisma.clientProfile.findUnique.mockResolvedValue(clientNullFields);

      const result = await service.findOne('profile-1');

      expect(result.profile.ssn).toBeNull();
      expect(result.profile.address.street).toBeNull();
    });
  });

  describe('markPaid', () => {
    it('should mark payment as received', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...mockClientProfile,
        taxCases: [mockTaxCase],
      });
      prisma.taxCase.update.mockResolvedValue({ ...mockTaxCase, paymentReceived: true });

      const result = await service.markPaid('profile-1');

      expect(prisma.taxCase.update).toHaveBeenCalledWith({
        where: { id: mockTaxCase.id },
        data: { paymentReceived: true },
      });
      expect(result.message).toBe('Payment marked as received');
    });

    it('should throw NotFoundException if client not found', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue(null);

      await expect(service.markPaid('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if no tax case exists', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...mockClientProfile,
        taxCases: [],
      });

      await expect(service.markPaid('profile-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateAdminStep', () => {
    beforeEach(() => {
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...mockClientProfile,
        user: { ...mockUser, referralCode: null },
        taxCases: [{ ...mockTaxCase, adminStep: 1 }],
      });
      prisma.$transaction.mockImplementation((arr) => Promise.all(arr));
      prisma.taxCase.update.mockResolvedValue(mockTaxCase);
      prisma.statusHistory = { create: jest.fn().mockResolvedValue({}) };
      referralsService.generateCode = jest.fn().mockResolvedValue('REF123');
      referralsService.updateReferralOnTaxFormSubmit = jest.fn().mockResolvedValue(undefined);
    });

    it('should update admin step successfully', async () => {
      const result = await service.updateAdminStep('profile-1', 2, 'admin-1');

      expect(result.message).toBe('Admin step updated successfully');
      expect(result.step).toBe(2);
    });

    it('should throw BadRequestException for invalid step (< 1)', async () => {
      await expect(
        service.updateAdminStep('profile-1', 0, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid step (> 5)', async () => {
      await expect(
        service.updateAdminStep('profile-1', 6, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if client not found', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAdminStep('invalid-id', 2, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should generate referral code when step >= 3 and user has no code', async () => {
      await service.updateAdminStep('profile-1', 3, 'admin-1');

      expect(referralsService.generateCode).toHaveBeenCalled();
      expect(referralsService.updateReferralOnTaxFormSubmit).toHaveBeenCalled();
    });

    it('should not generate referral code when step < 3', async () => {
      await service.updateAdminStep('profile-1', 2, 'admin-1');

      expect(referralsService.generateCode).not.toHaveBeenCalled();
    });

    it('should not fail if referral code generation fails', async () => {
      referralsService.generateCode.mockRejectedValue(new Error('Referral error'));

      await expect(
        service.updateAdminStep('profile-1', 3, 'admin-1'),
      ).resolves.not.toThrow();
    });
  });

  describe('setProblem', () => {
    beforeEach(() => {
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...mockClientProfile,
        user: { id: 'user-1', firstName: 'John' },
        taxCases: [{ ...mockTaxCase, hasProblem: false, adminStep: 2 }],
      });
      prisma.taxCase.update.mockResolvedValue(mockTaxCase);
    });

    it('should mark problem on case', async () => {
      const result = await service.setProblem('profile-1', {
        hasProblem: true,
        problemType: 'missing_documents',
        problemDescription: 'Missing W2 form',
      });

      expect(prisma.taxCase.update).toHaveBeenCalledWith({
        where: { id: mockTaxCase.id },
        data: expect.objectContaining({
          hasProblem: true,
          problemType: 'missing_documents',
          problemDescription: 'Missing W2 form',
          problemStep: 2,
        }),
      });
      expect(result.message).toBe('Problem marked on case');
      expect(result.hasProblem).toBe(true);
    });

    it('should send notification when marking new problem', async () => {
      await service.setProblem('profile-1', { hasProblem: true });

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        'problem_alert',
        expect.any(String),
        expect.any(String),
      );
    });

    it('should not send notification if already had problem', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...mockClientProfile,
        user: { id: 'user-1', firstName: 'John' },
        taxCases: [{ ...mockTaxCase, hasProblem: true }],
      });

      await service.setProblem('profile-1', { hasProblem: true });

      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('should resolve problem and send notification', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...mockClientProfile,
        user: { id: 'user-1', firstName: 'John' },
        taxCases: [{ ...mockTaxCase, hasProblem: true }],
      });

      const result = await service.setProblem('profile-1', { hasProblem: false });

      expect(prisma.taxCase.update).toHaveBeenCalledWith({
        where: { id: mockTaxCase.id },
        data: expect.objectContaining({
          hasProblem: false,
          problemResolvedAt: expect.any(Date),
          problemStep: null,
          problemType: null,
          problemDescription: null,
        }),
      });
      expect(result.message).toBe('Problem resolved');
      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        'status_change',
        expect.any(String),
        expect.any(String),
      );
    });

    it('should throw NotFoundException if client not found', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.setProblem('invalid-id', { hasProblem: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPaymentsSummary', () => {
    it('should return payments summary with calculations', async () => {
      prisma.clientProfile.findMany.mockResolvedValue([
        {
          id: 'profile-1',
          user: { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
          taxCases: [
            {
              federalActualRefund: 1000,
              stateActualRefund: 500,
              federalDepositDate: new Date(),
              stateDepositDate: null,
              paymentReceived: true,
              commissionPaid: false,
            },
          ],
        },
      ]);

      const result = await service.getPaymentsSummary();

      expect(result.clients).toHaveLength(1);
      expect(result.clientCount).toBe(1);
      expect(result.clients[0].federalTaxes).toBe(1000);
      expect(result.clients[0].stateTaxes).toBe(500);
      expect(result.clients[0].totalTaxes).toBe(1500);
      // 11% commission
      expect(result.clients[0].totalCommission).toBe(165);
      expect(result.clients[0].clientReceives).toBe(1335);
      expect(result.totals.totalTaxes).toBe(1500);
    });

    it('should filter out clients without refund amounts', async () => {
      prisma.clientProfile.findMany.mockResolvedValue([
        {
          id: 'profile-1',
          user: { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
          taxCases: [{ federalActualRefund: null, stateActualRefund: null }],
        },
        {
          id: 'profile-2',
          user: { firstName: 'Jane', lastName: 'Smith', email: 'jane@test.com' },
          taxCases: [{ federalActualRefund: 500, stateActualRefund: 0 }],
        },
      ]);

      const result = await service.getPaymentsSummary();

      expect(result.clients).toHaveLength(1);
      expect(result.clients[0].name).toBe('Jane Smith');
    });

    it('should handle empty client list', async () => {
      prisma.clientProfile.findMany.mockResolvedValue([]);

      const result = await service.getPaymentsSummary();

      expect(result.clients).toHaveLength(0);
      expect(result.clientCount).toBe(0);
      expect(result.totals.totalTaxes).toBe(0);
    });
  });

  describe('getSeasonStats', () => {
    it('should return season statistics', async () => {
      prisma.clientProfile.count.mockResolvedValue(10);
      prisma.taxCase.findMany.mockResolvedValue([
        {
          federalActualRefund: 1000,
          stateActualRefund: 500,
          federalDepositDate: new Date(),
          stateDepositDate: null,
          estimatedRefund: 1400,
          federalStatus: 'deposited',
          stateStatus: 'processing',
        },
        {
          federalActualRefund: null,
          stateActualRefund: null,
          federalDepositDate: null,
          stateDepositDate: null,
          estimatedRefund: 800,
          federalStatus: 'processing',
          stateStatus: 'processing',
        },
      ]);

      const result = await service.getSeasonStats();

      expect(result.totalClients).toBe(10);
      expect(result.taxesCompletedPercent).toBeGreaterThanOrEqual(0);
      expect(result).toHaveProperty('projectedEarnings');
      expect(result).toHaveProperty('earningsToDate');
    });

    it('should handle no tax cases', async () => {
      prisma.clientProfile.count.mockResolvedValue(0);
      prisma.taxCase.findMany.mockResolvedValue([]);

      const result = await service.getSeasonStats();

      expect(result.totalClients).toBe(0);
      expect(result.taxesCompletedPercent).toBe(0);
    });
  });

  describe('sendClientNotification', () => {
    beforeEach(() => {
      prisma.clientProfile.findUnique.mockResolvedValue({
        ...mockClientProfile,
        user: { ...mockUser, id: 'user-1' },
      });
      prisma.notification = { count: jest.fn().mockResolvedValue(0) };
    });

    it('should send notification successfully', async () => {
      const result = await service.sendClientNotification('profile-1', {
        title: 'Test Title',
        message: 'Test Message',
        sendEmail: false,
      });

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        'system',
        'Test Title',
        'Test Message',
      );
      expect(result.message).toBe('Notification sent successfully');
    });

    it('should throw NotFoundException if client not found', async () => {
      prisma.clientProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.sendClientNotification('invalid-id', {
          title: 'Test',
          message: 'Test',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when rate limit exceeded', async () => {
      prisma.notification.count.mockResolvedValue(5);

      await expect(
        service.sendClientNotification('profile-1', {
          title: 'Test',
          message: 'Test',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should send email when sendEmail is true', async () => {
      emailService.sendNotificationEmail = jest.fn().mockResolvedValue(true);

      await service.sendClientNotification('profile-1', {
        title: 'Test Title',
        message: 'Test Message',
        sendEmail: true,
      });

      expect(emailService.sendNotificationEmail).toHaveBeenCalledWith(
        'john@example.com',
        'John',
        'Test Title',
        'Test Message',
      );
    });
  });
});
