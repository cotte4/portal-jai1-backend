import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../config/prisma.service';

// Mock data
const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  passwordHash: 'hashed-password',
  firstName: 'John',
  lastName: 'Doe',
  phone: '+1234567890',
  role: 'client',
  isActive: true,
  googleId: null,
  profilePicturePath: null,
  tokenVersion: 0,
  resetToken: null,
  resetTokenExpiresAt: null,
  referredByCode: null,
  lastLoginAt: null,
  createdAt: new Date('2024-01-15'),
  updatedAt: new Date('2024-01-15'),
};

const mockRefreshToken = {
  id: 'token-1',
  userId: 'user-1',
  tokenHash: 'hashed-refresh-token',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  deviceInfo: 'Chrome on Windows',
  ipAddress: '192.168.1.1',
  isRevoked: false,
  revokedAt: null,
  replacedByTokenId: null,
  createdAt: new Date('2024-01-15'),
  user: mockUser,
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
    // Create mock Prisma service
    prisma = {
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a user with required fields', async () => {
      prisma.user.create.mockResolvedValue(mockUser);

      const result = await service.create({
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        firstName: 'John',
        lastName: 'Doe',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          passwordHash: 'hashed-password',
          firstName: 'John',
          lastName: 'Doe',
          phone: undefined,
          role: 'client',
          googleId: undefined,
          referredByCode: undefined,
        },
      });
      expect(result).toEqual(mockUser);
    });

    it('should create a user with optional fields', async () => {
      prisma.user.create.mockResolvedValue(mockUser);

      await service.create({
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        role: 'admin',
        googleId: 'google-123',
        referredByCode: 'REF123',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          phone: '+1234567890',
          role: 'admin',
          googleId: 'google-123',
          referredByCode: 'REF123',
        }),
      });
    });

    it('should default role to client if not specified', async () => {
      prisma.user.create.mockResolvedValue(mockUser);

      await service.create({
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        firstName: 'John',
        lastName: 'Doe',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: 'client',
        }),
      });
    });
  });

  describe('findByEmail', () => {
    it('should find user by email', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findByEmail('test@example.com');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should find user by id with selected fields', async () => {
      const userWithSelectedFields = {
        id: mockUser.id,
        email: mockUser.email,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        phone: mockUser.phone,
        role: mockUser.role,
        isActive: mockUser.isActive,
        googleId: mockUser.googleId,
        profilePicturePath: mockUser.profilePicturePath,
        tokenVersion: mockUser.tokenVersion,
        createdAt: mockUser.createdAt,
        updatedAt: mockUser.updatedAt,
      };
      prisma.user.findUnique.mockResolvedValue(userWithSelectedFields);

      const result = await service.findById('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
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
          createdAt: true,
          updatedAt: true,
        },
      });
      expect(result).toEqual(userWithSelectedFields);
    });

    it('should return null if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('updateGoogleId', () => {
    it('should update user googleId', async () => {
      prisma.user.update.mockResolvedValue({ ...mockUser, googleId: 'google-123' });

      const result = await service.updateGoogleId('user-1', 'google-123');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { googleId: 'google-123' },
      });
      expect(result.googleId).toBe('google-123');
    });
  });

  describe('updateLastLogin', () => {
    it('should update lastLoginAt timestamp', async () => {
      const now = new Date();
      prisma.user.update.mockResolvedValue({ ...mockUser, lastLoginAt: now });

      await service.updateLastLogin('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { lastLoginAt: expect.any(Date) },
      });
    });
  });

  describe('findAll', () => {
    it('should return all users ordered by createdAt desc', async () => {
      prisma.user.findMany.mockResolvedValue([mockUser]);

      const result = await service.findAll();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        skip: undefined,
        take: undefined,
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
      expect(result).toHaveLength(1);
    });

    it('should support pagination options', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.findAll({ skip: 10, take: 20 });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 20,
        }),
      );
    });
  });

  describe('setResetToken', () => {
    it('should set reset token and expiry', async () => {
      const expiresAt = new Date(Date.now() + 3600000); // 1 hour
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        resetToken: 'reset-token',
        resetTokenExpiresAt: expiresAt,
      });

      await service.setResetToken('user-1', 'reset-token', expiresAt);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          resetToken: 'reset-token',
          resetTokenExpiresAt: expiresAt,
        },
      });
    });
  });

  describe('findByResetToken', () => {
    it('should find user by valid reset token', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);

      const result = await service.findByResetToken('valid-token');

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          resetToken: 'valid-token',
          resetTokenExpiresAt: {
            gt: expect.any(Date),
          },
        },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null for invalid/expired token', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.findByResetToken('expired-token');

      expect(result).toBeNull();
    });
  });

  describe('updatePassword', () => {
    it('should update password and clear reset token', async () => {
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        passwordHash: 'new-hashed-password',
        resetToken: null,
        resetTokenExpiresAt: null,
      });

      await service.updatePassword('user-1', 'new-hashed-password');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          passwordHash: 'new-hashed-password',
          resetToken: null,
          resetTokenExpiresAt: null,
        },
      });
    });
  });

  describe('incrementTokenVersion', () => {
    it('should increment token version', async () => {
      prisma.user.update.mockResolvedValue({ ...mockUser, tokenVersion: 1 });

      const result = await service.incrementTokenVersion('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          tokenVersion: { increment: 1 },
        },
      });
      expect(result.tokenVersion).toBe(1);
    });
  });

  describe('Refresh Token Management', () => {
    describe('createRefreshToken', () => {
      it('should create a refresh token', async () => {
        prisma.refreshToken.create.mockResolvedValue(mockRefreshToken);

        const result = await service.createRefreshToken({
          userId: 'user-1',
          tokenHash: 'hashed-refresh-token',
          expiresAt: mockRefreshToken.expiresAt,
          deviceInfo: 'Chrome on Windows',
          ipAddress: '192.168.1.1',
        });

        expect(prisma.refreshToken.create).toHaveBeenCalledWith({
          data: {
            userId: 'user-1',
            tokenHash: 'hashed-refresh-token',
            expiresAt: mockRefreshToken.expiresAt,
            deviceInfo: 'Chrome on Windows',
            ipAddress: '192.168.1.1',
          },
        });
        expect(result).toEqual(mockRefreshToken);
      });

      it('should create refresh token without optional fields', async () => {
        prisma.refreshToken.create.mockResolvedValue(mockRefreshToken);

        await service.createRefreshToken({
          userId: 'user-1',
          tokenHash: 'hashed-token',
          expiresAt: new Date(),
        });

        expect(prisma.refreshToken.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            deviceInfo: undefined,
            ipAddress: undefined,
          }),
        });
      });
    });

    describe('findRefreshTokenByHash', () => {
      it('should find refresh token by hash with user', async () => {
        prisma.refreshToken.findUnique.mockResolvedValue(mockRefreshToken);

        const result = await service.findRefreshTokenByHash('hashed-refresh-token');

        expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
          where: { tokenHash: 'hashed-refresh-token' },
          include: { user: true },
        });
        expect(result).toEqual(mockRefreshToken);
        expect(result?.user).toEqual(mockUser);
      });

      it('should return null if token not found', async () => {
        prisma.refreshToken.findUnique.mockResolvedValue(null);

        const result = await service.findRefreshTokenByHash('nonexistent-hash');

        expect(result).toBeNull();
      });
    });

    describe('revokeRefreshToken', () => {
      it('should revoke a refresh token', async () => {
        prisma.refreshToken.update.mockResolvedValue({
          ...mockRefreshToken,
          isRevoked: true,
          revokedAt: new Date(),
        });

        await service.revokeRefreshToken('hashed-refresh-token');

        expect(prisma.refreshToken.update).toHaveBeenCalledWith({
          where: { tokenHash: 'hashed-refresh-token' },
          data: {
            isRevoked: true,
            revokedAt: expect.any(Date),
            replacedByTokenId: undefined,
          },
        });
      });

      it('should revoke and set replacement token id', async () => {
        prisma.refreshToken.update.mockResolvedValue({
          ...mockRefreshToken,
          isRevoked: true,
          replacedByTokenId: 'new-token-id',
        });

        await service.revokeRefreshToken('hashed-refresh-token', 'new-token-id');

        expect(prisma.refreshToken.update).toHaveBeenCalledWith({
          where: { tokenHash: 'hashed-refresh-token' },
          data: expect.objectContaining({
            replacedByTokenId: 'new-token-id',
          }),
        });
      });
    });

    describe('revokeAllUserRefreshTokens', () => {
      it('should revoke all active tokens for a user', async () => {
        prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

        const result = await service.revokeAllUserRefreshTokens('user-1');

        expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
          where: {
            userId: 'user-1',
            isRevoked: false,
          },
          data: {
            isRevoked: true,
            revokedAt: expect.any(Date),
          },
        });
        expect(result.count).toBe(3);
      });
    });

    describe('revokeRefreshTokenById', () => {
      it('should revoke a token by its id', async () => {
        prisma.refreshToken.update.mockResolvedValue({
          ...mockRefreshToken,
          isRevoked: true,
        });

        await service.revokeRefreshTokenById('token-1');

        expect(prisma.refreshToken.update).toHaveBeenCalledWith({
          where: { id: 'token-1' },
          data: {
            isRevoked: true,
            revokedAt: expect.any(Date),
          },
        });
      });
    });

    describe('cleanupExpiredRefreshTokens', () => {
      it('should delete expired and old revoked tokens', async () => {
        prisma.refreshToken.deleteMany.mockResolvedValue({ count: 15 });

        const result = await service.cleanupExpiredRefreshTokens();

        expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
          where: {
            OR: [
              { expiresAt: { lt: expect.any(Date) } },
              {
                isRevoked: true,
                revokedAt: { lt: expect.any(Date) },
              },
            ],
          },
        });
        expect(result.count).toBe(15);
      });

      it('should return 0 when no tokens to clean', async () => {
        prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

        const result = await service.cleanupExpiredRefreshTokens();

        expect(result.count).toBe(0);
      });
    });
  });
});
