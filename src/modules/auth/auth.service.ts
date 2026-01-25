import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UsersService } from '../users/users.service';
import { ReferralsService } from '../referrals/referrals.service';
import { Jai1gentsService } from '../jai1gents/jai1gents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../../common/services';
import { SupabaseService } from '../../config/supabase.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuditAction } from '@prisma/client';
import { redactEmail, redactUserId } from '../../common/utils/log-sanitizer';
import { getAuthConfig, AuthConfig } from '../../config/auth.config';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly PROFILE_PICTURES_BUCKET = 'profile-pictures';
  private readonly authConfig: AuthConfig;

  // Pre-computed dummy hash for timing-safe login responses
  // This prevents timing attacks that could enumerate valid emails
  // Hash of a random string, computed once at class initialization
  private readonly DUMMY_PASSWORD_HASH =
    '$2b$10$dummyHashForTimingSafetyXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

  // Temporary storage for OAuth authorization codes (single-use, short-lived)
  // In production, consider using Redis for multi-instance deployments
  private oauthCodes = new Map<string, { tokens: any; user: any; expiresAt: number }>();

  // Rate limiting for resend verification (email -> { count, resetAt })
  private resendVerificationRateLimits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private usersService: UsersService,
    private referralsService: ReferralsService,
    private jai1gentsService: Jai1gentsService,
    private auditLogsService: AuditLogsService,
    private notificationsService: NotificationsService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    private supabaseService: SupabaseService,
  ) {
    this.authConfig = getAuthConfig(configService);
  }

  /**
   * Get signed URL for profile picture if user has one
   */
  private async getProfilePictureUrl(profilePicturePath: string | null): Promise<string | null> {
    if (!profilePicturePath) return null;
    try {
      return await this.supabaseService.getSignedUrl(
        this.PROFILE_PICTURES_BUCKET,
        profilePicturePath,
        3600,
      );
    } catch (err) {
      this.logger.error('Failed to get profile picture signed URL', err);
      return null;
    }
  }

  async register(registerDto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('Este email ya está registrado. Por favor, iniciá sesión o usá otro email.');
    }

    // Validate referral code if provided
    let referrerInfo: { referrerId: string; referrerName: string } | null = null;
    let isJai1gentReferral = false;

    if (registerDto.referral_code) {
      const code = registerDto.referral_code.toUpperCase();

      // Check if it's a JAI1GENT referral code (starts with JAI)
      if (code.startsWith('JAI')) {
        const jai1gentValidation = await this.jai1gentsService.validateReferralCode(code);
        if (jai1gentValidation.valid) {
          isJai1gentReferral = true;
          referrerInfo = {
            referrerId: jai1gentValidation.jai1gentId!,
            referrerName: jai1gentValidation.jai1gentName!,
          };
        } else {
          throw new BadRequestException('Invalid referral code');
        }
      } else {
        // Regular client referral code
        const validation = await this.referralsService.validateCode(code);
        if (!validation.valid) {
          throw new BadRequestException('Invalid referral code');
        }
        referrerInfo = {
          referrerId: validation.referrerId!,
          referrerName: validation.referrerName!,
        };
      }
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = await this.usersService.create({
      email: registerDto.email,
      passwordHash: hashedPassword,
      firstName: registerDto.first_name,
      lastName: registerDto.last_name,
      phone: registerDto.phone,
      referredByCode: registerDto.referral_code?.toUpperCase(),
    });

    // Create referral record if user was referred
    if (referrerInfo) {
      try {
        if (isJai1gentReferral) {
          // JAI1GENT referral
          await this.jai1gentsService.createReferral(
            registerDto.referral_code!,
            user.id,
          );
          this.logger.log(
            `JAI1GENT referral created for user ${redactUserId(user.id)}`,
          );
        } else {
          // Regular client referral
          await this.referralsService.createReferral(
            referrerInfo.referrerId,
            user.id,
            registerDto.referral_code!,
          );
          this.logger.log(
            `Referral created for user ${redactUserId(user.id)}`,
          );
        }
      } catch (err) {
        this.logger.error('Failed to create referral record', err);
        // Don't fail registration if referral creation fails
      }
    }

    // Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const hashedVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.usersService.setVerificationToken(user.id, hashedVerificationToken, verificationExpiresAt);

    // Send verification email (async, don't wait)
    this.emailService
      .sendVerificationEmail(user.email, user.firstName, verificationToken)
      .then((success) => {
        if (success) {
          this.logger.log(`Verification email sent to: ${redactEmail(user.email)}`);
        } else {
          this.logger.error(`Failed to send verification email to: ${redactEmail(user.email)}`);
        }
      })
      .catch((err) => this.logger.error('Failed to send verification email', err));

    // Send welcome in-app notification (async, don't wait)
    this.notificationsService
      .createFromTemplate(
        user.id,
        'system',
        'notifications.welcome',
        { firstName: user.firstName },
      )
      .catch((err) => this.logger.error('Failed to send welcome notification', err));

    // Return without tokens - user must verify email first
    return {
      message: 'Registration successful. Please verify your email.',
      requiresVerification: true,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
      },
    };
  }

  async login(loginDto: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.usersService.findByEmail(loginDto.email);

    // Timing-safe password verification
    // Always perform bcrypt.compare to prevent timing attacks that could enumerate valid emails
    const passwordToCompare = user?.passwordHash || this.DUMMY_PASSWORD_HASH;
    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      passwordToCompare,
    );

    if (!user) {
      // Log failed login attempt (unknown email)
      this.auditLogsService.log({
        action: AuditAction.LOGIN_FAILED,
        details: { email: loginDto.email, reason: 'Email not found' },
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!isPasswordValid) {
      // Log failed login attempt (wrong password)
      this.auditLogsService.log({
        action: AuditAction.LOGIN_FAILED,
        userId: user.id,
        details: { reason: 'Invalid password' },
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check email verification for email/password users (not Google OAuth)
    if (!user.googleId && !user.emailVerified) {
      this.auditLogsService.log({
        action: AuditAction.LOGIN_FAILED,
        userId: user.id,
        details: { reason: 'Email not verified' },
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Email not verified. Please check your inbox.',
        error: 'EMAIL_NOT_VERIFIED',
      });
    }

    if (!user.isActive) {
      // Log failed login attempt (deactivated account)
      this.auditLogsService.log({
        action: AuditAction.LOGIN_FAILED,
        userId: user.id,
        details: { reason: 'Account deactivated' },
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Account is deactivated');
    }

    await this.usersService.updateLastLogin(user.id);
    const tokens = await this.generateTokens(
      user.id,
      user.email,
      user.role,
      loginDto.rememberMe || false,
      user.tokenVersion,
      { ipAddress, deviceInfo: userAgent },
    );

    // Get profile picture URL if exists
    const profilePictureUrl = await this.getProfilePictureUrl(user.profilePicturePath);

    // Check if user has completed their profile (for onboarding redirect)
    const hasProfile = await this.usersService.hasCompletedProfile(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        phone: user.phone,
        role: user.role,
        created_at: user.createdAt,
        profilePictureUrl,
      },
      hasProfile,
      ...tokens,
    };
  }

  /**
   * Logout - revoke the specific refresh token used in this session
   * If no token provided, revokes all tokens for the user
   */
  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      // Revoke the specific refresh token
      const tokenHash = this.hashToken(refreshToken);
      try {
        await this.usersService.revokeRefreshToken(tokenHash);
        this.logger.log(`User ${userId} logged out - specific token revoked`);
      } catch {
        // Token might not exist in DB (old token before migration)
        this.logger.warn(`Could not revoke token for user ${userId} - token not found in DB`);
      }
    } else {
      // Revoke all refresh tokens for this user
      await this.usersService.revokeAllUserRefreshTokens(userId);
      this.logger.log(`User ${userId} logged out - all tokens revoked`);
    }

    return { message: 'Logged out successfully' };
  }

  async refreshTokens(refreshToken: string, ipAddress?: string, userAgent?: string) {
    try {
      // Step 1: Verify JWT signature and decode payload
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      // Step 2: Check if token exists in DB and is not revoked
      const tokenHash = this.hashToken(refreshToken);
      const storedToken = await this.usersService.findRefreshTokenByHash(tokenHash);

      if (!storedToken) {
        // Token not in DB - could be old token before rotation was implemented
        // Fall back to user lookup for backwards compatibility
        this.logger.warn(`Refresh token not found in DB for user ${redactEmail(payload.email)} - legacy token`);
      } else if (storedToken.isRevoked) {
        // SECURITY: Token was revoked - possible token theft!
        // Revoke all tokens for this user as a precaution
        this.logger.error(`Revoked refresh token used for user ${redactEmail(payload.email)} - possible token theft!`);
        await this.usersService.revokeAllUserRefreshTokens(payload.sub);
        throw new UnauthorizedException('Token has been revoked');
      } else if (storedToken.expiresAt < new Date()) {
        // Token expired in DB
        throw new UnauthorizedException('Refresh token has expired');
      }

      // Step 3: Validate user
      const user = await this.usersService.findById(payload.sub);
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Check if token version matches - if not, token has been invalidated by password change
      if (payload.tokenVersion !== undefined && payload.tokenVersion !== user.tokenVersion) {
        this.logger.warn(`Token version mismatch for user ${redactEmail(user.email)} - token invalidated`);
        throw new UnauthorizedException('Token has been invalidated');
      }

      // Step 4: Rotate - revoke old token before generating new one
      if (storedToken) {
        // Generate new tokens first to get the new token ID
        const rememberMe = payload.rememberMe || false;
        const tokens = await this.generateTokens(
          user.id,
          user.email,
          user.role,
          rememberMe,
          user.tokenVersion,
          { ipAddress, deviceInfo: userAgent },
        );

        // Now revoke the old token (link to new token for audit trail)
        const newTokenHash = this.hashToken(tokens.refresh_token);
        const newStoredToken = await this.usersService.findRefreshTokenByHash(newTokenHash);
        await this.usersService.revokeRefreshToken(tokenHash, newStoredToken?.id);

        this.logger.log(`Refresh token rotated for user ${redactEmail(user.email)}`);

        // Get profile picture URL if exists
        const profilePictureUrl = await this.getProfilePictureUrl(user.profilePicturePath);

        return {
          user: {
            id: user.id,
            email: user.email,
            first_name: user.firstName,
            last_name: user.lastName,
            phone: user.phone,
            role: user.role,
            created_at: user.createdAt,
            profilePictureUrl,
          },
          ...tokens,
        };
      }

      // Legacy path: token not in DB, just generate new tokens
      const rememberMe = payload.rememberMe || false;
      const tokens = await this.generateTokens(
        user.id,
        user.email,
        user.role,
        rememberMe,
        user.tokenVersion,
        { ipAddress, deviceInfo: userAgent },
      );

      // Get profile picture URL if exists
      const profilePictureUrl = await this.getProfilePictureUrl(user.profilePicturePath);

      return {
        user: {
          id: user.id,
          email: user.email,
          first_name: user.firstName,
          last_name: user.lastName,
          phone: user.phone,
          role: user.role,
          created_at: user.createdAt,
          profilePictureUrl,
        },
        ...tokens,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async forgotPassword(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Don't reveal if email exists - return same message
      this.logger.log(`Password reset requested for non-existent email: ${email}`);
      return { message: 'If the email exists, a reset link has been sent' };
    }

    // Generate secure random token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Hash token before storing (security: if DB is compromised, tokens can't be used)
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Save hashed token to database (send unhashed token to user via email)
    await this.usersService.setResetToken(user.id, hashedToken, expiresAt);

    // Send password reset email
    this.emailService
      .sendPasswordResetEmail(user.email, user.firstName, resetToken)
      .then((success) => {
        if (success) {
          this.logger.log(`Password reset email sent to: ${user.email}`);
        } else {
          this.logger.error(`Failed to send password reset email to: ${user.email}`);
        }
      })
      .catch((err) => this.logger.error('Failed to send password reset email', err));

    return { message: 'If the email exists, a reset link has been sent' };
  }

  async resetPassword(token: string, newPassword: string) {
    // Hash the incoming token to match against stored hash
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Find user by hashed reset token
    const user = await this.usersService.findByResetToken(hashedToken);
    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Validate password length
    if (newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear token
    await this.usersService.updatePassword(user.id, hashedPassword);

    // Invalidate all existing tokens (forces re-login on all devices)
    await this.usersService.incrementTokenVersion(user.id);
    // Also revoke all stored refresh tokens
    await this.usersService.revokeAllUserRefreshTokens(user.id);

    // Log password reset
    this.auditLogsService.log({
      action: AuditAction.PASSWORD_RESET,
      userId: user.id,
      details: { method: 'email_token' },
    });

    this.logger.log(`Password reset successful for user: ${user.email}`);

    return { message: 'Password has been reset successfully' };
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    // Get user with password hash
    const user = await this.usersService.findByEmail(
      (await this.usersService.findById(userId))?.email || '',
    );

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Validate new password is different
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await this.usersService.updatePassword(user.id, hashedPassword);

    // Invalidate all existing tokens (forces re-login on all devices)
    await this.usersService.incrementTokenVersion(user.id);
    // Also revoke all stored refresh tokens
    await this.usersService.revokeAllUserRefreshTokens(user.id);

    // Log password change
    this.auditLogsService.log({
      action: AuditAction.PASSWORD_RESET,
      userId: user.id,
      details: { method: 'user_change' },
    });

    this.logger.log(`Password changed successfully for user: ${user.email}`);

    return { message: 'Password has been changed successfully' };
  }

  /**
   * Handle Google OAuth login/registration
   */
  async googleLogin(googleUser: {
    googleId: string;
    email: string;
    firstName: string;
    lastName: string;
    picture?: string;
  }) {
    if (!googleUser.email) {
      throw new BadRequestException('Google account must have an email');
    }

    // Check if user already exists
    let user = await this.usersService.findByEmail(googleUser.email);

    if (!user) {
      // Auto-create user for Google OAuth
      user = await this.usersService.create({
        email: googleUser.email,
        firstName: googleUser.firstName || '',
        lastName: googleUser.lastName || '',
        googleId: googleUser.googleId,
        emailVerified: true, // Google verified the email
      });
      this.logger.log(`Auto-created user for Google OAuth: ${redactEmail(googleUser.email)}`);

      // Send welcome in-app notification (async, don't wait)
      this.notificationsService
        .createFromTemplate(
          user.id,
          'system',
          'notifications.welcome',
          { firstName: user.firstName },
        )
        .catch((err) => this.logger.error('Failed to send welcome notification', err));
    } else {
      // Update googleId if not set (linking existing account)
      if (!user.googleId) {
        await this.usersService.updateGoogleId(user.id, googleUser.googleId);
        // Also mark email as verified when linking Google account
        await this.usersService.markEmailVerified(user.id);
      }
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    await this.usersService.updateLastLogin(user.id);
    // Google OAuth defaults to rememberMe=true for better UX (matches frontend expectation)
    const tokens = await this.generateTokens(user.id, user.email, user.role, true, user.tokenVersion || 1);

    // Get profile picture URL if exists
    const profilePictureUrl = await this.getProfilePictureUrl(user.profilePicturePath);

    // Check if user has completed their profile (for onboarding redirect)
    const hasProfile = await this.usersService.hasCompletedProfile(user.id);

    this.logger.log(`Google OAuth login successful for: ${redactEmail(user.email)}`);

    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        phone: user.phone,
        role: user.role,
        created_at: user.createdAt,
        profilePictureUrl,
        hasProfile,
      },
      ...tokens,
    };
  }

  /**
   * Create a short-lived, single-use authorization code for OAuth flow
   * This prevents tokens from being exposed in redirect URLs
   */
  createOAuthCode(tokens: { access_token: string; refresh_token: string; expires_in: number }, user: any): string {
    // Clean up expired codes periodically
    this.cleanupExpiredOAuthCodes();

    // Generate a cryptographically secure random code
    const code = crypto.randomBytes(32).toString('hex');

    // Store with expiration
    this.oauthCodes.set(code, {
      tokens,
      user,
      expiresAt: Date.now() + this.authConfig.oauthCodeTtlMs,
    });

    this.logger.log(`Created OAuth code for user: ${user.email}`);
    return code;
  }

  /**
   * Exchange an authorization code for tokens
   * Code is single-use and deleted after exchange
   */
  exchangeOAuthCode(code: string): { tokens: any; user: any } {
    const stored = this.oauthCodes.get(code);

    if (!stored) {
      throw new BadRequestException('Invalid or expired authorization code');
    }

    // Check expiration
    if (Date.now() > stored.expiresAt) {
      this.oauthCodes.delete(code);
      throw new BadRequestException('Authorization code has expired');
    }

    // Delete code (single-use)
    this.oauthCodes.delete(code);

    this.logger.log(`OAuth code exchanged for user: ${redactEmail(stored.user.email)}`);
    return { tokens: stored.tokens, user: stored.user };
  }

  /**
   * Clean up expired OAuth codes to prevent memory leaks
   */
  private cleanupExpiredOAuthCodes(): void {
    const now = Date.now();
    for (const [code, data] of this.oauthCodes.entries()) {
      if (now > data.expiresAt) {
        this.oauthCodes.delete(code);
      }
    }
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: string,
    rememberMe: boolean = false,
    tokenVersion: number = 1,
    options?: { ipAddress?: string; deviceInfo?: string },
  ) {
    // Include rememberMe, tokenVersion, and jti for uniqueness
    const payload = {
      sub: userId,
      email,
      role,
      rememberMe,
      tokenVersion,
      jti: crypto.randomUUID(), // Unique ID to ensure each token is distinct
    };

    // Get expiration values from centralized config (using seconds for JWT compatibility)
    const accessTokenExpirySeconds = rememberMe
      ? this.authConfig.accessTokenExpirySecondsRememberMe
      : this.authConfig.accessTokenExpirySeconds;
    const refreshTokenExpirySeconds = rememberMe
      ? this.authConfig.refreshTokenExpirySecondsRememberMe
      : this.authConfig.refreshTokenExpirySeconds;
    const refreshTokenExpiryMs = rememberMe
      ? this.authConfig.refreshTokenExpiryMsRememberMe
      : this.authConfig.refreshTokenExpiryMs;

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: accessTokenExpirySeconds,
    });
    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: refreshTokenExpirySeconds,
    });

    // Store hashed refresh token in database for rotation and revocation
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await this.usersService.createRefreshToken({
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + refreshTokenExpiryMs),
      ipAddress: options?.ipAddress,
      deviceInfo: options?.deviceInfo,
    });

    this.logger.log(
      `Generated tokens for ${email} (rememberMe: ${rememberMe}, accessExpiry: ${accessTokenExpirySeconds}s)`,
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: accessTokenExpirySeconds,
    };
  }

  /**
   * Hash a refresh token for storage/lookup
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // ============= EMAIL VERIFICATION =============

  /**
   * Verify email with token
   */
  async verifyEmail(token: string) {
    // Hash the incoming token to match against stored hash
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Find user by hashed verification token
    const user = await this.usersService.findByVerificationToken(hashedToken);
    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    // Mark email as verified
    await this.usersService.markEmailVerified(user.id);

    this.logger.log(`Email verified for user: ${redactEmail(user.email)}`);

    return { message: 'Email verified successfully. You can now log in.' };
  }

  /**
   * Resend verification email
   */
  async resendVerification(email: string) {
    // Rate limiting: 3 attempts per 15 minutes per email
    const now = Date.now();
    const rateLimitKey = email.toLowerCase();
    const rateLimit = this.resendVerificationRateLimits.get(rateLimitKey);

    if (rateLimit) {
      if (now < rateLimit.resetAt) {
        if (rateLimit.count >= 3) {
          this.logger.warn(`Rate limit exceeded for resend verification: ${redactEmail(email)}`);
          // Return generic message - don't reveal rate limiting
          return { message: 'If the email exists and is not verified, a verification link has been sent.' };
        }
        rateLimit.count++;
      } else {
        // Reset the rate limit window
        this.resendVerificationRateLimits.set(rateLimitKey, { count: 1, resetAt: now + 15 * 60 * 1000 });
      }
    } else {
      this.resendVerificationRateLimits.set(rateLimitKey, { count: 1, resetAt: now + 15 * 60 * 1000 });
    }

    // Find user by email
    const user = await this.usersService.findByEmail(email);

    // Don't reveal if user exists or is already verified
    if (!user || user.emailVerified) {
      this.logger.log(`Resend verification requested for non-existent or verified email: ${redactEmail(email)}`);
      return { message: 'If the email exists and is not verified, a verification link has been sent.' };
    }

    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const hashedVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.usersService.setVerificationToken(user.id, hashedVerificationToken, verificationExpiresAt);

    // Send verification email
    this.emailService
      .sendVerificationEmail(user.email, user.firstName, verificationToken)
      .then((success) => {
        if (success) {
          this.logger.log(`Verification email resent to: ${redactEmail(user.email)}`);
        } else {
          this.logger.error(`Failed to resend verification email to: ${redactEmail(user.email)}`);
        }
      })
      .catch((err) => this.logger.error('Failed to resend verification email', err));

    return { message: 'If the email exists and is not verified, a verification link has been sent.' };
  }
}
