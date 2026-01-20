import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * RolesGuard Unit Tests
 *
 * Tests the RolesGuard's role-based access control (RBAC) functionality.
 * Critical security tests to ensure proper authorization enforcement.
 */

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  const createMockExecutionContext = (userRole: string | null): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: userRole ? { id: 'user-123', email: 'test@example.com', role: userRole } : null,
        }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const mockReflector = {
      getAllAndOverride: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get(Reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('No roles required (public or authenticated-only endpoints)', () => {
    it('should allow access when no roles are required', () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);
      const context = createMockExecutionContext('client');

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should deny access when roles array is empty (no roles match)', () => {
      reflector.getAllAndOverride.mockReturnValue([]);
      const context = createMockExecutionContext('client');

      const result = guard.canActivate(context);

      // Empty array means no roles will match, so access denied
      // Note: requiredRoles.some() returns false for empty array
      expect(result).toBe(false);
    });
  });

  describe('Admin-only endpoints', () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
    });

    it('should ALLOW admin to access admin endpoints', () => {
      const context = createMockExecutionContext('admin');

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should DENY client from accessing admin endpoints', () => {
      const context = createMockExecutionContext('client');

      const result = guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should DENY unknown role from accessing admin endpoints', () => {
      const context = createMockExecutionContext('unknown');

      const result = guard.canActivate(context);

      expect(result).toBe(false);
    });
  });

  describe('Client-only endpoints', () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue(['client']);
    });

    it('should ALLOW client to access client endpoints', () => {
      const context = createMockExecutionContext('client');

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should DENY admin from accessing client-only endpoints', () => {
      const context = createMockExecutionContext('admin');

      const result = guard.canActivate(context);

      expect(result).toBe(false);
    });
  });

  describe('Multiple roles allowed', () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue(['admin', 'client']);
    });

    it('should ALLOW admin when admin or client is allowed', () => {
      const context = createMockExecutionContext('admin');

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should ALLOW client when admin or client is allowed', () => {
      const context = createMockExecutionContext('client');

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should DENY unknown role when admin or client is allowed', () => {
      const context = createMockExecutionContext('superadmin');

      const result = guard.canActivate(context);

      expect(result).toBe(false);
    });
  });

  describe('Edge cases and security scenarios', () => {
    it('should DENY access when user is null', () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ user: null }),
        }),
        getHandler: () => jest.fn(),
        getClass: () => jest.fn(),
      } as unknown as ExecutionContext;

      // This will throw because user.role is accessed on null
      expect(() => guard.canActivate(context)).toThrow();
    });

    it('should DENY access when user is undefined', () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ user: undefined }),
        }),
        getHandler: () => jest.fn(),
        getClass: () => jest.fn(),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(context)).toThrow();
    });

    it('should DENY access when user role is undefined', () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 'user-123', role: undefined } }),
        }),
        getHandler: () => jest.fn(),
        getClass: () => jest.fn(),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should DENY access when user role is empty string', () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 'user-123', email: 'test@example.com', role: '' },
          }),
        }),
        getHandler: () => jest.fn(),
        getClass: () => jest.fn(),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should be case-sensitive for role matching', () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const context = createMockExecutionContext('Admin'); // Capital A

      const result = guard.canActivate(context);

      expect(result).toBe(false); // Should not match 'admin'
    });

    it('should not allow role injection via whitespace', () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const context = createMockExecutionContext(' admin'); // Leading space

      const result = guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should not allow role injection via null characters', () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const context = createMockExecutionContext('admin\x00');

      const result = guard.canActivate(context);

      expect(result).toBe(false);
    });
  });

  describe('Reflector integration', () => {
    it('should call reflector with correct arguments', () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const mockHandler = jest.fn();
      const mockClass = jest.fn();

      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ user: { role: 'admin' } }),
        }),
        getHandler: () => mockHandler,
        getClass: () => mockClass,
      } as unknown as ExecutionContext;

      guard.canActivate(context);

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
        ROLES_KEY,
        [mockHandler, mockClass],
      );
    });
  });
});
