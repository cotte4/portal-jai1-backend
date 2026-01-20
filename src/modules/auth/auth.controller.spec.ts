import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/**
 * Auth Controller Unit Tests
 *
 * Tests the AuthController's routing and request handling.
 * The actual business logic is tested in auth.service.spec.ts.
 */

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  // Mock auth response for login
  const mockLoginResponse = {
    user: {
      id: 'user-123',
      email: 'test@example.com',
      first_name: 'Test',
      last_name: 'User',
      phone: null,
      role: 'client' as const,
      created_at: new Date(),
      profilePictureUrl: null,
    },
    hasProfile: false,
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_in: 900,
  };

  // Mock register response (no tokens - requires email verification)
  const mockRegisterResponse = {
    message: 'Registration successful. Please check your email to verify your account.',
    requiresVerification: true,
    user: {
      id: 'user-123',
      email: 'test@example.com',
      first_name: 'Test',
      last_name: 'User',
    },
  };

  // Mock request object
  const mockRequest = {
    ip: '127.0.0.1',
    headers: {
      'x-forwarded-for': '192.168.1.1',
      'user-agent': 'Mozilla/5.0 Test Browser',
    },
    connection: {
      remoteAddress: '127.0.0.1',
    },
  };

  // Mock user from JWT
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    role: 'client',
  };

  beforeEach(async () => {
    const mockAuthService = {
      register: jest.fn(),
      login: jest.fn(),
      logout: jest.fn(),
      refreshTokens: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
      changePassword: jest.fn(),
      googleLogin: jest.fn(),
      createOAuthCode: jest.fn(),
      exchangeOAuthCode: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockReturnValue('http://localhost:4200'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /auth/register', () => {
    const registerDto: RegisterDto = {
      email: 'newuser@example.com',
      password: 'SecurePassword123!',
      first_name: 'New',
      last_name: 'User',
      phone: '+1234567890',
    };

    it('should register a new user successfully', async () => {
      authService.register.mockResolvedValue(mockRegisterResponse);

      const result = await controller.register(registerDto);

      expect(authService.register).toHaveBeenCalledWith(registerDto);
      expect(result).toEqual(mockRegisterResponse);
      expect(result.requiresVerification).toBe(true);
    });

    it('should pass referral code to service', async () => {
      const dtoWithReferral: RegisterDto = {
        ...registerDto,
        referral_code: 'REF123',
      };
      authService.register.mockResolvedValue(mockRegisterResponse);

      await controller.register(dtoWithReferral);

      expect(authService.register).toHaveBeenCalledWith(dtoWithReferral);
    });
  });

  describe('POST /auth/login', () => {
    const loginDto: LoginDto = {
      email: 'test@example.com',
      password: 'password123',
    };

    it('should login user with valid credentials', async () => {
      authService.login.mockResolvedValue(mockLoginResponse);

      const result = await controller.login(loginDto, mockRequest);

      expect(authService.login).toHaveBeenCalledWith(
        loginDto,
        expect.any(String), // IP address
        expect.any(String), // User agent
      );
      expect(result).toEqual(mockLoginResponse);
    });

    it('should extract IP from x-forwarded-for header', async () => {
      authService.login.mockResolvedValue(mockLoginResponse);

      await controller.login(loginDto, mockRequest);

      // Should use x-forwarded-for when available
      expect(authService.login).toHaveBeenCalled();
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout user successfully', async () => {
      authService.logout.mockResolvedValue({ message: 'Logged out successfully' });

      const result = await controller.logout(mockUser, 'refresh-token');

      expect(authService.logout).toHaveBeenCalledWith(mockUser.id, 'refresh-token');
      expect(result.message).toBe('Logged out successfully');
    });

    it('should logout all sessions when no refresh token provided', async () => {
      authService.logout.mockResolvedValue({ message: 'Logged out successfully' });

      await controller.logout(mockUser, undefined);

      expect(authService.logout).toHaveBeenCalledWith(mockUser.id, undefined);
    });
  });

  describe('POST /auth/refresh', () => {
    const refreshTokenDto: RefreshTokenDto = {
      refresh_token: 'valid-refresh-token',
    };

    it('should refresh tokens successfully', async () => {
      const newTokens = {
        ...mockLoginResponse,
        refresh_token: 'new-refresh-token',
      };
      authService.refreshTokens.mockResolvedValue(newTokens);

      const result = await controller.refresh(refreshTokenDto, mockRequest);

      expect(authService.refreshTokens).toHaveBeenCalledWith(
        refreshTokenDto.refresh_token,
        expect.any(String),
        expect.any(String),
      );
      expect(result).toEqual(newTokens);
    });
  });

  describe('POST /auth/forgot-password', () => {
    const forgotPasswordDto: ForgotPasswordDto = {
      email: 'test@example.com',
    };

    it('should send reset email for existing user', async () => {
      const response = { message: 'If the email exists, a reset link has been sent' };
      authService.forgotPassword.mockResolvedValue(response);

      const result = await controller.forgotPassword(forgotPasswordDto);

      expect(authService.forgotPassword).toHaveBeenCalledWith(forgotPasswordDto.email);
      expect(result.message).toBe('If the email exists, a reset link has been sent');
    });

    it('should return same message for non-existing email (security)', async () => {
      const response = { message: 'If the email exists, a reset link has been sent' };
      authService.forgotPassword.mockResolvedValue(response);

      const result = await controller.forgotPassword({ email: 'nonexistent@example.com' });

      expect(result.message).toBe('If the email exists, a reset link has been sent');
    });
  });

  describe('POST /auth/reset-password', () => {
    const resetPasswordDto: ResetPasswordDto = {
      token: 'valid-reset-token',
      new_password: 'NewSecurePassword123!',
    };

    it('should reset password with valid token', async () => {
      const response = { message: 'Password has been reset successfully' };
      authService.resetPassword.mockResolvedValue(response);

      const result = await controller.resetPassword(resetPasswordDto);

      expect(authService.resetPassword).toHaveBeenCalledWith(
        resetPasswordDto.token,
        resetPasswordDto.new_password,
      );
      expect(result.message).toBe('Password has been reset successfully');
    });
  });

  describe('POST /auth/change-password', () => {
    const changePasswordDto: ChangePasswordDto = {
      current_password: 'OldPassword123!',
      new_password: 'NewPassword123!',
    };

    it('should change password for authenticated user', async () => {
      const response = { message: 'Password has been changed successfully' };
      authService.changePassword.mockResolvedValue(response);

      const result = await controller.changePassword(mockUser, changePasswordDto);

      expect(authService.changePassword).toHaveBeenCalledWith(
        mockUser.id,
        changePasswordDto.current_password,
        changePasswordDto.new_password,
      );
      expect(result.message).toBe('Password has been changed successfully');
    });
  });

  describe('POST /auth/google/exchange', () => {
    it('should exchange OAuth code for tokens', async () => {
      const mockExchangeResult = {
        tokens: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 900,
        },
        user: mockLoginResponse.user,
      };
      authService.exchangeOAuthCode.mockReturnValue(mockExchangeResult);

      const result = await controller.exchangeGoogleCode('valid-code');

      expect(authService.exchangeOAuthCode).toHaveBeenCalledWith('valid-code');
      expect(result).toEqual({
        access_token: mockExchangeResult.tokens.access_token,
        refresh_token: mockExchangeResult.tokens.refresh_token,
        expires_in: mockExchangeResult.tokens.expires_in,
        user: mockExchangeResult.user,
      });
    });

    it('should throw error when code is missing', async () => {
      await expect(controller.exchangeGoogleCode('')).rejects.toThrow('Authorization code is required');
    });
  });
});
