import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../../users/users.service';

/**
 * JWT Strategy Unit Tests
 *
 * Tests the JWT authentication strategy including token validation,
 * user lookup, and security scenarios.
 */

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: jest.Mocked<UsersService>;

  const mockActiveUser = {
    id: 'user-123',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    role: 'client' as const,
    isActive: true,
    phone: null,
    googleId: null,
    profilePicturePath: null,
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockInactiveUser = {
    ...mockActiveUser,
    isActive: false,
  };

  const mockAdminUser = {
    ...mockActiveUser,
    id: 'admin-123',
    email: 'admin@example.com',
    role: 'admin' as const,
  };

  beforeEach(async () => {
    const mockUsersService = {
      findById: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockReturnValue('test-jwt-secret-key-32chars!!'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: UsersService, useValue: mockUsersService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    usersService = module.get(UsersService);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('constructor', () => {
    it('should throw error if JWT_SECRET is not defined', async () => {
      const mockConfigService = {
        get: jest.fn().mockReturnValue(undefined),
      };

      await expect(
        Test.createTestingModule({
          providers: [
            JwtStrategy,
            { provide: UsersService, useValue: { findById: jest.fn() } },
            { provide: ConfigService, useValue: mockConfigService },
          ],
        }).compile(),
      ).rejects.toThrow('JWT_SECRET must be defined');
    });

    it('should throw error if JWT_SECRET is empty string', async () => {
      const mockConfigService = {
        get: jest.fn().mockReturnValue(''),
      };

      await expect(
        Test.createTestingModule({
          providers: [
            JwtStrategy,
            { provide: UsersService, useValue: { findById: jest.fn() } },
            { provide: ConfigService, useValue: mockConfigService },
          ],
        }).compile(),
      ).rejects.toThrow('JWT_SECRET must be defined');
    });
  });

  describe('validate', () => {
    describe('Valid tokens with active users', () => {
      it('should return user data for valid payload with active client', async () => {
        usersService.findById.mockResolvedValue(mockActiveUser);

        const payload = { sub: 'user-123', email: 'test@example.com', role: 'client' };
        const result = await strategy.validate(payload);

        expect(usersService.findById).toHaveBeenCalledWith('user-123');
        expect(result).toEqual({
          id: mockActiveUser.id,
          email: mockActiveUser.email,
          role: mockActiveUser.role,
          firstName: mockActiveUser.firstName,
          lastName: mockActiveUser.lastName,
        });
      });

      it('should return user data for valid payload with active admin', async () => {
        usersService.findById.mockResolvedValue(mockAdminUser);

        const payload = { sub: 'admin-123', email: 'admin@example.com', role: 'admin' };
        const result = await strategy.validate(payload);

        expect(result.role).toBe('admin');
        expect(result.id).toBe('admin-123');
      });
    });

    describe('Invalid tokens - User not found', () => {
      it('should throw UnauthorizedException when user not found', async () => {
        usersService.findById.mockResolvedValue(null);

        const payload = { sub: 'nonexistent-user', email: 'test@example.com', role: 'client' };

        await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      });

      it('should throw UnauthorizedException for deleted user', async () => {
        usersService.findById.mockResolvedValue(null);

        const payload = { sub: 'deleted-user-456', email: 'deleted@example.com', role: 'client' };

        await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      });
    });

    describe('Invalid tokens - Inactive users', () => {
      it('should throw UnauthorizedException for inactive user', async () => {
        usersService.findById.mockResolvedValue(mockInactiveUser);

        const payload = { sub: 'user-123', email: 'test@example.com', role: 'client' };

        await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      });

      it('should throw UnauthorizedException for banned/deactivated admin', async () => {
        const inactiveAdmin = { ...mockAdminUser, isActive: false };
        usersService.findById.mockResolvedValue(inactiveAdmin);

        const payload = { sub: 'admin-123', email: 'admin@example.com', role: 'admin' };

        await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      });
    });

    describe('Malformed payloads', () => {
      it('should handle payload with missing sub field', async () => {
        usersService.findById.mockResolvedValue(null);

        const payload = { email: 'test@example.com', role: 'client' } as any;

        // findById will be called with undefined
        await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
        expect(usersService.findById).toHaveBeenCalledWith(undefined);
      });

      it('should handle payload with null sub field', async () => {
        usersService.findById.mockResolvedValue(null);

        const payload = { sub: null, email: 'test@example.com', role: 'client' } as any;

        await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      });

      it('should handle payload with empty sub field', async () => {
        usersService.findById.mockResolvedValue(null);

        const payload = { sub: '', email: 'test@example.com', role: 'client' };

        await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      });
    });

    describe('Security scenarios', () => {
      it('should use sub from payload to find user (not email or role)', async () => {
        // Even if email/role in payload differ, we use sub for lookup
        usersService.findById.mockResolvedValue(mockActiveUser);

        const payload = {
          sub: 'user-123',
          email: 'different@example.com', // Different email
          role: 'admin' // Different role - potential privilege escalation attempt
        };

        const result = await strategy.validate(payload);

        // Should return actual user data from DB, not from payload
        expect(result.email).toBe(mockActiveUser.email);
        expect(result.role).toBe(mockActiveUser.role); // 'client', not 'admin'
      });

      it('should return fresh role from database (prevents role escalation)', async () => {
        // User tries to use old token after role was downgraded
        const downgradedUser = { ...mockActiveUser, role: 'client' as const };
        usersService.findById.mockResolvedValue(downgradedUser);

        const payload = { sub: 'user-123', email: 'test@example.com', role: 'admin' };

        const result = await strategy.validate(payload);

        // Role should come from DB, not from token
        expect(result.role).toBe('client');
      });

      it('should check isActive status on every request', async () => {
        // First call - user is active
        usersService.findById.mockResolvedValueOnce(mockActiveUser);
        const payload = { sub: 'user-123', email: 'test@example.com', role: 'client' };

        const result1 = await strategy.validate(payload);
        expect(result1.id).toBe('user-123');

        // Second call - user was deactivated
        usersService.findById.mockResolvedValueOnce(mockInactiveUser);

        await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      });

      it('should handle SQL injection attempt in sub field', async () => {
        usersService.findById.mockResolvedValue(null);

        const payload = {
          sub: "'; DROP TABLE users; --",
          email: 'test@example.com',
          role: 'client'
        };

        // Should safely pass the malicious string to findById (Prisma will handle it safely)
        await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
        expect(usersService.findById).toHaveBeenCalledWith("'; DROP TABLE users; --");
      });

      it('should handle extremely long sub field', async () => {
        usersService.findById.mockResolvedValue(null);

        const payload = {
          sub: 'a'.repeat(10000),
          email: 'test@example.com',
          role: 'client'
        };

        await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      });
    });

    describe('Database errors', () => {
      it('should propagate database errors', async () => {
        usersService.findById.mockRejectedValue(new Error('Database connection failed'));

        const payload = { sub: 'user-123', email: 'test@example.com', role: 'client' };

        await expect(strategy.validate(payload)).rejects.toThrow('Database connection failed');
      });
    });
  });
});
