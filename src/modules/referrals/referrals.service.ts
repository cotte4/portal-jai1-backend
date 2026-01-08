import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApplyDiscountDto } from './dto/apply-discount.dto';
import { UpdateReferralStatusDto } from './dto/update-referral-status.dto';

// Discount tiers: # successful referrals -> % discount
const DISCOUNT_TIERS = [
  { min: 1, percent: 5 },
  { min: 2, percent: 10 },
  { min: 3, percent: 20 },
  { min: 4, percent: 30 },
  { min: 5, percent: 50 },
  { min: 6, percent: 75 },
  { min: 7, percent: 100 },
];

const REFERRED_BONUS = 11; // $11 USD discount for referred person

@Injectable()
export class ReferralsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Generate unique referral code for a user
   * Format: FIRST_3_LETTERS + 4 random alphanumeric
   * Uses transaction with retry to prevent race conditions
   */
  async generateCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, referralCode: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // If user already has a code, return it
    if (user.referralCode) {
      return user.referralCode;
    }

    // Generate unique code with retry mechanism to handle race conditions
    const prefix = user.firstName.substring(0, 3).toUpperCase();
    const maxRetries = 10;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const random = this.generateRandomAlphanumeric(4);
      const code = `${prefix}${random}`;

      try {
        // Use transaction to atomically check and save the code
        const result = await this.prisma.$transaction(async (tx) => {
          // Check if code already exists
          const existing = await tx.user.findUnique({
            where: { referralCode: code },
          });

          if (existing) {
            // Code exists, will retry with new code
            return null;
          }

          // Check if user already got a code (race condition with another request)
          const currentUser = await tx.user.findUnique({
            where: { id: userId },
            select: { referralCode: true },
          });

          if (currentUser?.referralCode) {
            // Another request already assigned a code
            return currentUser.referralCode;
          }

          // Save code to user
          const updated = await tx.user.update({
            where: { id: userId },
            data: {
              referralCode: code,
              referralCodeCreatedAt: new Date(),
            },
          });

          return updated.referralCode;
        });

        if (result) {
          return result;
        }
        // Code collision, continue to next attempt
      } catch (error) {
        // Handle unique constraint violation (P2002) by retrying
        if (error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }

    throw new BadRequestException(
      'Failed to generate unique referral code after maximum retries',
    );
  }

  /**
   * Generate random alphanumeric string using cryptographically secure randomness
   */
  private generateRandomAlphanumeric(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(bytes[i] % chars.length);
    }
    return result;
  }

  /**
   * Validate a referral code and return referrer info
   */
  async validateCode(code: string): Promise<{
    valid: boolean;
    referrerName?: string;
    referrerId?: string;
  }> {
    if (!code || code.length < 4) {
      return { valid: false };
    }

    const referrer = await this.prisma.user.findFirst({
      where: {
        referralCode: code.toUpperCase(),
        isActive: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!referrer) {
      return { valid: false };
    }

    return {
      valid: true,
      referrerName: `${referrer.firstName} ${referrer.lastName?.charAt(0) || ''}.`,
      referrerId: referrer.id,
    };
  }

  /**
   * Create a referral record when a user registers with a referral code
   */
  async createReferral(
    referrerId: string,
    referredUserId: string,
    referralCode: string,
  ): Promise<void> {
    // Prevent self-referral
    if (referrerId === referredUserId) {
      throw new BadRequestException('Cannot refer yourself');
    }

    // Check if user was already referred
    const existing = await this.prisma.referral.findUnique({
      where: { referredUserId },
    });

    if (existing) {
      throw new BadRequestException('User has already been referred');
    }

    // Create referral record
    await this.prisma.referral.create({
      data: {
        referrerId,
        referredUserId,
        referralCode: referralCode.toUpperCase(),
        status: 'pending',
        referredDiscount: REFERRED_BONUS,
      },
    });

    // Notify referrer
    await this.notificationsService.create(
      referrerId,
      'message',
      'Nuevo referido',
      'Alguien se registró usando tu código de referido. Cuando complete sus taxes, ganarás recompensas.',
    );
  }

  /**
   * Update referral status when referred user submits tax form
   */
  async updateReferralOnTaxFormSubmit(referredUserId: string): Promise<void> {
    const referral = await this.prisma.referral.findUnique({
      where: { referredUserId },
    });

    if (referral && referral.status === 'pending') {
      await this.prisma.referral.update({
        where: { id: referral.id },
        data: { status: 'tax_form_submitted' },
      });
    }
  }

  /**
   * Mark referral as successful when referred user receives refund
   */
  async markReferralSuccessful(
    referredUserId: string,
    taxCaseId: string,
  ): Promise<void> {
    const referral = await this.prisma.referral.findUnique({
      where: { referredUserId },
      include: {
        referrer: {
          select: { id: true, firstName: true },
        },
      },
    });

    if (!referral || referral.status === 'successful') {
      return;
    }

    // Update referral to successful
    await this.prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: 'successful',
        taxCaseId,
        completedAt: new Date(),
      },
    });

    // Create discount application for referred user ($11 bonus)
    const currentYear = new Date().getFullYear();
    await this.prisma.discountApplication.create({
      data: {
        userId: referredUserId,
        taxCaseId,
        discountType: 'referral_bonus',
        discountAmount: REFERRED_BONUS,
        referralId: referral.id,
        seasonYear: currentYear,
        status: 'pending',
      },
    });

    // Notify referrer of successful referral
    const successfulCount = await this.getSuccessfulReferralCount(
      referral.referrerId,
    );
    const discountPercent = this.calculateDiscount(successfulCount);

    await this.notificationsService.create(
      referral.referrerId,
      'status_change',
      'Referido exitoso',
      `Tu referido completó sus taxes. Ahora tienes ${successfulCount} referido(s) exitoso(s) y ${discountPercent}% de descuento en tu próxima comisión.`,
    );
  }

  /**
   * Get count of successful referrals for a user
   */
  async getSuccessfulReferralCount(userId: string): Promise<number> {
    return this.prisma.referral.count({
      where: {
        referrerId: userId,
        status: 'successful',
      },
    });
  }

  /**
   * Calculate discount percentage based on successful referral count
   */
  calculateDiscount(successfulCount: number): number {
    for (let i = DISCOUNT_TIERS.length - 1; i >= 0; i--) {
      if (successfulCount >= DISCOUNT_TIERS[i].min) {
        return DISCOUNT_TIERS[i].percent;
      }
    }
    return 0;
  }

  /**
   * Get user's referral code
   */
  async getMyCode(userId: string): Promise<{
    code: string | null;
    isEligible: boolean;
    createdAt: Date | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        referralCode: true,
        referralCodeCreatedAt: true,
      },
    });

    return {
      code: user?.referralCode || null,
      isEligible: !!user?.referralCode,
      createdAt: user?.referralCodeCreatedAt || null,
    };
  }

  /**
   * Get referrals made by a user
   */
  async getMyReferrals(userId: string) {
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: {
        referredUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return referrals.map((r) => ({
      id: r.id,
      referredUser: {
        firstName: r.referredUser.firstName,
        lastName: (r.referredUser.lastName?.charAt(0) || '') + '.',
      },
      status: r.status,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    }));
  }

  /**
   * Get user's discount info
   */
  async getMyDiscount(userId: string) {
    const successfulCount = await this.getSuccessfulReferralCount(userId);
    const pendingCount = await this.prisma.referral.count({
      where: {
        referrerId: userId,
        status: { not: 'successful' },
      },
    });

    const currentDiscountPercent = this.calculateDiscount(successfulCount);

    // Find next tier
    let nextTierAt = 0;
    for (const tier of DISCOUNT_TIERS) {
      if (successfulCount < tier.min) {
        nextTierAt = tier.min;
        break;
      }
    }

    return {
      successfulReferrals: successfulCount,
      pendingReferrals: pendingCount,
      currentDiscountPercent,
      nextTierAt,
      discountTiers: DISCOUNT_TIERS,
    };
  }

  /**
   * Get global leaderboard
   */
  async getLeaderboard(limit = 10) {
    const currentYear = new Date().getFullYear();

    // Get users with successful referrals, ordered by count
    const leaderboard = await this.prisma.referral.groupBy({
      by: ['referrerId'],
      where: {
        status: 'successful',
        completedAt: {
          gte: new Date(`${currentYear}-01-01`),
        },
      },
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: limit,
    });

    // Get user details for each entry
    const userIds = leaderboard.map((l) => l.referrerId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    return leaderboard.map((entry, index) => {
      const user = userMap.get(entry.referrerId);
      return {
        rank: index + 1,
        userId: entry.referrerId,
        displayName: user
          ? `${user.firstName} ${user.lastName?.charAt(0) || ''}.`
          : 'Usuario',
        successfulReferrals: entry._count.id,
        currentTier: this.calculateDiscount(entry._count.id),
      };
    });
  }

  /**
   * Admin: Get all referrals
   */
  async getAllReferrals(options: {
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};

    if (options.status) {
      where.status = options.status;
    }

    if (options.search) {
      where.OR = [
        {
          referrer: {
            OR: [
              { firstName: { contains: options.search, mode: 'insensitive' } },
              { lastName: { contains: options.search, mode: 'insensitive' } },
              { email: { contains: options.search, mode: 'insensitive' } },
            ],
          },
        },
        {
          referredUser: {
            OR: [
              { firstName: { contains: options.search, mode: 'insensitive' } },
              { lastName: { contains: options.search, mode: 'insensitive' } },
              { email: { contains: options.search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const [referrals, total] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        include: {
          referrer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          referredUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: options.limit || 50,
        skip: options.offset || 0,
      }),
      this.prisma.referral.count({ where }),
    ]);

    return {
      referrals: referrals.map((r) => ({
        id: r.id,
        referralCode: r.referralCode,
        status: r.status,
        referrer: {
          id: r.referrer.id,
          firstName: r.referrer.firstName,
          lastName: r.referrer.lastName,
          email: r.referrer.email,
        },
        referredUser: {
          id: r.referredUser.id,
          firstName: r.referredUser.firstName,
          lastName: r.referredUser.lastName,
          email: r.referredUser.email,
        },
        referredDiscount: r.referredDiscount,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      })),
      total,
    };
  }

  /**
   * Admin: Get referral program stats
   */
  async getStats() {
    const currentYear = new Date().getFullYear();
    const yearStart = new Date(`${currentYear}-01-01`);

    const [
      totalReferrals,
      successfulReferrals,
      pendingReferrals,
      totalUsersWithCode,
    ] = await Promise.all([
      this.prisma.referral.count({
        where: { createdAt: { gte: yearStart } },
      }),
      this.prisma.referral.count({
        where: { status: 'successful', createdAt: { gte: yearStart } },
      }),
      this.prisma.referral.count({
        where: {
          status: { in: ['pending', 'tax_form_submitted', 'awaiting_refund'] },
          createdAt: { gte: yearStart },
        },
      }),
      this.prisma.user.count({
        where: { referralCode: { not: null } },
      }),
    ]);

    const conversionRate =
      totalReferrals > 0
        ? Math.round((successfulReferrals / totalReferrals) * 100)
        : 0;

    return {
      totalReferrals,
      successfulReferrals,
      pendingReferrals,
      totalUsersWithCode,
      conversionRate,
      seasonYear: currentYear,
    };
  }

  /**
   * Admin: Update referral status
   */
  async updateStatus(referralId: string, dto: UpdateReferralStatusDto) {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
    });

    if (!referral) {
      throw new NotFoundException('Referral not found');
    }

    const updateData: any = { status: dto.status };

    if (dto.status === 'successful' && !referral.completedAt) {
      updateData.completedAt = new Date();
    }

    await this.prisma.referral.update({
      where: { id: referralId },
      data: updateData,
    });

    return { message: 'Referral status updated successfully' };
  }

  /**
   * Admin: Apply discount to a client
   */
  async applyDiscount(clientId: string, dto: ApplyDiscountDto, adminId: string) {
    // Get user and their successful referral count
    const user = await this.prisma.user.findUnique({
      where: { id: clientId },
      include: {
        clientProfile: {
          include: {
            taxCases: {
              where: { taxYear: dto.seasonYear },
              take: 1,
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Client not found');
    }

    const taxCase = user.clientProfile?.taxCases?.[0];

    // Create discount application
    const discount = await this.prisma.discountApplication.create({
      data: {
        userId: clientId,
        taxCaseId: taxCase?.id || null,
        discountType: dto.discountType,
        discountAmount: dto.discountAmount,
        discountPercent: dto.discountPercent,
        referralId: dto.referralId,
        appliedByAdminId: adminId,
        seasonYear: dto.seasonYear,
        status: dto.applyImmediately ? 'applied' : 'pending',
        notes: dto.notes,
      },
    });

    // Notify user
    await this.notificationsService.create(
      clientId,
      'status_change',
      'Descuento aplicado',
      `Se te ha aplicado un descuento de ${dto.discountPercent ? dto.discountPercent + '%' : '$' + dto.discountAmount} en tu comisión.`,
    );

    return {
      id: discount.id,
      message: 'Discount applied successfully',
    };
  }
}
