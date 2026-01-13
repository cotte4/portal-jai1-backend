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
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EmailService } from '../../common/services';
import { SupabaseService } from '../../config/supabase.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuditAction } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly PROFILE_PICTURES_BUCKET = 'profile-pictures';

  constructor(
    private usersService: UsersService,
    private referralsService: ReferralsService,
    private auditLogsService: AuditLogsService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    private supabaseService: SupabaseService,
  ) {}

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
      throw new ConflictException('Email already registered');
    }

    // Validate referral code if provided
    let referrerInfo: { referrerId: string; referrerName: string } | null = null;
    if (registerDto.referral_code) {
      const validation = await this.referralsService.validateCode(
        registerDto.referral_code,
      );
      if (!validation.valid) {
        throw new BadRequestException('Invalid referral code');
      }
      referrerInfo = {
        referrerId: validation.referrerId!,
        referrerName: validation.referrerName!,
      };
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
        await this.referralsService.createReferral(
          referrerInfo.referrerId,
          user.id,
          registerDto.referral_code!,
        );
        this.logger.log(
          `Referral created: ${referrerInfo.referrerName} referred ${user.email}`,
        );
      } catch (err) {
        this.logger.error('Failed to create referral record', err);
        // Don't fail registration if referral creation fails
      }
    }

    // Set lastLoginAt since registration counts as first login
    await this.usersService.updateLastLogin(user.id);

    const tokens = await this.generateTokens(user.id, user.email, user.role);

    // TODO: Re-enable when needed
    // Send welcome email (async, don't wait)
    // this.emailService
    //   .sendWelcomeEmail(user.email, user.firstName)
    //   .catch((err) => this.logger.error('Failed to send welcome email', err));

    // Notify admin of new registration (async, don't wait)
    // const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
    // if (adminEmail) {
    //   this.emailService
    //     .sendNewClientNotification(
    //       adminEmail,
    //       `${user.firstName} ${user.lastName}`,
    //       user.email,
    //     )
    //     .catch((err) => this.logger.error('Failed to send admin notification', err));
    // }

    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        phone: user.phone,
        role: user.role,
        created_at: user.createdAt,
      },
      ...tokens,
    };
  }

  async login(loginDto: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.usersService.findByEmail(loginDto.email);
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

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );
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
  }

  async logout(userId: string) {
    // Invalidate all existing tokens by incrementing tokenVersion
    await this.usersService.incrementTokenVersion(userId);

    this.logger.log(`User ${userId} logged out - all tokens invalidated`);
    return { message: 'Logged out successfully' };
  }

  async refreshTokens(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      const user = await this.usersService.findById(payload.sub);
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Check if token version matches - if not, token has been invalidated by logout
      if (payload.tokenVersion !== undefined && payload.tokenVersion !== user.tokenVersion) {
        this.logger.warn(`Token version mismatch for user ${user.email} - token invalidated`);
        throw new UnauthorizedException('Token has been invalidated');
      }

      // Preserve rememberMe preference from the original token
      const rememberMe = payload.rememberMe || false;
      const tokens = await this.generateTokens(user.id, user.email, user.role, rememberMe, user.tokenVersion);

      // Get profile picture URL if exists
      const profilePictureUrl = await this.getProfilePictureUrl(user.profilePicturePath);

      // Return user object along with tokens (frontend expects this)
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
    } catch {
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
      // Create new user from Google data (no password needed)
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      user = await this.usersService.create({
        email: googleUser.email,
        passwordHash: hashedPassword,
        firstName: googleUser.firstName || 'Usuario',
        lastName: googleUser.lastName || 'Google',
        googleId: googleUser.googleId,
      });

      this.logger.log(`New user created via Google OAuth: ${user.email}`);

      // TODO: Re-enable when needed
      // Send welcome email
      // this.emailService
      //   .sendWelcomeEmail(user.email, user.firstName)
      //   .catch((err) => this.logger.error('Failed to send welcome email', err));
    } else {
      // Update googleId if not set
      if (!user.googleId) {
        await this.usersService.updateGoogleId(user.id, googleUser.googleId);
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

    this.logger.log(`Google OAuth login successful for: ${user.email}`);

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

  private async generateTokens(
    userId: string,
    email: string,
    role: string,
    rememberMe: boolean = false,
    tokenVersion: number = 1,
  ) {
    // Include rememberMe and tokenVersion in payload for validation and persistence
    const payload = { sub: userId, email, role, rememberMe, tokenVersion };

    // Extended expiration for "Remember Me" option
    const accessTokenExpiry = rememberMe ? '7d' : '15m';
    const refreshTokenExpiry = rememberMe ? '30d' : '7d';

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: accessTokenExpiry,
    });
    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: refreshTokenExpiry,
    });

    this.logger.log(
      `Generated tokens for ${email} (rememberMe: ${rememberMe}, accessExpiry: ${accessTokenExpiry})`,
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: rememberMe ? 604800 : 900, // seconds (7 days or 15 min)
    };
  }
}
