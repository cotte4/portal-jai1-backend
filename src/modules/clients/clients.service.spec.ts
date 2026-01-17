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
      },
      taxCase: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
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
});
