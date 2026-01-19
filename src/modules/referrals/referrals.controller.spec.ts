import { Test, TestingModule } from '@nestjs/testing';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';
import { ApplyReferralCodeDto } from './dto/apply-referral-code.dto';
import { UpdateReferralStatusDto } from './dto/update-referral-status.dto';
import { ApplyDiscountDto } from './dto/apply-discount.dto';

/**
 * Referrals Controller Unit Tests
 *
 * Tests the ReferralsController's routing and request handling for:
 * - Code validation
 * - User referral management
 * - Admin referral management
 * - Leaderboard and stats
 */

describe('ReferralsController', () => {
  let controller: ReferralsController;
  let referralsService: jest.Mocked<ReferralsService>;

  // Mock users
  const mockClientUser = {
    id: 'client-123',
    email: 'client@example.com',
    role: 'client',
  };

  const mockAdminUser = {
    id: 'admin-123',
    email: 'admin@example.com',
    role: 'admin',
  };

  // Mock referral data
  const mockReferral = {
    id: 'ref-123',
    referrerId: 'referrer-123',
    referredUserId: 'client-123',
    referralCode: 'REF123',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCodeValidation = {
    valid: true,
    referrerId: 'referrer-123',
    referrerName: 'John Doe',
  };

  const mockLeaderboard = [
    { userId: 'user-1', name: 'Top Referrer', count: 10, rank: 1 },
    { userId: 'user-2', name: 'Second Place', count: 8, rank: 2 },
  ];

  beforeEach(async () => {
    const mockReferralsService = {
      validateCode: jest.fn(),
      applyReferralCode: jest.fn(),
      getMyReferrer: jest.fn(),
      getMyCode: jest.fn(),
      getMyReferrals: jest.fn(),
      getMyDiscount: jest.fn(),
      getLeaderboard: jest.fn(),
      getAllReferrals: jest.fn(),
      getReferralSummary: jest.fn(),
      getStats: jest.fn(),
      updateStatus: jest.fn(),
      applyDiscount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReferralsController],
      providers: [
        { provide: ReferralsService, useValue: mockReferralsService },
      ],
    }).compile();

    controller = module.get<ReferralsController>(ReferralsController);
    referralsService = module.get(ReferralsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============= PUBLIC ENDPOINTS =============

  describe('GET /referrals/validate/:code', () => {
    it('should validate a valid referral code', async () => {
      referralsService.validateCode.mockResolvedValue(mockCodeValidation);

      const result = await controller.validateCode('REF123');

      expect(referralsService.validateCode).toHaveBeenCalledWith('REF123');
      expect(result).toEqual(mockCodeValidation);
    });

    it('should return invalid for non-existent code', async () => {
      referralsService.validateCode.mockResolvedValue({ valid: false });

      const result = await controller.validateCode('INVALID');

      expect(result.valid).toBe(false);
    });
  });

  // ============= PROTECTED USER ENDPOINTS =============

  describe('POST /referrals/apply-code', () => {
    const applyCodeDto: ApplyReferralCodeDto = {
      code: 'REF123',
    };

    it('should apply referral code to current user', async () => {
      referralsService.applyReferralCode.mockResolvedValue(mockReferral);

      const result = await controller.applyCode(mockClientUser, applyCodeDto);

      expect(referralsService.applyReferralCode).toHaveBeenCalledWith(
        mockClientUser.id,
        applyCodeDto.code,
      );
      expect(result).toEqual(mockReferral);
    });
  });

  describe('GET /referrals/my-referrer', () => {
    it('should return referrer info for referred user', async () => {
      const referrerInfo = {
        referrer: { id: 'referrer-123', name: 'John Doe' },
        referralCode: 'REF123',
      };
      referralsService.getMyReferrer.mockResolvedValue(referrerInfo);

      const result = await controller.getMyReferrer(mockClientUser);

      expect(referralsService.getMyReferrer).toHaveBeenCalledWith(mockClientUser.id);
      expect(result).toEqual(referrerInfo);
    });

    it('should return null if user was not referred', async () => {
      referralsService.getMyReferrer.mockResolvedValue(null);

      const result = await controller.getMyReferrer(mockClientUser);

      expect(result).toBeNull();
    });
  });

  describe('GET /referrals/my-code', () => {
    it('should return user referral code', async () => {
      const codeInfo = { code: 'ABC123', createdAt: new Date() };
      referralsService.getMyCode.mockResolvedValue(codeInfo);

      const result = await controller.getMyCode(mockClientUser);

      expect(referralsService.getMyCode).toHaveBeenCalledWith(mockClientUser.id);
      expect(result).toEqual(codeInfo);
    });
  });

  describe('GET /referrals/my-referrals', () => {
    it('should return referrals made by user', async () => {
      const referrals = [mockReferral];
      referralsService.getMyReferrals.mockResolvedValue(referrals);

      const result = await controller.getMyReferrals(mockClientUser);

      expect(referralsService.getMyReferrals).toHaveBeenCalledWith(mockClientUser.id);
      expect(result).toEqual(referrals);
    });
  });

  describe('GET /referrals/my-discount', () => {
    it('should return discount info', async () => {
      const discountInfo = { hasDiscount: true, discountAmount: 50 };
      referralsService.getMyDiscount.mockResolvedValue(discountInfo);

      const result = await controller.getMyDiscount(mockClientUser);

      expect(referralsService.getMyDiscount).toHaveBeenCalledWith(mockClientUser.id);
      expect(result).toEqual(discountInfo);
    });
  });

  describe('GET /referrals/leaderboard', () => {
    it('should return leaderboard with default limit', async () => {
      referralsService.getLeaderboard.mockResolvedValue(mockLeaderboard);

      const result = await controller.getLeaderboard(undefined);

      expect(referralsService.getLeaderboard).toHaveBeenCalledWith(10); // DEFAULT_LIMIT
      expect(result).toEqual(mockLeaderboard);
    });

    it('should respect custom limit', async () => {
      referralsService.getLeaderboard.mockResolvedValue(mockLeaderboard);

      await controller.getLeaderboard('20');

      expect(referralsService.getLeaderboard).toHaveBeenCalledWith(20);
    });

    it('should cap limit at maximum', async () => {
      referralsService.getLeaderboard.mockResolvedValue(mockLeaderboard);

      await controller.getLeaderboard('500');

      expect(referralsService.getLeaderboard).toHaveBeenCalledWith(100); // MAX_LIMIT
    });

    it('should use default for invalid limit', async () => {
      referralsService.getLeaderboard.mockResolvedValue(mockLeaderboard);

      await controller.getLeaderboard('invalid');

      expect(referralsService.getLeaderboard).toHaveBeenCalledWith(10); // DEFAULT_LIMIT
    });
  });

  // ============= ADMIN ENDPOINTS =============

  describe('GET /referrals/admin', () => {
    it('should return all referrals', async () => {
      const allReferrals = { referrals: [mockReferral], total: 1 };
      referralsService.getAllReferrals.mockResolvedValue(allReferrals);

      const result = await controller.getAllReferrals(undefined, undefined, undefined, undefined);

      expect(referralsService.getAllReferrals).toHaveBeenCalledWith({
        status: undefined,
        search: undefined,
        limit: undefined,
        offset: undefined,
      });
      expect(result).toEqual(allReferrals);
    });

    it('should filter by status and search', async () => {
      referralsService.getAllReferrals.mockResolvedValue({ referrals: [], total: 0 });

      await controller.getAllReferrals('completed', 'john', '25', '10');

      expect(referralsService.getAllReferrals).toHaveBeenCalledWith({
        status: 'completed',
        search: 'john',
        limit: 25,
        offset: 10,
      });
    });

    it('should cap limit at maximum', async () => {
      referralsService.getAllReferrals.mockResolvedValue({ referrals: [], total: 0 });

      await controller.getAllReferrals(undefined, undefined, '5000', undefined);

      expect(referralsService.getAllReferrals).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 1000 }),
      );
    });
  });

  describe('GET /referrals/admin/summary', () => {
    it('should return referral summary', async () => {
      const summary = {
        data: [{ referrerId: 'user-1', count: 5 }],
        nextCursor: null,
      };
      referralsService.getReferralSummary.mockResolvedValue(summary);

      const result = await controller.getReferralSummary(undefined, undefined);

      expect(referralsService.getReferralSummary).toHaveBeenCalledWith({
        cursor: undefined,
        limit: 50,
      });
      expect(result).toEqual(summary);
    });

    it('should support cursor pagination', async () => {
      referralsService.getReferralSummary.mockResolvedValue({ data: [], nextCursor: null });

      await controller.getReferralSummary('cursor-123', '25');

      expect(referralsService.getReferralSummary).toHaveBeenCalledWith({
        cursor: 'cursor-123',
        limit: 25,
      });
    });
  });

  describe('GET /referrals/admin/stats', () => {
    it('should return referral stats', async () => {
      const stats = {
        totalReferrals: 100,
        completedReferrals: 50,
        pendingReferrals: 30,
        totalDiscountsApplied: 5000,
      };
      referralsService.getStats.mockResolvedValue(stats);

      const result = await controller.getStats();

      expect(referralsService.getStats).toHaveBeenCalled();
      expect(result).toEqual(stats);
    });
  });

  describe('PATCH /referrals/admin/:id/status', () => {
    const updateStatusDto: UpdateReferralStatusDto = {
      status: 'completed',
    };

    it('should update referral status', async () => {
      const updatedReferral = { ...mockReferral, status: 'completed' };
      referralsService.updateStatus.mockResolvedValue(updatedReferral);

      const result = await controller.updateStatus('ref-123', updateStatusDto);

      expect(referralsService.updateStatus).toHaveBeenCalledWith('ref-123', updateStatusDto);
      expect(result.status).toBe('completed');
    });
  });

  describe('POST /referrals/admin/clients/:id/apply-discount', () => {
    const applyDiscountDto: ApplyDiscountDto = {
      amount: 50,
      reason: 'Referral bonus',
    };

    it('should apply discount to client', async () => {
      const response = { message: 'Discount applied successfully', discountAmount: 50 };
      referralsService.applyDiscount.mockResolvedValue(response);

      const result = await controller.applyDiscount('client-123', applyDiscountDto, mockAdminUser);

      expect(referralsService.applyDiscount).toHaveBeenCalledWith(
        'client-123',
        applyDiscountDto,
        mockAdminUser.id,
      );
      expect(result).toEqual(response);
    });
  });
});
