import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

// Mock data
const mockUser = {
  id: 'user-1',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  referralCode: null,
  referralCodeCreatedAt: null,
  isActive: true,
  clientProfile: null,
};

const mockReferrer = {
  id: 'referrer-1',
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane@example.com',
  referralCode: 'JAN1234',
  referralCodeCreatedAt: new Date(),
  isActive: true,
};

const mockReferral = {
  id: 'referral-1',
  referrerId: 'referrer-1',
  referredUserId: 'user-1',
  referralCode: 'JAN1234',
  status: 'pending',
  referredDiscount: 11,
  createdAt: new Date(),
  completedAt: null,
  referrer: mockReferrer,
  referredUser: mockUser,
};

describe('ReferralsService', () => {
  let service: ReferralsService;
  let prisma: any;
  let notificationsService: any;

  beforeEach(async () => {
    // Create mock services
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      referral: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      discountApplication: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(prisma)),
    };

    notificationsService = {
      create: jest.fn().mockResolvedValue(undefined),
      createFromTemplate: jest.fn().mockResolvedValue(undefined),
    };

    const supabaseService = {
      getSignedUrl: jest.fn().mockResolvedValue('https://signed-url.com/image'),
    };

    const auditLogsService = {
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferralsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SupabaseService, useValue: supabaseService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    }).compile();

    service = module.get<ReferralsService>(ReferralsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateCode', () => {
    it('should return invalid for empty code', async () => {
      const result = await service.validateCode('');
      expect(result).toEqual({ valid: false });
    });

    it('should return invalid for code shorter than 4 characters', async () => {
      const result = await service.validateCode('ABC');
      expect(result).toEqual({ valid: false });
    });

    it('should return invalid for non-existent code', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.validateCode('INVALID123');
      expect(result).toEqual({ valid: false });
    });

    it('should return valid with referrer info for existing code', async () => {
      prisma.user.findFirst.mockResolvedValue(mockReferrer);

      const result = await service.validateCode('JAN1234');

      expect(result).toEqual({
        valid: true,
        referrerName: 'Jane S.',
        referrerId: 'referrer-1',
      });
    });

    it('should convert code to uppercase before searching', async () => {
      prisma.user.findFirst.mockResolvedValue(mockReferrer);

      await service.validateCode('jan1234');

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          referralCode: 'JAN1234',
          isActive: true,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      });
    });
  });

  describe('calculateDiscount', () => {
    it('should return 0% for 0 successful referrals', () => {
      expect(service.calculateDiscount(0)).toBe(0);
    });

    it('should return 5% for 1 successful referral', () => {
      expect(service.calculateDiscount(1)).toBe(5);
    });

    it('should return 10% for 2 successful referrals', () => {
      expect(service.calculateDiscount(2)).toBe(10);
    });

    it('should return 20% for 3 successful referrals', () => {
      expect(service.calculateDiscount(3)).toBe(20);
    });

    it('should return 30% for 4 successful referrals', () => {
      expect(service.calculateDiscount(4)).toBe(30);
    });

    it('should return 50% for 5 successful referrals', () => {
      expect(service.calculateDiscount(5)).toBe(50);
    });

    it('should return 75% for 6 successful referrals', () => {
      expect(service.calculateDiscount(6)).toBe(75);
    });

    it('should return 100% for 7+ successful referrals', () => {
      expect(service.calculateDiscount(7)).toBe(100);
      expect(service.calculateDiscount(10)).toBe(100);
      expect(service.calculateDiscount(100)).toBe(100);
    });
  });

  describe('calculateTier', () => {
    it('should return tier 0 for 0 successful referrals', () => {
      expect(service.calculateTier(0)).toBe(0);
    });

    it('should return tier 1 for 1 successful referral', () => {
      expect(service.calculateTier(1)).toBe(1);
    });

    it('should return tier 7 for 7+ successful referrals', () => {
      expect(service.calculateTier(7)).toBe(7);
      expect(service.calculateTier(10)).toBe(7);
    });
  });

  describe('createReferral', () => {
    it('should throw BadRequestException for self-referral', async () => {
      await expect(
        service.createReferral('user-1', 'user-1', 'CODE123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if user already referred', async () => {
      prisma.referral.findUnique.mockResolvedValue(mockReferral);

      await expect(
        service.createReferral('referrer-1', 'user-1', 'JAN1234'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create referral and notify referrer', async () => {
      prisma.referral.findUnique.mockResolvedValue(null);
      prisma.referral.create.mockResolvedValue(mockReferral);
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await service.createReferral('referrer-1', 'user-1', 'jan1234');

      expect(prisma.referral.create).toHaveBeenCalledWith({
        data: {
          referrerId: 'referrer-1',
          referredUserId: 'user-1',
          referralCode: 'JAN1234', // Should be uppercase
          status: 'pending',
          referredDiscount: 11,
        },
      });

      expect(notificationsService.createFromTemplate).toHaveBeenCalledWith(
        'referrer-1',
        'message',
        'notifications.referral_new',
        {
          referredName: 'John',
        },
      );
    });
  });

  describe('getMyReferrer', () => {
    it('should return wasReferred: false if no referral exists', async () => {
      prisma.referral.findUnique.mockResolvedValue(null);

      const result = await service.getMyReferrer('user-1');

      expect(result).toEqual({
        wasReferred: false,
        discount: 0,
      });
    });

    it('should return referrer info if referral exists', async () => {
      prisma.referral.findUnique.mockResolvedValue({
        ...mockReferral,
        referrer: mockReferrer,
      });

      const result = await service.getMyReferrer('user-1');

      expect(result).toEqual({
        wasReferred: true,
        referrerName: 'Jane S.',
        discount: 11,
      });
    });
  });

  describe('applyReferralCode', () => {
    it('should throw if user already has referral', async () => {
      prisma.referral.findUnique.mockResolvedValue(mockReferral);

      await expect(
        service.applyReferralCode('user-1', 'CODE123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if user profile is already complete', async () => {
      prisma.referral.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        clientProfile: { profileComplete: true, isDraft: false },
      });

      await expect(
        service.applyReferralCode('user-1', 'JAN1234'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw for invalid referral code', async () => {
      prisma.referral.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        clientProfile: { profileComplete: false, isDraft: true },
      });
      prisma.user.findFirst.mockResolvedValue(null); // validateCode returns invalid

      await expect(
        service.applyReferralCode('user-1', 'INVALID'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw for self-referral', async () => {
      prisma.referral.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        clientProfile: { profileComplete: false, isDraft: true },
      });
      prisma.user.findFirst.mockResolvedValue({
        ...mockUser,
        referralCode: 'JOH1234',
      }); // Returns the same user

      await expect(
        service.applyReferralCode('user-1', 'JOH1234'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully apply referral code', async () => {
      prisma.referral.findUnique
        .mockResolvedValueOnce(null) // First call: check existing referral
        .mockResolvedValueOnce(null); // Second call: in createReferral
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        clientProfile: { profileComplete: false, isDraft: true },
      });
      prisma.user.findFirst.mockResolvedValue(mockReferrer);
      prisma.referral.create.mockResolvedValue(mockReferral);

      const result = await service.applyReferralCode('user-1', 'JAN1234');

      expect(result).toEqual({
        success: true,
        referrerName: 'Jane S.',
        discount: 11,
        message: expect.stringContaining('$11'),
      });
    });
  });

  describe('getMyDiscount', () => {
    it('should return correct discount info', async () => {
      prisma.referral.count
        .mockResolvedValueOnce(3) // total count (getTotalReferralCount)
        .mockResolvedValueOnce(2); // successful count (getSuccessfulReferralCount)

      const result = await service.getMyDiscount('referrer-1');

      expect(result).toEqual({
        totalReferrals: 3,
        successfulReferrals: 2,
        pendingReferrals: 1, // totalCount - successfulCount = 3 - 2
        currentDiscountPercent: 20, // 3 total referrals = 20%
        nextTierAt: 4, // Next tier at 4 referrals
        discountTiers: expect.any(Array),
      });
    });

    it('should return 0% for no referrals', async () => {
      prisma.referral.count
        .mockResolvedValueOnce(0) // total count (getTotalReferralCount)
        .mockResolvedValueOnce(0); // successful count (getSuccessfulReferralCount)

      const result = await service.getMyDiscount('referrer-1');

      expect(result.currentDiscountPercent).toBe(0);
      expect(result.nextTierAt).toBe(1);
    });
  });

  describe('generateCode', () => {
    it('should throw NotFoundException for non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.generateCode('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return existing code if user already has one', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        referralCode: 'JOH5678',
      });

      const result = await service.generateCode('user-1');

      expect(result).toBe('JOH5678');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should generate code with user first name prefix', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        firstName: 'John',
        referralCode: null,
      });

      // Mock transaction to return the generated code
      prisma.$transaction.mockImplementation(async (callback) => {
        // Simulate the transaction logic
        const tx = {
          user: {
            findUnique: jest.fn()
              .mockResolvedValueOnce(null) // Code doesn't exist
              .mockResolvedValueOnce({ referralCode: null }), // User doesn't have code yet
            update: jest.fn().mockResolvedValue({ referralCode: 'JOHXXXX' }),
          },
        };
        return callback(tx);
      });

      const result = await service.generateCode('user-1');

      expect(result).toMatch(/^JOH/); // Should start with JOH
    });
  });

  describe('getMyCode', () => {
    it('should return null code and not eligible for user without profile', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.getMyCode('user-1');

      expect(result).toEqual({
        code: null,
        isEligible: false,
        createdAt: null,
      });
    });

    it('should return existing code if user has one', async () => {
      const createdAt = new Date();
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        referralCode: 'JOH1234',
        referralCodeCreatedAt: createdAt,
        clientProfile: { profileComplete: true },
      });

      const result = await service.getMyCode('user-1');

      expect(result).toEqual({
        code: 'JOH1234',
        isEligible: true,
        createdAt,
      });
    });

    it('should return not eligible if profile not complete', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        referralCode: null,
        clientProfile: { profileComplete: false },
      });

      const result = await service.getMyCode('user-1');

      expect(result).toEqual({
        code: null,
        isEligible: false,
        createdAt: null,
      });
    });
  });

  describe('updateReferralOnTaxFormSubmit', () => {
    it('should be a no-op (deprecated method)', async () => {
      await service.updateReferralOnTaxFormSubmit('user-1');

      expect(prisma.referral.findUnique).not.toHaveBeenCalled();
      expect(prisma.referral.update).not.toHaveBeenCalled();
    });
  });

  describe('markReferralSuccessful', () => {
    it('should do nothing if no referral exists', async () => {
      prisma.referral.findUnique.mockResolvedValue(null);

      await service.markReferralSuccessful('user-1', 'tax-case-1');

      expect(prisma.referral.update).not.toHaveBeenCalled();
    });

    it('should do nothing if referral already successful', async () => {
      prisma.referral.findUnique.mockResolvedValue({
        ...mockReferral,
        status: 'successful',
      });

      await service.markReferralSuccessful('user-1', 'tax-case-1');

      expect(prisma.referral.update).not.toHaveBeenCalled();
    });

    it('should mark referral as successful and create discount', async () => {
      prisma.referral.findUnique.mockResolvedValue({
        ...mockReferral,
        status: 'tax_form_submitted',
        referrer: mockReferrer,
      });
      prisma.referral.count.mockResolvedValue(1); // getTotalReferralCount
      prisma.user.findUnique.mockResolvedValue({ firstName: 'Jane' }); // referrer name lookup + referred name lookup

      await service.markReferralSuccessful('user-1', 'tax-case-1');

      expect(prisma.referral.update).toHaveBeenCalledWith({
        where: { id: 'referral-1' },
        data: {
          status: 'successful',
          taxCaseId: 'tax-case-1',
          completedAt: expect.any(Date),
        },
      });

      expect(prisma.discountApplication.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          taxCaseId: 'tax-case-1',
          discountType: 'referral_bonus',
          discountAmount: 11,
        }),
      });

      expect(notificationsService.createFromTemplate).toHaveBeenCalledWith(
        'referrer-1',
        'status_change',
        'notifications.referral_successful',
        expect.objectContaining({
          firstName: 'Jane',
          amount: '11',
        }),
      );
    });
  });

  describe('getSuccessfulReferralCount', () => {
    it('should return count of successful referrals', async () => {
      prisma.referral.count.mockResolvedValue(5);

      const result = await service.getSuccessfulReferralCount('referrer-1');

      expect(result).toBe(5);
      expect(prisma.referral.count).toHaveBeenCalledWith({
        where: {
          referrerId: 'referrer-1',
          status: 'successful',
        },
      });
    });
  });

  describe('getMyReferrals', () => {
    it('should return formatted referral list', async () => {
      prisma.referral.findMany.mockResolvedValue([
        {
          id: 'ref-1',
          status: 'successful',
          createdAt: new Date('2024-01-01'),
          completedAt: new Date('2024-02-01'),
          referredUser: { id: 'user-2', firstName: 'Bob', lastName: 'Wilson' },
        },
        {
          id: 'ref-2',
          status: 'pending',
          createdAt: new Date('2024-03-01'),
          completedAt: null,
          referredUser: { id: 'user-3', firstName: 'Alice', lastName: null },
        },
      ]);

      const result = await service.getMyReferrals('referrer-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'ref-1',
        referredUser: { firstName: 'Bob', lastName: 'W.' },
        status: 'successful',
        createdAt: expect.any(Date),
        completedAt: expect.any(Date),
      });
      expect(result[1].referredUser.lastName).toBe('.');
    });
  });
});
