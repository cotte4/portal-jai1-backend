/**
 * AuthService Unit Tests
 *
 * These tests verify the business logic of AuthService in isolation.
 * All external dependencies (UsersService, JwtService, etc.) are mocked.
 *
 * Run with: npm run test:unit -- auth.service.spec.ts
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { ReferralsService } from '../referrals/referrals.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../../common/services';
import { SupabaseService } from '../../config/supabase.service';

import {
  createMockUser,
  createMockUsersService,
  createMockReferralsService,
  createMockJwtService,
  createMockConfigService,
  createMockEmailService,
  createMockNotificationsService,
  createMockAuditLogsService,
  createMockSupabaseService,
} from '../../../test/test-utils';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: ReturnType<typeof createMockUsersService>;
  let referralsService: ReturnType<typeof createMockReferralsService>;
  let jwtService: ReturnType<typeof createMockJwtService>;
  let notificationsService: ReturnType<typeof createMockNotificationsService>;
  let auditLogsService: ReturnType<typeof createMockAuditLogsService>;

  beforeEach(async () => {
    // Create fresh mocks for each test
    usersService = createMockUsersService();
    referralsService = createMockReferralsService();
    jwtService = createMockJwtService();
    const configService = createMockConfigService();
    const emailService = createMockEmailService();
    notificationsService = createMockNotificationsService();
    auditLogsService = createMockAuditLogsService();
    const supabaseService = createMockSupabaseService();

    // Build the testing module with mocked dependencies
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: ReferralsService, useValue: referralsService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: EmailService, useValue: emailService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: SupabaseService, useValue: supabaseService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  // Reset all mocks after each test
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    const validRegisterDto = {
      email: 'newuser@example.com',
      password: 'SecurePassword123!',
      first_name: 'John',
      last_name: 'Doe',
      phone: '+1234567890',
    };

    it('should successfully register a new user', async () => {
      // Arrange: Set up mocks
      const mockUser = createMockUser({
        id: 'new-user-id',
        email: validRegisterDto.email,
        firstName: validRegisterDto.first_name,
        lastName: validRegisterDto.last_name,
      });

      usersService.findByEmail.mockResolvedValue(null); // Email doesn't exist
      usersService.create.mockResolvedValue(mockUser);
      usersService.updateLastLogin.mockResolvedValue(undefined);
      usersService.createRefreshToken.mockResolvedValue(undefined);
      jwtService.sign.mockReturnValue('mock-jwt-token');

      // Act: Call the method
      const result = await authService.register(validRegisterDto);

      // Assert: Verify results
      expect(result).toBeDefined();
      expect(result.user.email).toBe(validRegisterDto.email);
      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.refresh_token).toBe('mock-jwt-token');

      // Verify the right methods were called
      expect(usersService.findByEmail).toHaveBeenCalledWith(validRegisterDto.email);
      expect(usersService.create).toHaveBeenCalled();
      expect(usersService.updateLastLogin).toHaveBeenCalledWith(mockUser.id);
    });

    it('should throw ConflictException if email already exists', async () => {
      // Arrange: Email already exists
      usersService.findByEmail.mockResolvedValue(createMockUser());

      // Act & Assert
      await expect(authService.register(validRegisterDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(authService.register(validRegisterDto)).rejects.toThrow(
        'Email already registered',
      );

      // Verify create was NOT called
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('should hash the password before storing', async () => {
      // Arrange
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockImplementation(async (data) => {
        // Verify the password is hashed, not plain text
        expect(data.passwordHash).not.toBe(validRegisterDto.password);
        // Verify it's a valid bcrypt hash
        const isValidHash = await bcrypt.compare(
          validRegisterDto.password,
          data.passwordHash,
        );
        expect(isValidHash).toBe(true);
        return createMockUser(data);
      });
      usersService.updateLastLogin.mockResolvedValue(undefined);
      usersService.createRefreshToken.mockResolvedValue(undefined);

      // Act
      await authService.register(validRegisterDto);

      // Assert: create was called (validation happens in mock)
      expect(usersService.create).toHaveBeenCalled();
    });

    it('should create referral record if valid referral code provided', async () => {
      // Arrange
      const referralCode = 'VALID123';
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(createMockUser({ id: 'new-user-id' }));
      usersService.updateLastLogin.mockResolvedValue(undefined);
      usersService.createRefreshToken.mockResolvedValue(undefined);

      referralsService.validateCode.mockResolvedValue({
        valid: true,
        referrerId: 'referrer-id',
        referrerName: 'Jane Doe',
      });
      referralsService.createReferral.mockResolvedValue(undefined);

      // Act
      await authService.register({
        ...validRegisterDto,
        referral_code: referralCode,
      });

      // Assert
      expect(referralsService.validateCode).toHaveBeenCalledWith(referralCode);
      expect(referralsService.createReferral).toHaveBeenCalledWith(
        'referrer-id',
        'new-user-id',
        referralCode,
      );
    });

    it('should throw BadRequestException for invalid referral code', async () => {
      // Arrange
      usersService.findByEmail.mockResolvedValue(null);
      referralsService.validateCode.mockResolvedValue({ valid: false });

      // Act & Assert
      await expect(
        authService.register({
          ...validRegisterDto,
          referral_code: 'INVALID',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        authService.register({
          ...validRegisterDto,
          referral_code: 'INVALID',
        }),
      ).rejects.toThrow('Invalid referral code');
    });

    it('should send welcome notification after registration', async () => {
      // Arrange
      const mockUser = createMockUser({ id: 'new-user-id', firstName: 'John' });
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(mockUser);
      usersService.updateLastLogin.mockResolvedValue(undefined);
      usersService.createRefreshToken.mockResolvedValue(undefined);

      // Act
      await authService.register(validRegisterDto);

      // Assert: Welcome notification was triggered (async, so we check it was called)
      // Note: Since it's fire-and-forget, we just verify the call was made
      expect(notificationsService.createFromTemplate).toHaveBeenCalledWith(
        mockUser.id,
        'system',
        'notifications.welcome',
        { firstName: mockUser.firstName },
      );
    });
  });

  describe('login', () => {
    const validLoginDto = {
      email: 'user@example.com',
      password: 'CorrectPassword123!',
    };

    it('should successfully login with valid credentials', async () => {
      // Arrange
      const hashedPassword = await bcrypt.hash(validLoginDto.password, 10);
      const mockUser = createMockUser({
        email: validLoginDto.email,
        passwordHash: hashedPassword,
        isActive: true,
      });

      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.updateLastLogin.mockResolvedValue(undefined);
      usersService.createRefreshToken.mockResolvedValue(undefined);
      jwtService.sign.mockReturnValue('mock-jwt-token');

      // Act
      const result = await authService.login(validLoginDto);

      // Assert
      expect(result).toBeDefined();
      expect(result.user.email).toBe(validLoginDto.email);
      expect(result.access_token).toBe('mock-jwt-token');
      expect(usersService.updateLastLogin).toHaveBeenCalledWith(mockUser.id);
    });

    it('should throw UnauthorizedException for non-existent email', async () => {
      // Arrange
      usersService.findByEmail.mockResolvedValue(null);

      // Act & Assert
      await expect(authService.login(validLoginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(authService.login(validLoginDto)).rejects.toThrow(
        'Invalid credentials',
      );

      // Verify audit log was created for failed login
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LOGIN_FAILED',
          details: expect.objectContaining({ reason: 'Email not found' }),
        }),
      );
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      // Arrange
      const hashedPassword = await bcrypt.hash('DifferentPassword', 10);
      const mockUser = createMockUser({
        email: validLoginDto.email,
        passwordHash: hashedPassword,
      });

      usersService.findByEmail.mockResolvedValue(mockUser);

      // Act & Assert
      await expect(authService.login(validLoginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(authService.login(validLoginDto)).rejects.toThrow(
        'Invalid credentials',
      );

      // Verify audit log was created
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LOGIN_FAILED',
          userId: mockUser.id,
          details: expect.objectContaining({ reason: 'Invalid password' }),
        }),
      );
    });

    it('should throw UnauthorizedException for deactivated account', async () => {
      // Arrange
      const hashedPassword = await bcrypt.hash(validLoginDto.password, 10);
      const mockUser = createMockUser({
        email: validLoginDto.email,
        passwordHash: hashedPassword,
        isActive: false, // Deactivated
      });

      usersService.findByEmail.mockResolvedValue(mockUser);

      // Act & Assert
      await expect(authService.login(validLoginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(authService.login(validLoginDto)).rejects.toThrow(
        'Account is deactivated',
      );
    });

    it('should respect rememberMe flag for token expiration', async () => {
      // Arrange
      const hashedPassword = await bcrypt.hash(validLoginDto.password, 10);
      const mockUser = createMockUser({
        email: validLoginDto.email,
        passwordHash: hashedPassword,
        isActive: true,
      });

      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.updateLastLogin.mockResolvedValue(undefined);
      usersService.createRefreshToken.mockResolvedValue(undefined);

      // Act: Login with rememberMe = true
      await authService.login({ ...validLoginDto, rememberMe: true });

      // Assert: JWT sign was called (we can verify the call was made)
      expect(jwtService.sign).toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('should return success message even for non-existent email (security)', async () => {
      // Arrange: Email doesn't exist
      usersService.findByEmail.mockResolvedValue(null);

      // Act
      const result = await authService.forgotPassword('nonexistent@example.com');

      // Assert: Same message to prevent email enumeration
      expect(result.message).toBe(
        'If the email exists, a reset link has been sent',
      );
      // Verify setResetToken was NOT called
      expect(usersService.setResetToken).not.toHaveBeenCalled();
    });

    it('should set reset token for existing user', async () => {
      // Arrange
      const mockUser = createMockUser({ email: 'existing@example.com' });
      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.setResetToken.mockResolvedValue(undefined);

      // Act
      const result = await authService.forgotPassword('existing@example.com');

      // Assert
      expect(result.message).toBe(
        'If the email exists, a reset link has been sent',
      );
      expect(usersService.setResetToken).toHaveBeenCalledWith(
        mockUser.id,
        expect.any(String), // Hashed token
        expect.any(Date), // Expiry date
      );
    });
  });

  describe('resetPassword', () => {
    it('should successfully reset password with valid token', async () => {
      // Arrange
      const mockUser = createMockUser();
      // The service hashes the token, so we need to mock findByResetToken
      usersService.findByResetToken.mockResolvedValue(mockUser);
      usersService.updatePassword.mockResolvedValue(undefined);
      usersService.incrementTokenVersion.mockResolvedValue(undefined);
      usersService.revokeAllUserRefreshTokens.mockResolvedValue(undefined);

      // Act
      const result = await authService.resetPassword('valid-token', 'NewPassword123!');

      // Assert
      expect(result.message).toBe('Password has been reset successfully');
      expect(usersService.updatePassword).toHaveBeenCalledWith(
        mockUser.id,
        expect.any(String), // Hashed new password
      );
      // Verify token version was incremented (invalidates all sessions)
      expect(usersService.incrementTokenVersion).toHaveBeenCalledWith(mockUser.id);
    });

    it('should throw BadRequestException for invalid token', async () => {
      // Arrange
      usersService.findByResetToken.mockResolvedValue(null);

      // Act & Assert
      await expect(
        authService.resetPassword('invalid-token', 'NewPassword123!'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        authService.resetPassword('invalid-token', 'NewPassword123!'),
      ).rejects.toThrow('Invalid or expired reset token');
    });

    it('should throw BadRequestException for password less than 8 characters', async () => {
      // Arrange
      const mockUser = createMockUser();
      usersService.findByResetToken.mockResolvedValue(mockUser);

      // Act & Assert
      await expect(
        authService.resetPassword('valid-token', 'short'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        authService.resetPassword('valid-token', 'short'),
      ).rejects.toThrow('Password must be at least 8 characters');
    });
  });

  describe('googleLogin', () => {
    const googleUser = {
      googleId: 'google-123',
      email: 'google@example.com',
      firstName: 'Google',
      lastName: 'User',
      picture: 'https://example.com/pic.jpg',
    };

    it('should create new user if email does not exist', async () => {
      // Arrange
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(
        createMockUser({
          id: 'new-google-user',
          email: googleUser.email,
          googleId: googleUser.googleId,
        }),
      );
      usersService.updateLastLogin.mockResolvedValue(undefined);
      usersService.createRefreshToken.mockResolvedValue(undefined);

      // Act
      const result = await authService.googleLogin(googleUser);

      // Assert
      expect(result).toBeDefined();
      expect(result.user.email).toBe(googleUser.email);
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: googleUser.email,
          googleId: googleUser.googleId,
        }),
      );
    });

    it('should link Google ID to existing user if email exists', async () => {
      // Arrange: User exists but without Google ID
      const existingUser = createMockUser({
        email: googleUser.email,
        googleId: null,
      });
      usersService.findByEmail.mockResolvedValue(existingUser);
      usersService.updateGoogleId.mockResolvedValue(undefined);
      usersService.updateLastLogin.mockResolvedValue(undefined);
      usersService.createRefreshToken.mockResolvedValue(undefined);

      // Act
      await authService.googleLogin(googleUser);

      // Assert
      expect(usersService.updateGoogleId).toHaveBeenCalledWith(
        existingUser.id,
        googleUser.googleId,
      );
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for deactivated account', async () => {
      // Arrange
      const deactivatedUser = createMockUser({
        email: googleUser.email,
        isActive: false,
      });
      usersService.findByEmail.mockResolvedValue(deactivatedUser);

      // Act & Assert
      await expect(authService.googleLogin(googleUser)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(authService.googleLogin(googleUser)).rejects.toThrow(
        'Account is deactivated',
      );
    });

    it('should throw BadRequestException if Google account has no email', async () => {
      // Act & Assert
      await expect(
        authService.googleLogin({
          ...googleUser,
          email: '', // No email
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
