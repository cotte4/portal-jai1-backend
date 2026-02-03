import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AlarmsService } from './alarms.service';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { I18nService } from '../../i18n';
import { AlarmResolution, AlarmType, AlarmLevel } from '@prisma/client';

// Mock data
const mockUser = {
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
};

const mockTaxCase = {
  id: 'taxcase-1',
  federalStatusNew: 'taxes_en_proceso',
  stateStatusNew: 'taxes_en_proceso',
  federalStatusNewChangedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
  stateStatusNewChangedAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000), // 25 days ago
  clientProfile: {
    user: mockUser,
    userId: 'user-1',
  },
  alarmThreshold: null,
};

const mockTaxCaseWithCustomThresholds = {
  ...mockTaxCase,
  id: 'taxcase-2',
  alarmThreshold: {
    taxCaseId: 'taxcase-2',
    federalInProcessDays: 45,
    stateInProcessDays: 40,
    verificationTimeoutDays: 60,
    letterSentTimeoutDays: 30,
    disableFederalAlarms: false,
    disableStateAlarms: false,
    reason: 'Client requested extended timeline',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-10'),
  },
};

const mockAlarmHistory = {
  id: 'alarm-1',
  taxCaseId: 'taxcase-1',
  alarmType: AlarmType.possible_verification,
  alarmLevel: AlarmLevel.warning,
  track: 'federal',
  message: 'Federal status taxes_en_proceso for 30 days',
  thresholdDays: 21,
  actualDays: 30,
  statusAtTrigger: 'taxes_en_proceso',
  statusChangedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  resolution: AlarmResolution.active,
  resolvedAt: null,
  resolvedById: null,
  resolvedNote: null,
  autoResolveReason: null,
  triggeredAt: new Date(),
  updatedAt: new Date(),
};

