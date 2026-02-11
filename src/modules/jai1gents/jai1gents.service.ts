import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import { RegisterJai1gentDto, UpdateJai1gentProfileDto, GenerateInviteCodesDto } from './dto';
import { getCommissionPercent, getCurrentTierInfo, getNextTierInfo, COMMISSION_TIERS } from './jai1gent.constants';
import { redactEmail } from '../../common/utils/log-sanitizer';

@Injectable()
export class Jai1gentsService {
  private readonly logger = new Logger(Jai1gentsService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  // ============= INVITE CODE VALIDATION =============

  /**
   * Validate an invite code (public - for registration form)
   */
  async validateInviteCode(code: string): Promise<{ valid: boolean; message?: string }> {
    if (!code || code.length !== 8) {
      return { valid: false, message: 'Invalid invite code format' };
    }

    const inviteCode = await this.prisma.jai1gentInviteCode.findUnique({
      where: { code: code.toUpperCase() },
      select: { id: true, usedById: true },
    });

    if (!inviteCode) {
      return { valid: false, message: 'Invite code not found' };
    }

    if (inviteCode.usedById) {
      return { valid: false, message: 'Invite code has already been used' };
    }

    return { valid: true };
  }

  /**
   * Validate a JAI1GENT referral code (for client registration)
   */
  async validateReferralCode(code: string): Promise<{
    valid: boolean;
    jai1gentName?: string;
    jai1gentId?: string;
  }> {
    if (!code || code.length < 7) {
      return { valid: false };
    }

    const profile = await this.prisma.jai1gentProfile.findUnique({
      where: { referralCode: code.toUpperCase() },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, isActive: true },
        },
      },
    });

    if (!profile || !profile.user.isActive) {
      return { valid: false };
    }

    return {
      valid: true,
      jai1gentName: `${profile.user.firstName} ${profile.user.lastName?.charAt(0) || ''}.`,
      jai1gentId: profile.userId,
    };
  }

  // ============= REGISTRATION =============

  /**
   * Register a new JAI1GENT
   */
  async register(dto: RegisterJai1gentDto, ipAddress?: string, userAgent?: string) {
    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Validate invite code
    const inviteCode = await this.prisma.jai1gentInviteCode.findUnique({
      where: { code: dto.invite_code.toUpperCase() },
    });

    if (!inviteCode) {
      throw new BadRequestException('Invalid invite code');
    }

    if (inviteCode.usedById) {
      throw new BadRequestException('Invite code has already been used');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Generate referral code: JAI + first 3 letters of name + 4 random alphanumeric
    const referralCode = await this.generateReferralCode(dto.first_name);

    // Create user and profile in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create user with jai1gent role
      const user = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          passwordHash,
          firstName: dto.first_name,
          lastName: dto.last_name,
          phone: dto.phone,
          role: 'jai1gent',
          emailVerified: true, // JAI1GENTS don't need email verification (invite-only)
        },
      });

      // Create JAI1GENT profile
      const profile = await tx.jai1gentProfile.create({
        data: {
          userId: user.id,
          referralCode,
        },
      });

      // Mark invite code as used
      await tx.jai1gentInviteCode.update({
        where: { id: inviteCode.id },
        data: {
          usedById: user.id,
          usedAt: new Date(),
        },
      });

      return { user, profile };
    });

    // Generate tokens
    const tokens = await this.generateTokens(
      result.user.id,
      result.user.email,
      'jai1gent',
    );

    this.logger.log(`New JAI1GENT registered: ${redactEmail(result.user.email)}`);

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        first_name: result.user.firstName,
        last_name: result.user.lastName,
        role: result.user.role,
      },
      referral_code: result.profile.referralCode,
      ...tokens,
    };
  }

  /**
   * Generate unique referral code for JAI1GENT
   * Format: JAI + first 3 letters of name + 4 random alphanumeric
   */
  private async generateReferralCode(firstName: string): Promise<string> {
    const namePrefix = firstName.substring(0, 3).toUpperCase().padEnd(3, 'X');
    const maxRetries = 10;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const random = this.generateRandomAlphanumeric(4);
      const code = `JAI${namePrefix}${random}`;

      // Check if code exists
      const existing = await this.prisma.jai1gentProfile.findUnique({
        where: { referralCode: code },
      });

      if (!existing) {
        return code;
      }
    }

    throw new BadRequestException('Failed to generate unique referral code');
  }

  /**
   * Generate random alphanumeric string
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
   * Generate JWT tokens
   */
  private async generateTokens(userId: string, email: string, role: string) {
    const payload = {
      sub: userId,
      email,
      role,
      tokenVersion: 1,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d',
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 900, // 15 minutes in seconds
    };
  }

  // ============= DASHBOARD =============

  /**
   * Get JAI1GENT dashboard data
   */
  async getDashboard(userId: string) {
    const profile = await this.prisma.jai1gentProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: { firstName: true, lastName: true, email: true },
        },
        referrals: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            referredUser: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('JAI1GENT profile not found');
    }

    const currentTier = getCurrentTierInfo(profile.completedReferrals);
    const nextTier = getNextTierInfo(profile.completedReferrals);

    return {
      referral_code: profile.referralCode,
      stats: {
        total_referrals: profile.totalReferrals,
        completed_referrals: profile.completedReferrals,
        pending_referrals: profile.totalReferrals - profile.completedReferrals,
        total_earnings: Number(profile.totalEarnings),
        paid_earnings: Number(profile.paidEarnings),
        unpaid_earnings: Number(profile.totalEarnings) - Number(profile.paidEarnings),
      },
      tier: {
        current: currentTier,
        next: nextTier,
        all_tiers: COMMISSION_TIERS.map((t, i) => ({
          tier_number: i + 1,
          min_referrals: t.min,
          max_referrals: t.max === Infinity ? null : t.max,
          percent: t.percent,
        })),
      },
      recent_referrals: profile.referrals.map((r) => ({
        id: r.id,
        referred_name: `${r.referredUser.firstName} ${r.referredUser.lastName?.charAt(0) || ''}.`,
        status: r.status,
        commission_amount: r.commissionAmount ? Number(r.commissionAmount) : null,
        created_at: r.createdAt,
        completed_at: r.completedAt,
      })),
      payment_info: {
        payment_method: profile.paymentMethod,
        has_payment_info: !!(profile.paymentMethod && (
          (profile.paymentMethod === 'bank_transfer' && profile.bankAccountNumber) ||
          (profile.paymentMethod === 'zelle' && (profile.zelleEmail || profile.zellePhone))
        )),
      },
    };
  }

  // ============= PROFILE UPDATE =============

  /**
   * Update JAI1GENT profile (payment info)
   */
  async updateProfile(userId: string, dto: UpdateJai1gentProfileDto) {
    const profile = await this.prisma.jai1gentProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('JAI1GENT profile not found');
    }

    // Build update data based on payment method
    const updateData: any = {};

    if (dto.payment_method) {
      updateData.paymentMethod = dto.payment_method;

      if (dto.payment_method === 'bank_transfer') {
        if (dto.bank_name) updateData.bankName = dto.bank_name;
        if (dto.bank_routing_number) updateData.bankRoutingNumber = dto.bank_routing_number;
        if (dto.bank_account_number) updateData.bankAccountNumber = dto.bank_account_number;
        // Clear Zelle fields
        updateData.zelleEmail = null;
        updateData.zellePhone = null;
      } else if (dto.payment_method === 'zelle') {
        if (dto.zelle_email) updateData.zelleEmail = dto.zelle_email;
        if (dto.zelle_phone) updateData.zellePhone = dto.zelle_phone;
        // Clear bank fields
        updateData.bankName = null;
        updateData.bankRoutingNumber = null;
        updateData.bankAccountNumber = null;
      }
    }

    const updated = await this.prisma.jai1gentProfile.update({
      where: { userId },
      data: updateData,
    });

    return {
      message: 'Profile updated successfully',
      payment_method: updated.paymentMethod,
    };
  }

  // ============= ADMIN: INVITE CODES =============

  /**
   * Generate invite codes (admin only)
   */
  async generateInviteCodes(adminId: string, dto: GenerateInviteCodesDto) {
    const codes: string[] = [];
    const maxRetries = 5;

    for (let i = 0; i < dto.count; i++) {
      let code: string | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const candidate = this.generateRandomAlphanumeric(8);
        const existing = await this.prisma.jai1gentInviteCode.findUnique({
          where: { code: candidate },
        });

        if (!existing) {
          code = candidate;
          break;
        }
      }

      if (!code) {
        throw new BadRequestException('Failed to generate unique invite code');
      }

      await this.prisma.jai1gentInviteCode.create({
        data: {
          code,
          createdById: adminId,
        },
      });

      codes.push(code);
    }

    this.logger.log(`Admin ${adminId} generated ${dto.count} invite codes`);

    return {
      message: `Generated ${codes.length} invite codes`,
      codes,
    };
  }

  /**
   * List invite codes (admin only)
   */
  async listInviteCodes(options: {
    status?: 'used' | 'unused' | 'all';
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};

    if (options.status === 'used') {
      where.usedById = { not: null };
    } else if (options.status === 'unused') {
      where.usedById = null;
    }

    const [codes, total] = await Promise.all([
      this.prisma.jai1gentInviteCode.findMany({
        where,
        include: {
          createdBy: {
            select: { firstName: true, lastName: true, email: true },
          },
          usedBy: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: options.limit || 50,
        skip: options.offset || 0,
      }),
      this.prisma.jai1gentInviteCode.count({ where }),
    ]);

    return {
      codes: codes.map((c) => ({
        id: c.id,
        code: c.code,
        created_by: c.createdBy
          ? `${c.createdBy.firstName} ${c.createdBy.lastName}`
          : 'Unknown',
        created_at: c.createdAt,
        used_by: c.usedBy
          ? {
              name: `${c.usedBy.firstName} ${c.usedBy.lastName}`,
              email: c.usedBy.email,
            }
          : null,
        used_at: c.usedAt,
      })),
      total,
      unused_count: await this.prisma.jai1gentInviteCode.count({
        where: { usedById: null },
      }),
    };
  }

  // ============= ADMIN: JAI1GENTS LIST =============

  /**
   * List all JAI1GENTS (admin only)
   */
  async listJai1gents(options: {
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};

    if (options.search) {
      where.user = {
        OR: [
          { firstName: { contains: options.search, mode: 'insensitive' } },
          { lastName: { contains: options.search, mode: 'insensitive' } },
          { email: { contains: options.search, mode: 'insensitive' } },
        ],
      };
    }

    const [profiles, total] = await Promise.all([
      this.prisma.jai1gentProfile.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              isActive: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: options.limit || 50,
        skip: options.offset || 0,
      }),
      this.prisma.jai1gentProfile.count({ where }),
    ]);

    return {
      jai1gents: profiles.map((p) => ({
        id: p.id,
        user_id: p.userId,
        email: p.user.email,
        name: `${p.user.firstName} ${p.user.lastName}`,
        phone: p.user.phone,
        referral_code: p.referralCode,
        is_active: p.user.isActive,
        stats: {
          total_referrals: p.totalReferrals,
          completed_referrals: p.completedReferrals,
          total_earnings: Number(p.totalEarnings),
          paid_earnings: Number(p.paidEarnings),
        },
        tier: getCurrentTierInfo(p.completedReferrals),
        payment_method: p.paymentMethod,
        has_payment_info: !!(p.paymentMethod && (
          (p.paymentMethod === 'bank_transfer' && p.bankAccountNumber) ||
          (p.paymentMethod === 'zelle' && (p.zelleEmail || p.zellePhone))
        )),
        created_at: p.createdAt,
      })),
      total,
    };
  }

  // ============= REFERRAL TRACKING (called from client registration) =============

  /**
   * Create a JAI1GENT referral when a client registers with their code
   */
  async createReferral(referralCode: string, referredUserId: string): Promise<void> {
    const profile = await this.prisma.jai1gentProfile.findUnique({
      where: { referralCode: referralCode.toUpperCase() },
    });

    if (!profile) {
      this.logger.warn(`JAI1GENT referral code not found: ${referralCode}`);
      return;
    }

    // Check if user was already referred by this JAI1GENT
    const existing = await this.prisma.jai1gentReferral.findUnique({
      where: { referredUserId },
    });

    if (existing) {
      this.logger.warn(`User ${referredUserId} already has a JAI1GENT referral`);
      return;
    }

    // Create referral record
    await this.prisma.$transaction(async (tx) => {
      await tx.jai1gentReferral.create({
        data: {
          jai1gentProfileId: profile.id,
          referredUserId,
          referralCode: referralCode.toUpperCase(),
          status: 'pending',
        },
      });

      // Increment total referrals count
      await tx.jai1gentProfile.update({
        where: { id: profile.id },
        data: {
          totalReferrals: { increment: 1 },
        },
      });
    });

    this.logger.log(`JAI1GENT referral created: ${referralCode} -> ${referredUserId}`);
  }
}
