import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { UserRole } from '@prisma/client';

interface CreateUserData {
  email: string;
  passwordHash?: string; // Optional for Google OAuth users
  firstName: string;
  lastName: string;
  phone?: string;
  role?: UserRole;
  googleId?: string;
  emailVerified?: boolean;
  referredByCode?: string;
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateUserData) {
    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        role: data.role || 'client',
        googleId: data.googleId,
        emailVerified: data.emailVerified ?? false,
        referredByCode: data.referredByCode,
      },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async hasCompletedProfile(userId: string): Promise<boolean> {
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId },
      select: { profileComplete: true },
    });
    return profile?.profileComplete ?? false;
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        googleId: true,
        profilePicturePath: true,
        tokenVersion: true,
        referralOnboardingCompleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async updateGoogleId(userId: string, googleId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { googleId },
    });
  }

  async updateLastLogin(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  async findAll(options?: { skip?: number; take?: number }) {
    return this.prisma.user.findMany({
      skip: options?.skip,
      take: options?.take,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setResetToken(userId: string, token: string, expiresAt: Date) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        resetToken: token,
        resetTokenExpiresAt: expiresAt,
      },
    });
  }

  async findByResetToken(token: string) {
    return this.prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiresAt: {
          gt: new Date(),
        },
      },
    });
  }

  async updatePassword(userId: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null,
      },
    });
  }

  async incrementTokenVersion(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        tokenVersion: { increment: 1 },
      },
    });
  }

  // ============= REFRESH TOKEN MANAGEMENT =============

  /**
   * Store a new refresh token (hashed) in the database
   */
  async createRefreshToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    deviceInfo?: string;
    ipAddress?: string;
  }) {
    return this.prisma.refreshToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        deviceInfo: data.deviceInfo,
        ipAddress: data.ipAddress,
      },
    });
  }

  /**
   * Find a refresh token by its hash (for validation)
   */
  async findRefreshTokenByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  /**
   * Revoke a specific refresh token
   */
  async revokeRefreshToken(tokenHash: string, replacedByTokenId?: string) {
    return this.prisma.refreshToken.update({
      where: { tokenHash },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
        replacedByTokenId,
      },
    });
  }

  /**
   * Revoke all refresh tokens for a user (used on logout-all or password change)
   */
  async revokeAllUserRefreshTokens(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: {
        userId,
        isRevoked: false,
      },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
      },
    });
  }

  /**
   * Revoke a single refresh token by its ID
   */
  async revokeRefreshTokenById(tokenId: string) {
    return this.prisma.refreshToken.update({
      where: { id: tokenId },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
      },
    });
  }

  /**
   * Clean up expired tokens (run periodically via cron job)
   */
  async cleanupExpiredRefreshTokens() {
    return this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          {
            isRevoked: true,
            revokedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // 7 days ago
          },
        ],
      },
    });
  }

  // ============= EMAIL VERIFICATION =============

  /**
   * Set verification token for a user (hashed)
   */
  async setVerificationToken(userId: string, tokenHash: string, expiresAt: Date) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        verificationToken: tokenHash,
        verificationTokenExpiresAt: expiresAt,
      },
    });
  }

  /**
   * Find user by verification token (must not be expired)
   */
  async findByVerificationToken(tokenHash: string) {
    return this.prisma.user.findFirst({
      where: {
        verificationToken: tokenHash,
      },
    });
  }

  /**
   * Mark user's email as verified and clear verification token
   */
  async markEmailVerified(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerified: true,
        // Keep verificationToken so re-clicks can identify the user
        verificationTokenExpiresAt: null,
      },
    });
  }

  // ============= REFERRAL ONBOARDING =============

  /**
   * Mark referral onboarding as completed for a user
   */
  async completeReferralOnboarding(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        referralOnboardingCompleted: true,
      },
      select: {
        id: true,
        referralOnboardingCompleted: true,
      },
    });
  }

  /**
   * Get referral onboarding status for a user
   */
  async getReferralOnboardingStatus(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralOnboardingCompleted: true },
    });
    return user?.referralOnboardingCompleted ?? false;
  }

  /**
   * Wipe all data tied to the demo account, keeping the User record intact.
   * Uses explicit ID fetching to avoid nested relation filters in transactions,
   * which can deadlock or silently fail in Prisma's array-mode transactions.
   */
  async demoResetData(userId: string): Promise<void> {
    // 1. Fetch IDs upfront to avoid nested relation filters
    const [clientProfile, tickets] = await Promise.all([
      this.prisma.clientProfile.findFirst({ where: { userId }, select: { id: true } }),
      this.prisma.ticket.findMany({ where: { userId }, select: { id: true } }),
    ]);

    const ticketIds = tickets.map((t) => t.id);

    const taxCaseIds = clientProfile
      ? (await this.prisma.taxCase.findMany({
          where: { clientProfileId: clientProfile.id },
          select: { id: true },
        })).map((tc) => tc.id)
      : [];

    // 2. Delete children before parents (FK order)
    if (ticketIds.length > 0) {
      await this.prisma.ticketMessage.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await this.prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    }

    if (taxCaseIds.length > 0) {
      await this.prisma.document.deleteMany({ where: { taxCaseId: { in: taxCaseIds } } });
      await this.prisma.statusHistory.deleteMany({ where: { taxCaseId: { in: taxCaseIds } } });
      await this.prisma.taxCase.deleteMany({ where: { id: { in: taxCaseIds } } });
    }

    if (clientProfile) {
      await this.prisma.clientProfile.delete({ where: { id: clientProfile.id } });
    }

    // 3. Standalone user data
    await this.prisma.w2Estimate.deleteMany({ where: { userId } });
    await this.prisma.notification.deleteMany({ where: { userId } });
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  /**
   * Get the demo account's client profile and tax case info for the admin demo panel.
   */
  async getDemoClientInfo(userId: string) {
    const clientProfile = await this.prisma.clientProfile.findFirst({
      where: { userId },
      select: {
        id: true,
        taxCases: {
          select: {
            id: true,
            caseStatus: true,
            federalStatusNew: true,
            stateStatusNew: true,
            estimatedRefund: true,
            federalActualRefund: true,
            stateActualRefund: true,
          },
          take: 1,
        },
      },
    });

    return {
      clientProfileId: clientProfile?.id ?? null,
      taxCase: clientProfile?.taxCases?.[0] ?? null,
    };
  }
}
