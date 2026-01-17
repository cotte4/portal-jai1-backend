/**
 * Prisma Mock for Unit Testing
 *
 * This creates a mock PrismaClient that can be used in unit tests
 * to avoid hitting the real database.
 *
 * Usage in tests:
 * ```typescript
 * import { createMockPrismaService, MockPrismaService } from '../../test/prisma-mock';
 *
 * let prisma: MockPrismaService;
 *
 * beforeEach(() => {
 *   prisma = createMockPrismaService();
 * });
 *
 * it('should find user', async () => {
 *   prisma.user.findUnique.mockResolvedValue({ id: '123', email: 'test@test.com' });
 *   // ... test code
 * });
 * ```
 */

import { PrismaClient } from '@prisma/client';

// Type for mocked Prisma methods
type MockedFunction = jest.Mock<any, any>;

// Create a deep mock of an object where all methods are jest.fn()
function createDeepMock<T extends object>(): T {
  return new Proxy({} as T, {
    get: (target, prop) => {
      if (!(prop in target)) {
        (target as any)[prop] = jest.fn();
      }
      return (target as any)[prop];
    },
  });
}

// Type for our mocked Prisma service
export type MockPrismaService = {
  [K in keyof PrismaClient]: K extends `$${string}`
    ? MockedFunction
    : {
        findUnique: MockedFunction;
        findFirst: MockedFunction;
        findMany: MockedFunction;
        create: MockedFunction;
        createMany: MockedFunction;
        update: MockedFunction;
        updateMany: MockedFunction;
        delete: MockedFunction;
        deleteMany: MockedFunction;
        upsert: MockedFunction;
        count: MockedFunction;
        aggregate: MockedFunction;
        groupBy: MockedFunction;
      };
} & {
  $connect: MockedFunction;
  $disconnect: MockedFunction;
  $transaction: MockedFunction;
  $queryRaw: MockedFunction;
  $executeRaw: MockedFunction;
};

/**
 * Creates a mock PrismaService with all methods as jest.fn()
 * All model methods return undefined by default - use mockResolvedValue to set return values
 */
export function createMockPrismaService(): MockPrismaService {
  const mockPrisma: any = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn().mockImplementation((callback) => callback(mockPrisma)),
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
  };

  // List of Prisma models based on your schema
  const models = [
    'user',
    'clientProfile',
    'taxCase',
    'document',
    'ticket',
    'ticketMessage',
    'statusHistory',
    'notification',
    'referral',
    'discountApplication',
    'w2Estimate',
    'auditLog',
    'refreshToken',
  ];

  // Create mock methods for each model
  models.forEach((model) => {
    mockPrisma[model] = {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'mock-id', ...data })),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'mock-id', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'mock-id', ...create })),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({}),
      groupBy: jest.fn().mockResolvedValue([]),
    };
  });

  return mockPrisma as MockPrismaService;
}

/**
 * Helper to reset all mocks on a MockPrismaService
 */
export function resetPrismaMocks(prisma: MockPrismaService): void {
  Object.values(prisma).forEach((value) => {
    if (typeof value === 'function' && 'mockReset' in value) {
      (value as MockedFunction).mockReset();
    } else if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach((method) => {
        if (typeof method === 'function' && 'mockReset' in method) {
          (method as MockedFunction).mockReset();
        }
      });
    }
  });
}
