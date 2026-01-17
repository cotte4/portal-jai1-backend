import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogsService } from './audit-logs.service';
import { PrismaService } from '../../config/prisma.service';
import { AuditAction } from '@prisma/client';

// Mock data
const mockUser = {
  id: 'user-1',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
};

const mockAdminUser = {
  id: 'admin-1',
  firstName: 'Admin',
  lastName: 'User',
  email: 'admin@example.com',
};

const mockAuditLog = {
  id: 'log-1',
  action: AuditAction.LOGIN_FAILED,
  userId: 'user-1',
  targetUserId: null,
  details: { browser: 'Chrome' },
  ipAddress: '192.168.1.1',
  userAgent: 'Mozilla/5.0',
  createdAt: new Date('2024-01-15'),
};

const mockRefundUpdateLog = {
  id: 'log-2',
  action: AuditAction.REFUND_UPDATE,
  userId: 'admin-1',
  targetUserId: 'user-1',
  details: { oldAmount: 1000, newAmount: 1500 },
  ipAddress: '192.168.1.100',
  userAgent: 'Mozilla/5.0',
  createdAt: new Date('2024-01-16'),
};

describe('AuditLogsService', () => {
  let service: AuditLogsService;
  let prisma: any;

  beforeEach(async () => {
    // Create mock Prisma service
    prisma = {
      auditLog: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AuditLogsService>(AuditLogsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should create an audit log entry', async () => {
      prisma.auditLog.create.mockResolvedValue(mockAuditLog);

      await service.log({
        action: AuditAction.LOGIN_FAILED,
        userId: 'user-1',
        details: { browser: 'Chrome' },
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          action: AuditAction.LOGIN_FAILED,
          userId: 'user-1',
          targetUserId: undefined,
          details: { browser: 'Chrome' },
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        },
      });
    });

    it('should create log with target user', async () => {
      prisma.auditLog.create.mockResolvedValue(mockRefundUpdateLog);

      await service.log({
        action: AuditAction.REFUND_UPDATE,
        userId: 'admin-1',
        targetUserId: 'user-1',
        details: { oldAmount: 1000, newAmount: 1500 },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'admin-1',
          targetUserId: 'user-1',
        }),
      });
    });

    it('should not throw on database error', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('DB error'));

      // Should not throw - silently logs error
      await expect(
        service.log({
          action: AuditAction.PASSWORD_CHANGE,
          userId: 'user-1',
        }),
      ).resolves.not.toThrow();
    });

    it('should handle log without optional fields', async () => {
      prisma.auditLog.create.mockResolvedValue(mockAuditLog);

      await service.log({
        action: AuditAction.PASSWORD_RESET,
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          action: AuditAction.PASSWORD_RESET,
          userId: undefined,
          targetUserId: undefined,
          details: undefined,
          ipAddress: undefined,
          userAgent: undefined,
        },
      });
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      prisma.user.findMany.mockResolvedValue([mockUser, mockAdminUser]);
    });

    it('should return paginated logs with user info', async () => {
      prisma.auditLog.findMany.mockResolvedValue([mockAuditLog]);
      prisma.auditLog.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result.data).toHaveLength(1);
      expect(result.data[0].userName).toBe('John Doe');
      expect(result.pagination).toEqual({
        page: 1,
        limit: 50,
        total: 1,
        totalPages: 1,
      });
    });

    it('should filter by userId', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ userId: 'user-1' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
        }),
      );
    });

    it('should filter by targetUserId', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ targetUserId: 'user-1' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { targetUserId: 'user-1' },
        }),
      );
    });

    it('should filter by action', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ action: AuditAction.PASSWORD_CHANGE });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { action: AuditAction.PASSWORD_CHANGE },
        }),
      );
    });

    it('should filter by date range', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdAt: {
              gte: new Date('2024-01-01'),
              lte: new Date('2024-01-31'),
            },
          },
        }),
      );
    });

    it('should handle pagination', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(100);

      const result = await service.findAll({ page: 3, limit: 20 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 40, // (3-1) * 20
          take: 20,
        }),
      );
      expect(result.pagination.totalPages).toBe(5);
    });

    it('should include target user info', async () => {
      prisma.auditLog.findMany.mockResolvedValue([mockRefundUpdateLog]);
      prisma.auditLog.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result.data[0].targetUserName).toBe('John Doe');
      expect(result.data[0].targetUserEmail).toBe('john@example.com');
    });
  });

  describe('findByUser', () => {
    beforeEach(() => {
      prisma.user.findMany.mockResolvedValue([mockUser]);
    });

    it('should find logs where user is actor OR target', async () => {
      prisma.auditLog.findMany.mockResolvedValue([mockAuditLog, mockRefundUpdateLog]);
      prisma.auditLog.count.mockResolvedValue(2);

      const result = await service.findByUser('user-1');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ userId: 'user-1' }, { targetUserId: 'user-1' }],
          },
        }),
      );
      expect(result.data).toHaveLength(2);
    });

    it('should handle pagination', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findByUser('user-1', 2, 25);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 25, // (2-1) * 25
          take: 25,
        }),
      );
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      prisma.auditLog.count.mockResolvedValue(100);
      prisma.auditLog.groupBy.mockImplementation(({ by }) => {
        if (by.includes('action')) {
          return Promise.resolve([
            { action: AuditAction.PASSWORD_CHANGE, _count: { action: 50 } },
            { action: AuditAction.LOGIN_FAILED, _count: { action: 30 } },
          ]);
        }
        if (by.includes('userId')) {
          return Promise.resolve([
            { userId: 'user-1', _count: { userId: 40 } },
          ]);
        }
        return Promise.resolve([]);
      });
      prisma.auditLog.findMany.mockResolvedValue([
        { createdAt: new Date('2024-01-15') },
        { createdAt: new Date('2024-01-15') },
        { createdAt: new Date('2024-01-16') },
      ]);
      prisma.user.findMany.mockResolvedValue([mockUser]);

      const result = await service.getStats();

      expect(result.totalLogs).toBe(100);
      expect(result.actionBreakdown).toHaveLength(2);
      expect(result.actionBreakdown[0].action).toBe(AuditAction.PASSWORD_CHANGE);
      expect(result.dailyCounts).toBeDefined();
      expect(result.topActors).toBeDefined();
    });

    it('should filter by date range', async () => {
      prisma.auditLog.count.mockResolvedValue(50);
      prisma.auditLog.groupBy.mockResolvedValue([]);
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      await service.getStats('2024-01-01', '2024-01-31');

      expect(prisma.auditLog.count).toHaveBeenCalledWith({
        where: {
          createdAt: {
            gte: new Date('2024-01-01'),
            lte: new Date('2024-01-31'),
          },
        },
      });
    });

    it('should calculate daily counts correctly', async () => {
      prisma.auditLog.count.mockResolvedValue(3);
      prisma.auditLog.groupBy.mockResolvedValue([]);
      prisma.auditLog.findMany.mockResolvedValue([
        { createdAt: new Date('2024-01-15T10:00:00Z') },
        { createdAt: new Date('2024-01-15T15:00:00Z') },
        { createdAt: new Date('2024-01-16T10:00:00Z') },
      ]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.getStats();

      // Should have 2 days with counts
      expect(result.dailyCounts.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('exportToCsv', () => {
    it('should export logs to CSV format', async () => {
      prisma.auditLog.findMany.mockResolvedValue([mockAuditLog]);
      prisma.user.findMany.mockResolvedValue([mockUser]);

      const csv = await service.exportToCsv({});

      expect(csv).toContain('ID,Timestamp,Action');
      expect(csv).toContain('log-1');
      expect(csv).toContain('LOGIN_FAILED');
      expect(csv).toContain('John Doe');
    });

    it('should escape CSV values with commas', async () => {
      const logWithComma = {
        ...mockAuditLog,
        details: { description: 'Hello, World' },
      };
      prisma.auditLog.findMany.mockResolvedValue([logWithComma]);
      prisma.user.findMany.mockResolvedValue([mockUser]);

      const csv = await service.exportToCsv({});

      // Values with commas should be quoted
      expect(csv).toContain('"');
    });

    it('should limit export to 10k records', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      await service.exportToCsv({});

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10000,
        }),
      );
    });

    it('should apply filters to export', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      await service.exportToCsv({
        userId: 'user-1',
        action: AuditAction.PASSWORD_CHANGE,
        dateFrom: '2024-01-01',
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            action: AuditAction.PASSWORD_CHANGE,
            createdAt: {
              gte: new Date('2024-01-01'),
            },
          },
        }),
      );
    });

    it('should handle empty results', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      const csv = await service.exportToCsv({});

      // Should only have headers
      expect(csv).toContain('ID,Timestamp,Action');
      expect(csv.split('\n')).toHaveLength(1);
    });
  });

  describe('getAvailableActions', () => {
    it('should return all audit actions', () => {
      const actions = service.getAvailableActions();

      expect(actions).toContain(AuditAction.PASSWORD_CHANGE);
      expect(actions).toContain(AuditAction.PASSWORD_RESET);
      expect(actions).toContain(AuditAction.DOCUMENT_DELETE);
      expect(actions).toContain(AuditAction.LOGIN_FAILED);
      expect(Array.isArray(actions)).toBe(true);
    });
  });
});