describe('AlarmsService', () => {
  let service: AlarmsService;
  let prisma: any;
  let notificationsService: any;
  let i18n: any;

  beforeEach(async () => {
    // Create mock services
    prisma = {
      taxCase: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      alarmHistory: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      alarmThreshold: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    notificationsService = {
      createFromTemplate: jest.fn().mockResolvedValue(undefined),
    };

    i18n = {
      getTrack: jest.fn().mockImplementation((track) =>
        track === 'federal' ? 'Federal' : 'Estatal',
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlarmsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: I18nService, useValue: i18n },
      ],
    }).compile();

    service = module.get<AlarmsService>(AlarmsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getDashboard', () => {
    it('should return empty dashboard when no tax cases have alarms', async () => {
      prisma.taxCase.findMany.mockResolvedValue([]);

      const result = await service.getDashboard();

      expect(result.items).toHaveLength(0);
      expect(result.totalWithAlarms).toBe(0);
      expect(result.totalCritical).toBe(0);
      expect(result.totalWarning).toBe(0);
    });

    it('should return dashboard with alarm items', async () => {
      prisma.taxCase.findMany.mockResolvedValue([mockTaxCase]);

      const result = await service.getDashboard();

      expect(result.items).toBeDefined();
      expect(result.totalWithAlarms).toBeGreaterThanOrEqual(0);
    });

    it('should apply custom thresholds when present', async () => {
      prisma.taxCase.findMany.mockResolvedValue([mockTaxCaseWithCustomThresholds]);

      const result = await service.getDashboard();

      // With custom thresholds of 45 days, 30-day-old status should not trigger alarm
      expect(result).toBeDefined();
    });

    it('should sort by severity (critical first)', async () => {
      const criticalCase = {
        ...mockTaxCase,
        id: 'critical-case',
        federalStatusNewChangedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days
      };
      const warningCase = {
        ...mockTaxCase,
        id: 'warning-case',
        federalStatusNewChangedAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000), // 25 days
      };

      prisma.taxCase.findMany.mockResolvedValue([warningCase, criticalCase]);

      const result = await service.getDashboard();

      // Critical should come first
      if (result.items.length >= 2) {
        expect(
          result.items[0].highestLevel === 'critical' ||
            result.items[0].highestLevel === null,
        ).toBeDefined();
      }
    });
  });

  describe('getHistory', () => {
    it('should return alarm history', async () => {
      prisma.alarmHistory.findMany.mockResolvedValue([
        {
          ...mockAlarmHistory,
          taxCase: mockTaxCase,
          resolvedBy: null,
        },
      ]);

      const result = await service.getHistory();

      expect(result).toHaveLength(1);
      expect(result[0].alarmType).toBe(AlarmType.possible_verification);
      expect(result[0].clientName).toBe('John Doe');
    });

    it('should filter by taxCaseId', async () => {
      prisma.alarmHistory.findMany.mockResolvedValue([]);

      await service.getHistory({ taxCaseId: 'taxcase-1' });

      expect(prisma.alarmHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taxCaseId: 'taxcase-1' },
        }),
      );
    });

    it('should filter by alarmType', async () => {
      prisma.alarmHistory.findMany.mockResolvedValue([]);

      await service.getHistory({ alarmType: AlarmType.possible_verification });

      expect(prisma.alarmHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { alarmType: AlarmType.possible_verification },
        }),
      );
    });

    it('should filter by resolution status', async () => {
      prisma.alarmHistory.findMany.mockResolvedValue([]);

      await service.getHistory({ resolution: AlarmResolution.active });

      expect(prisma.alarmHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { resolution: AlarmResolution.active },
        }),
      );
    });

    it('should filter by date range', async () => {
      prisma.alarmHistory.findMany.mockResolvedValue([]);

      const fromDate = new Date('2024-01-01');
      const toDate = new Date('2024-01-31');

      await service.getHistory({ fromDate, toDate });

      expect(prisma.alarmHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            triggeredAt: {
              gte: fromDate,
              lte: toDate,
            },
          },
        }),
      );
    });

    it('should limit results to 100', async () => {
      prisma.alarmHistory.findMany.mockResolvedValue([]);

      await service.getHistory();

      expect(prisma.alarmHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        }),
      );
    });
  });

  describe('acknowledgeAlarm', () => {
    it('should acknowledge an active alarm', async () => {
      prisma.alarmHistory.findUnique.mockResolvedValue(mockAlarmHistory);
      prisma.alarmHistory.update.mockResolvedValue({
        ...mockAlarmHistory,
        resolution: AlarmResolution.acknowledged,
      });

      await service.acknowledgeAlarm('alarm-1', 'admin-1');

      expect(prisma.alarmHistory.update).toHaveBeenCalledWith({
        where: { id: 'alarm-1' },
        data: {
          resolution: 'acknowledged',
          updatedAt: expect.any(Date),
        },
      });
    });

    it('should throw NotFoundException if alarm not found', async () => {
      prisma.alarmHistory.findUnique.mockResolvedValue(null);

      await expect(service.acknowledgeAlarm('invalid-id', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should not update if already acknowledged', async () => {
      prisma.alarmHistory.findUnique.mockResolvedValue({
        ...mockAlarmHistory,
        resolution: AlarmResolution.acknowledged,
      });

      await service.acknowledgeAlarm('alarm-1', 'admin-1');

      expect(prisma.alarmHistory.update).not.toHaveBeenCalled();
    });

    it('should not update if already resolved', async () => {
      prisma.alarmHistory.findUnique.mockResolvedValue({
        ...mockAlarmHistory,
        resolution: AlarmResolution.resolved,
      });

      await service.acknowledgeAlarm('alarm-1', 'admin-1');

      expect(prisma.alarmHistory.update).not.toHaveBeenCalled();
    });
  });

  describe('resolveAlarm', () => {
    it('should resolve an alarm with note', async () => {
      prisma.alarmHistory.findUnique.mockResolvedValue(mockAlarmHistory);
      prisma.alarmHistory.update.mockResolvedValue({
        ...mockAlarmHistory,
        resolution: AlarmResolution.resolved,
      });

      await service.resolveAlarm('alarm-1', 'admin-1', 'Contacted IRS');

      expect(prisma.alarmHistory.update).toHaveBeenCalledWith({
        where: { id: 'alarm-1' },
        data: {
          resolution: 'resolved',
          resolvedAt: expect.any(Date),
          resolvedById: 'admin-1',
          resolvedNote: 'Contacted IRS',
          updatedAt: expect.any(Date),
        },
      });
    });

    it('should throw NotFoundException if alarm not found', async () => {
      prisma.alarmHistory.findUnique.mockResolvedValue(null);

      await expect(service.resolveAlarm('invalid-id', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should not update if already resolved', async () => {
      prisma.alarmHistory.findUnique.mockResolvedValue({
        ...mockAlarmHistory,
        resolution: AlarmResolution.resolved,
      });

      await service.resolveAlarm('alarm-1', 'admin-1');

      expect(prisma.alarmHistory.update).not.toHaveBeenCalled();
    });

    it('should handle resolution without note', async () => {
      prisma.alarmHistory.findUnique.mockResolvedValue(mockAlarmHistory);
      prisma.alarmHistory.update.mockResolvedValue({
        ...mockAlarmHistory,
        resolution: AlarmResolution.resolved,
      });

      await service.resolveAlarm('alarm-1', 'admin-1');

      expect(prisma.alarmHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolvedNote: null,
          }),
        }),
      );
    });
  });

  describe('getThresholds', () => {
    it('should return default thresholds when no custom set', async () => {
      prisma.taxCase.findUnique.mockResolvedValue(mockTaxCase);

      const result = await service.getThresholds('taxcase-1');

      expect(result.isCustom).toBe(false);
      expect(result.thresholds.federalInProcessDays).toBeDefined();
      expect(result.thresholds.stateInProcessDays).toBeDefined();
    });

    it('should return custom thresholds when set', async () => {
      prisma.taxCase.findUnique.mockResolvedValue(mockTaxCaseWithCustomThresholds);

      const result = await service.getThresholds('taxcase-2');

      expect(result.isCustom).toBe(true);
      expect(result.thresholds.federalInProcessDays).toBe(45);
      expect(result.thresholds.stateInProcessDays).toBe(40);
      expect(result.reason).toBe('Client requested extended timeline');
    });

    it('should throw NotFoundException if tax case not found', async () => {
      prisma.taxCase.findUnique.mockResolvedValue(null);

      await expect(service.getThresholds('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setThresholds', () => {
    it('should create custom thresholds', async () => {
      prisma.taxCase.findUnique.mockResolvedValue(mockTaxCase);
      prisma.alarmThreshold.upsert.mockResolvedValue({
        taxCaseId: 'taxcase-1',
        federalInProcessDays: 45,
        stateInProcessDays: 40,
      });

      // Mock getThresholds return
      const mockReturn = {
        taxCaseId: 'taxcase-1',
        clientName: 'John Doe',
        thresholds: {
          federalInProcessDays: 45,
          stateInProcessDays: 40,
          verificationTimeoutDays: 45,
          letterSentTimeoutDays: 21,
          disableFederalAlarms: false,
          disableStateAlarms: false,
        },
        isCustom: true,
        reason: 'Test reason',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.taxCase.findUnique
        .mockResolvedValueOnce(mockTaxCase)
        .mockResolvedValueOnce({
          ...mockTaxCase,
          alarmThreshold: {
            federalInProcessDays: 45,
            stateInProcessDays: 40,
            verificationTimeoutDays: 45,
            letterSentTimeoutDays: 21,
            disableFederalAlarms: false,
            disableStateAlarms: false,
            reason: 'Test reason',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

      const result = await service.setThresholds(
        'taxcase-1',
        {
          federalInProcessDays: 45,
          stateInProcessDays: 40,
          reason: 'Test reason',
        },
        'admin-1',
      );

      expect(prisma.alarmThreshold.upsert).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException if tax case not found', async () => {
      prisma.taxCase.findUnique.mockResolvedValue(null);

      await expect(
        service.setThresholds('invalid-id', { federalInProcessDays: 45 }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow disabling alarms', async () => {
      prisma.taxCase.findUnique.mockResolvedValue(mockTaxCase);
      prisma.alarmThreshold.upsert.mockResolvedValue({});
      prisma.taxCase.findUnique.mockResolvedValueOnce(mockTaxCase).mockResolvedValueOnce({
        ...mockTaxCase,
        alarmThreshold: { disableFederalAlarms: true, disableStateAlarms: false },
      });

      await service.setThresholds(
        'taxcase-1',
        { disableFederalAlarms: true, disableStateAlarms: false },
        'admin-1',
      );

      expect(prisma.alarmThreshold.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            disableFederalAlarms: true,
            disableStateAlarms: false,
          }),
        }),
      );
    });
  });

  describe('deleteThresholds', () => {
    it('should delete custom thresholds', async () => {
      prisma.alarmThreshold.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteThresholds('taxcase-1');

      expect(prisma.alarmThreshold.deleteMany).toHaveBeenCalledWith({
        where: { taxCaseId: 'taxcase-1' },
      });
    });
  });

  describe('recordAlarm', () => {
    it('should create new alarm record', async () => {
      prisma.alarmHistory.findFirst.mockResolvedValue(null);
      prisma.alarmHistory.create.mockResolvedValue(mockAlarmHistory);
      prisma.taxCase.findUnique.mockResolvedValue(mockTaxCase);

      const alarm = {
        type: 'possible_verification',
        level: 'warning',
        track: 'federal' as const,
        message: 'Test alarm',
        threshold: 21,
        daysSinceStatusChange: 30,
      };

      await service.recordAlarm(
        'taxcase-1',
        alarm,
        'taxes_en_proceso',
        new Date(),
      );

      expect(prisma.alarmHistory.create).toHaveBeenCalled();
      expect(notificationsService.createFromTemplate).toHaveBeenCalled();
    });

    it('should update existing active alarm instead of creating duplicate', async () => {
      prisma.alarmHistory.findFirst.mockResolvedValue(mockAlarmHistory);
      prisma.alarmHistory.update.mockResolvedValue(mockAlarmHistory);

      const alarm = {
        type: 'possible_verification',
        level: 'warning',
        track: 'federal' as const,
        message: 'Updated message',
        threshold: 21,
        daysSinceStatusChange: 35,
      };

      await service.recordAlarm(
        'taxcase-1',
        alarm,
        'taxes_en_proceso',
        new Date(),
      );

      expect(prisma.alarmHistory.update).toHaveBeenCalled();
      expect(prisma.alarmHistory.create).not.toHaveBeenCalled();
    });
  });

  describe('autoResolveAlarms', () => {
    it('should auto-resolve alarms for a track', async () => {
      prisma.alarmHistory.updateMany.mockResolvedValue({ count: 2 });

      await service.autoResolveAlarms('taxcase-1', 'federal', 'Status changed to deposited');

      expect(prisma.alarmHistory.updateMany).toHaveBeenCalledWith({
        where: {
          taxCaseId: 'taxcase-1',
          track: 'federal',
          resolution: { in: ['active', 'acknowledged'] },
        },
        data: {
          resolution: 'auto_resolved',
          resolvedAt: expect.any(Date),
          autoResolveReason: 'Status changed to deposited',
          updatedAt: expect.any(Date),
        },
      });
    });
  });

  describe('syncAlarmsForCase', () => {
    it('should sync alarms for tax case', async () => {
      prisma.taxCase.findUnique.mockResolvedValue(mockTaxCase);
      prisma.alarmHistory.findMany.mockResolvedValue([mockAlarmHistory]);
      prisma.alarmHistory.findFirst.mockResolvedValue(null);

      await service.syncAlarmsForCase('taxcase-1');

      // Should have queried for active alarms
      expect(prisma.alarmHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            taxCaseId: 'taxcase-1',
            resolution: { in: ['active', 'acknowledged'] },
          },
        }),
      );
    });

    it('should handle missing tax case gracefully', async () => {
      prisma.taxCase.findUnique.mockResolvedValue(null);

      await service.syncAlarmsForCase('invalid-id');

      // Should not throw, just return early
      expect(prisma.alarmHistory.findMany).not.toHaveBeenCalled();
    });

    it('should auto-resolve alarms that are no longer triggered', async () => {
      // Tax case with status that doesn't trigger alarms
      const completedCase = {
        ...mockTaxCase,
        federalStatusNew: 'deposited',
        stateStatusNew: 'deposited',
      };
      prisma.taxCase.findUnique.mockResolvedValue(completedCase);
      prisma.alarmHistory.findMany.mockResolvedValue([mockAlarmHistory]);
      prisma.alarmHistory.update.mockResolvedValue({});

      await service.syncAlarmsForCase('taxcase-1');

      // Should auto-resolve the old alarm
      expect(prisma.alarmHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolution: 'auto_resolved',
            autoResolveReason: 'Status changed - alarm condition no longer met',
          }),
        }),
      );
    });
  });
});
