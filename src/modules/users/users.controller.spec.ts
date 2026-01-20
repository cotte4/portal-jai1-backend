import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Users Controller Unit Tests
 *
 * Tests the UsersController's routing and request handling.
 * The actual business logic is tested in users.service.spec.ts.
 */

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<UsersService>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    phone: '+1234567890',
    role: 'client' as const,
    isActive: true,
    googleId: null,
    profilePicturePath: null,
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockUsersService = {
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    usersService = module.get(UsersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /users/me', () => {
    it('should return current user data', async () => {
      usersService.findById.mockResolvedValue(mockUser);

      const result = await controller.getMe({ id: 'user-123' });

      expect(usersService.findById).toHaveBeenCalledWith('user-123');
      expect(result).toEqual(mockUser);
    });

    it('should return null if user not found', async () => {
      usersService.findById.mockResolvedValue(null);

      const result = await controller.getMe({ id: 'nonexistent-user' });

      expect(usersService.findById).toHaveBeenCalledWith('nonexistent-user');
      expect(result).toBeNull();
    });

    it('should handle different user roles', async () => {
      const adminUser = { ...mockUser, role: 'admin' as const };
      usersService.findById.mockResolvedValue(adminUser);

      const result = await controller.getMe({ id: 'admin-user-123' });

      expect(result.role).toBe('admin');
    });

    it('should pass user id from JWT token correctly', async () => {
      usersService.findById.mockResolvedValue(mockUser);

      await controller.getMe({ id: 'specific-user-id-456' });

      expect(usersService.findById).toHaveBeenCalledWith('specific-user-id-456');
    });
  });
});
