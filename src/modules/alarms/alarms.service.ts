import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  calculateAlarms,
  StatusAlarm,
  CustomAlarmThresholds,
  DEFAULT_ALARM_THRESHOLDS,
  getHighestAlarmLevel,
} from '../../common/utils/status-mapping.util';
import { AlarmResolution, AlarmType, AlarmLevel, Prisma } from '@prisma/client';
import { I18nService } from '../../i18n';

// DTOs
export interface AlarmDashboardItem {
  taxCaseId: string;
  clientName: string;
  clientEmail: string;
  alarms: StatusAlarm[];
  highestLevel: 'warning' | 'critical' | null;
  federalStatusNew: string | null;
  stateStatusNew: string | null;
  federalStatusNewChangedAt: Date | null;
  stateStatusNewChangedAt: Date | null;
  hasCustomThresholds: boolean;
}

export interface AlarmDashboardResponse {
  items: AlarmDashboardItem[];
  totalWithAlarms: number;
  totalCritical: number;
  totalWarning: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface AlarmDashboardFilters {
  hideCompleted?: boolean;
  level?: 'warning' | 'critical' | 'all';
  cursor?: string;
  limit?: number;
}

export interface AlarmHistoryItem {
  id: string;
  taxCaseId: string;
  clientName: string;
  alarmType: AlarmType;
  alarmLevel: AlarmLevel;
  track: string;
  message: string;
  thresholdDays: number;
  actualDays: number;
  statusAtTrigger: string;
  statusChangedAt: Date;
  resolution: AlarmResolution;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  resolvedNote: string | null;
  autoResolveReason: string | null;
  triggeredAt: Date;
}

export interface AlarmHistoryFilters {
  taxCaseId?: string;
  alarmType?: AlarmType;
  alarmLevel?: AlarmLevel;
  resolution?: AlarmResolution;
  track?: 'federal' | 'state';
  fromDate?: Date;
  toDate?: Date;
}

export interface SetThresholdsDto {
  federalInProcessDays?: number | null;
  stateInProcessDays?: number | null;
  verificationTimeoutDays?: number | null;
  letterSentTimeoutDays?: number | null;
  disableFederalAlarms?: boolean;
  disableStateAlarms?: boolean;
  reason?: string;
}

export interface ThresholdsResponse {
  taxCaseId: string;
  clientName: string;
  thresholds: {
    federalInProcessDays: number;
    stateInProcessDays: number;
    verificationTimeoutDays: number;
    letterSentTimeoutDays: number;
    disableFederalAlarms: boolean;
    disableStateAlarms: boolean;
  };
  isCustom: boolean;
  reason: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface SyncStatusResponse {
  lastSyncAt: string | null;
  casesProcessed: number;
  alarmsTriggered: number;
  alarmsAutoResolved: number;
  errors: number;
  isRunning: boolean;
}

@Injectable()
export class AlarmsService {
  private readonly logger = new Logger(AlarmsService.name);

  // Sync tracking
  private lastSyncAt: Date | null = null;
  private lastSyncStats = { casesProcessed: 0, alarmsTriggered: 0, alarmsAutoResolved: 0, errors: 0 };
  private isSyncRunning = false;

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private i18n: I18nService,
  ) {}

  // ===== CRON: Daily Alarm Sync =====

  @Cron('0 7 * * *', {
    name: 'sync-all-alarms',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  async syncAllAlarms(): Promise<SyncStatusResponse> {
    if (this.isSyncRunning) {
      this.logger.warn('Alarm sync already running, skipping');
      return this.getSyncStatus();
    }

    this.isSyncRunning = true;
    const stats = { casesProcessed: 0, alarmsTriggered: 0, alarmsAutoResolved: 0, errors: 0 };

    try {
      this.logger.log('Starting daily alarm sync...');

      // Query all tax cases with alarm-triggering statuses
      const eligibleCases = await this.prisma.taxCase.findMany({
        where: {
          OR: [
            {
              federalStatusNew: {
                in: ['in_process', 'in_verification', 'verification_in_progress'],
              },
            },
            {
              stateStatusNew: {
                in: ['in_process', 'in_verification', 'verification_in_progress'],
              },
            },
          ],
        },
        select: { id: true },
      });

      this.logger.log(`Found ${eligibleCases.length} eligible cases for alarm sync`);

      // Process in batches of 20
      const BATCH_SIZE = 20;
      for (let i = 0; i < eligibleCases.length; i += BATCH_SIZE) {
        const batch = eligibleCases.slice(i, i + BATCH_SIZE);

        // Count alarms before sync for this batch
        const beforeCounts = await Promise.all(
          batch.map((tc) =>
            this.prisma.alarmHistory.count({
              where: { taxCaseId: tc.id, resolution: { in: ['active', 'acknowledged'] } },
            }),
          ),
        );

        // Sync each case in the batch in parallel
        const results = await Promise.allSettled(
          batch.map((tc) => this.syncAlarmsForCase(tc.id)),
        );

        // Count alarms after sync for this batch
        const afterCounts = await Promise.all(
          batch.map((tc) =>
            this.prisma.alarmHistory.count({
              where: { taxCaseId: tc.id, resolution: { in: ['active', 'acknowledged'] } },
            }),
          ),
        );

        for (let j = 0; j < results.length; j++) {
          if (results[j].status === 'fulfilled') {
            stats.casesProcessed++;
            const diff = afterCounts[j] - beforeCounts[j];
            if (diff > 0) stats.alarmsTriggered += diff;
            else if (diff < 0) stats.alarmsAutoResolved += Math.abs(diff);
          } else {
            stats.errors++;
            this.logger.error(
              `Failed to sync alarms for case ${batch[j].id}:`,
              (results[j] as PromiseRejectedResult).reason,
            );
          }
        }
      }

      this.lastSyncAt = new Date();
      this.lastSyncStats = stats;

      this.logger.log(
        `Alarm sync complete: ${stats.casesProcessed} cases processed, ` +
          `${stats.alarmsTriggered} new alarms, ${stats.alarmsAutoResolved} auto-resolved, ` +
          `${stats.errors} errors`,
      );
    } catch (error) {
      this.logger.error('Alarm sync failed:', error);
    } finally {
      this.isSyncRunning = false;
    }

    return this.getSyncStatus();
  }

  getSyncStatus(): SyncStatusResponse {
    return {
      lastSyncAt: this.lastSyncAt?.toISOString() ?? null,
      casesProcessed: this.lastSyncStats.casesProcessed,
      alarmsTriggered: this.lastSyncStats.alarmsTriggered,
      alarmsAutoResolved: this.lastSyncStats.alarmsAutoResolved,
      errors: this.lastSyncStats.errors,
      isRunning: this.isSyncRunning,
    };
  }

  /**
   * Get alarm dashboard with all cases that have active alarms
   * Now supports filters and pagination for scalability (100+ clients)
   */
  async getDashboard(filters?: AlarmDashboardFilters): Promise<AlarmDashboardResponse> {
    const limit = Math.min(filters?.limit || 50, 100);

    // Build WHERE clause with smart pre-filtering
    const whereConditions: Prisma.TaxCaseWhereInput[] = [
      // Only include cases that COULD have alarms (active statuses that can trigger alarms)
      {
        OR: [
          {
            federalStatusNew: {
              in: [
                'in_process',
                'in_verification',
                'verification_in_progress',
              ],
            },
          },
          {
            stateStatusNew: {
              in: [
                'in_process',
                'in_verification',
                'verification_in_progress',
              ],
            },
          },
        ],
      },
    ];

    // Exclude completed cases if requested
    if (filters?.hideCompleted) {
      whereConditions.push({
        AND: [
          {
            OR: [
              { federalStatusNew: { not: 'taxes_completed' } },
              { federalStatusNew: null },
            ],
          },
          {
            OR: [
              { stateStatusNew: { not: 'taxes_completed' } },
              { stateStatusNew: null },
            ],
          },
        ],
      });
    }

    const where: Prisma.TaxCaseWhereInput = {
      AND: whereConditions,
    };

    // Only fetch tax cases that could potentially have alarms
    const taxCases = await this.prisma.taxCase.findMany({
      where,
      include: {
        clientProfile: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        alarmThreshold: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: limit + 1, // Fetch one extra for hasMore check
      cursor: filters?.cursor ? { id: filters.cursor } : undefined,
      skip: filters?.cursor ? 1 : undefined, // Skip the cursor item
    });

    const items: AlarmDashboardItem[] = [];
    let totalCritical = 0;
    let totalWarning = 0;

    for (const taxCase of taxCases.slice(0, limit)) {
      // Build custom thresholds from the AlarmThreshold relation
      const customThresholds: CustomAlarmThresholds | null = taxCase.alarmThreshold
        ? {
            federalInProcessDays: taxCase.alarmThreshold.federalInProcessDays,
            stateInProcessDays: taxCase.alarmThreshold.stateInProcessDays,
            verificationTimeoutDays: taxCase.alarmThreshold.verificationTimeoutDays,
            letterSentTimeoutDays: taxCase.alarmThreshold.letterSentTimeoutDays,
            disableFederalAlarms: taxCase.alarmThreshold.disableFederalAlarms,
            disableStateAlarms: taxCase.alarmThreshold.disableStateAlarms,
          }
        : null;

      const alarms = calculateAlarms(
        taxCase.federalStatusNew,
        taxCase.federalStatusNewChangedAt,
        taxCase.stateStatusNew,
        taxCase.stateStatusNewChangedAt,
        customThresholds,
      );

      if (alarms.length > 0) {
        const highestLevel = getHighestAlarmLevel(alarms);

        // Filter by level if requested
        if (filters?.level && filters.level !== 'all' && highestLevel !== filters.level) {
          continue;
        }

        if (highestLevel === 'critical') totalCritical++;
        else if (highestLevel === 'warning') totalWarning++;

        const user = taxCase.clientProfile?.user;
        const clientName = user
          ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Cliente'
          : 'Cliente';
        const clientEmail = user?.email || '';

        items.push({
          taxCaseId: taxCase.id,
          clientName,
          clientEmail,
          alarms,
          highestLevel,
          federalStatusNew: taxCase.federalStatusNew,
          stateStatusNew: taxCase.stateStatusNew,
          federalStatusNewChangedAt: taxCase.federalStatusNewChangedAt,
          stateStatusNewChangedAt: taxCase.stateStatusNewChangedAt,
          hasCustomThresholds: !!taxCase.alarmThreshold,
        });
      }
    }

    const hasMore = taxCases.length > limit;
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]?.taxCaseId : null;

    // Sort by severity (critical first) then by days
    items.sort((a, b) => {
      if (a.highestLevel === 'critical' && b.highestLevel !== 'critical') return -1;
      if (a.highestLevel !== 'critical' && b.highestLevel === 'critical') return 1;
      // Then by max days in alarms
      const aMaxDays = Math.max(...a.alarms.map((al) => al.daysSinceStatusChange));
      const bMaxDays = Math.max(...b.alarms.map((al) => al.daysSinceStatusChange));
      return bMaxDays - aMaxDays;
    });

    return {
      items,
      totalWithAlarms: items.length,
      totalCritical,
      totalWarning,
      hasMore,
      nextCursor,
    };
  }

  /**
   * Get alarm history with optional filters
   */
  async getHistory(filters: AlarmHistoryFilters = {}): Promise<AlarmHistoryItem[]> {
    const where: Prisma.AlarmHistoryWhereInput = {};

    if (filters.taxCaseId) where.taxCaseId = filters.taxCaseId;
    if (filters.alarmType) where.alarmType = filters.alarmType;
    if (filters.alarmLevel) where.alarmLevel = filters.alarmLevel;
    if (filters.resolution) where.resolution = filters.resolution;
    if (filters.track) where.track = filters.track;
    if (filters.fromDate || filters.toDate) {
      where.triggeredAt = {};
      if (filters.fromDate) where.triggeredAt.gte = filters.fromDate;
      if (filters.toDate) where.triggeredAt.lte = filters.toDate;
    }

    const history = await this.prisma.alarmHistory.findMany({
      where,
      include: {
        taxCase: {
          include: {
            clientProfile: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        },
        resolvedBy: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { triggeredAt: 'desc' },
      take: 100,
    });

    return history.map((h) => {
      const user = h.taxCase?.clientProfile?.user;
      const clientName = user
        ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Cliente'
        : 'Cliente';

      return {
        id: h.id,
        taxCaseId: h.taxCaseId,
        clientName,
        alarmType: h.alarmType,
        alarmLevel: h.alarmLevel,
        track: h.track,
        message: h.message,
        thresholdDays: h.thresholdDays,
        actualDays: h.actualDays,
        statusAtTrigger: h.statusAtTrigger,
        statusChangedAt: h.statusChangedAt,
        resolution: h.resolution,
        resolvedAt: h.resolvedAt,
        resolvedByName: h.resolvedBy
          ? `${h.resolvedBy.firstName} ${h.resolvedBy.lastName}`
          : null,
        resolvedNote: h.resolvedNote,
        autoResolveReason: h.autoResolveReason,
        triggeredAt: h.triggeredAt,
      };
    });
  }

  /**
   * Acknowledge an alarm (mark as seen but not resolved)
   */
  async acknowledgeAlarm(alarmId: string, userId: string): Promise<void> {
    const alarm = await this.prisma.alarmHistory.findUnique({
      where: { id: alarmId },
    });

    if (!alarm) {
      throw new NotFoundException(`Alarm ${alarmId} not found`);
    }

    if (alarm.resolution !== 'active') {
      return; // Already acknowledged or resolved
    }

    await this.prisma.alarmHistory.update({
      where: { id: alarmId },
      data: {
        resolution: 'acknowledged',
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Resolve an alarm with a note
   */
  async resolveAlarm(
    alarmId: string,
    userId: string,
    note?: string,
  ): Promise<void> {
    const alarm = await this.prisma.alarmHistory.findUnique({
      where: { id: alarmId },
    });

    if (!alarm) {
      throw new NotFoundException(`Alarm ${alarmId} not found`);
    }

    if (alarm.resolution === 'resolved' || alarm.resolution === 'auto_resolved') {
      return; // Already resolved
    }

    await this.prisma.alarmHistory.update({
      where: { id: alarmId },
      data: {
        resolution: 'resolved',
        resolvedAt: new Date(),
        resolvedById: userId,
        resolvedNote: note || null,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Dismiss an alarm for a completed client
   * This marks the alarm as "dismissed" so it doesn't show in the dashboard
   */
  async dismissAlarm(alarmId: string, userId: string, reason?: string): Promise<void> {
    const alarm = await this.prisma.alarmHistory.findUnique({
      where: { id: alarmId },
    });

    if (!alarm) {
      throw new NotFoundException(`Alarm ${alarmId} not found`);
    }

    await this.prisma.alarmHistory.update({
      where: { id: alarmId },
      data: {
        resolution: 'dismissed',
        resolvedAt: new Date(),
        resolvedById: userId,
        resolvedNote: reason || null,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Bulk dismiss all alarms for a completed tax case
   */
  async dismissAllForCase(taxCaseId: string, userId: string): Promise<void> {
    await this.prisma.alarmHistory.updateMany({
      where: {
        taxCaseId,
        resolution: { in: ['active', 'acknowledged'] },
      },
      data: {
        resolution: 'dismissed',
        resolvedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Dismissed all alarms for tax case ${taxCaseId} by user ${userId}`);
  }

  /**
   * Get thresholds for a tax case (custom or defaults)
   */
  async getThresholds(taxCaseId: string): Promise<ThresholdsResponse> {
    const taxCase = await this.prisma.taxCase.findUnique({
      where: { id: taxCaseId },
      include: {
        clientProfile: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        alarmThreshold: true,
      },
    });

    if (!taxCase) {
      throw new NotFoundException(`Tax case ${taxCaseId} not found`);
    }

    const user = taxCase.clientProfile?.user;
    const clientName = user
      ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Cliente'
      : 'Cliente';

    const customThreshold = taxCase.alarmThreshold;
    const isCustom = !!customThreshold;

    return {
      taxCaseId,
      clientName,
      thresholds: {
        federalInProcessDays:
          customThreshold?.federalInProcessDays ??
          DEFAULT_ALARM_THRESHOLDS.POSSIBLE_VERIFICATION_FEDERAL,
        stateInProcessDays:
          customThreshold?.stateInProcessDays ??
          DEFAULT_ALARM_THRESHOLDS.POSSIBLE_VERIFICATION_STATE,
        verificationTimeoutDays:
          customThreshold?.verificationTimeoutDays ??
          DEFAULT_ALARM_THRESHOLDS.VERIFICATION_TIMEOUT,
        letterSentTimeoutDays:
          customThreshold?.letterSentTimeoutDays ??
          DEFAULT_ALARM_THRESHOLDS.LETTER_SENT_TIMEOUT,
        disableFederalAlarms: customThreshold?.disableFederalAlarms ?? false,
        disableStateAlarms: customThreshold?.disableStateAlarms ?? false,
      },
      isCustom,
      reason: customThreshold?.reason ?? null,
      createdAt: customThreshold?.createdAt ?? null,
      updatedAt: customThreshold?.updatedAt ?? null,
    };
  }

  /**
   * Set custom thresholds for a tax case
   */
  async setThresholds(
    taxCaseId: string,
    dto: SetThresholdsDto,
    userId: string,
  ): Promise<ThresholdsResponse> {
    // Verify tax case exists
    const taxCase = await this.prisma.taxCase.findUnique({
      where: { id: taxCaseId },
    });

    if (!taxCase) {
      throw new NotFoundException(`Tax case ${taxCaseId} not found`);
    }

    // Upsert the threshold record
    await this.prisma.alarmThreshold.upsert({
      where: { taxCaseId },
      create: {
        taxCaseId,
        federalInProcessDays: dto.federalInProcessDays,
        stateInProcessDays: dto.stateInProcessDays,
        verificationTimeoutDays: dto.verificationTimeoutDays,
        letterSentTimeoutDays: dto.letterSentTimeoutDays,
        disableFederalAlarms: dto.disableFederalAlarms ?? false,
        disableStateAlarms: dto.disableStateAlarms ?? false,
        reason: dto.reason,
        createdById: userId,
      },
      update: {
        federalInProcessDays: dto.federalInProcessDays,
        stateInProcessDays: dto.stateInProcessDays,
        verificationTimeoutDays: dto.verificationTimeoutDays,
        letterSentTimeoutDays: dto.letterSentTimeoutDays,
        disableFederalAlarms: dto.disableFederalAlarms ?? false,
        disableStateAlarms: dto.disableStateAlarms ?? false,
        reason: dto.reason,
        updatedAt: new Date(),
      },
    });

    return this.getThresholds(taxCaseId);
  }

  /**
   * Delete custom thresholds (revert to defaults)
   */
  async deleteThresholds(taxCaseId: string): Promise<void> {
    await this.prisma.alarmThreshold.deleteMany({
      where: { taxCaseId },
    });
  }

  /**
   * Record a new alarm to history (called when alarm is first triggered)
   */
  async recordAlarm(
    taxCaseId: string,
    alarm: StatusAlarm,
    statusAtTrigger: string,
    statusChangedAt: Date,
  ): Promise<void> {
    // Check if this exact alarm already exists and is still active
    const existingAlarm = await this.prisma.alarmHistory.findFirst({
      where: {
        taxCaseId,
        alarmType: alarm.type as AlarmType,
        track: alarm.track,
        resolution: { in: ['active', 'acknowledged'] },
      },
    });

    if (existingAlarm) {
      // Update the actual days but don't create duplicate
      await this.prisma.alarmHistory.update({
        where: { id: existingAlarm.id },
        data: {
          actualDays: alarm.daysSinceStatusChange,
          message: alarm.message,
          updatedAt: new Date(),
        },
      });
      return;
    }

    // Create new alarm history record
    await this.prisma.alarmHistory.create({
      data: {
        taxCaseId,
        alarmType: alarm.type as AlarmType,
        alarmLevel: alarm.level as AlarmLevel,
        track: alarm.track,
        message: alarm.message,
        thresholdDays: alarm.threshold,
        actualDays: alarm.daysSinceStatusChange,
        statusAtTrigger,
        statusChangedAt,
      },
    });

    // Notify the client about the alarm (only for NEW alarms, not updates)
    await this.notifyClientAboutAlarm(taxCaseId, alarm);
  }

  /**
   * Notify client when a new alarm is triggered
   */
  private async notifyClientAboutAlarm(
    taxCaseId: string,
    alarm: StatusAlarm,
  ): Promise<void> {
    try {
      // Get client user ID from tax case
      const taxCase = await this.prisma.taxCase.findUnique({
        where: { id: taxCaseId },
        include: {
          clientProfile: {
            include: { user: true },
          },
        },
      });

      if (!taxCase?.clientProfile?.user) {
        this.logger.warn(`Could not find client for tax case ${taxCaseId}`);
        return;
      }

      const userId = taxCase.clientProfile.userId;
      const track = this.i18n.getTrack(alarm.track as 'federal' | 'state');

      // Create a client-friendly notification based on alarm type
      let templateKey: string;

      if (alarm.type === 'verification_timeout') {
        templateKey = 'notifications.alarm_verification_timeout';
      } else if (alarm.type === 'letter_sent_timeout') {
        templateKey = 'notifications.alarm_letter_sent';
      } else {
        templateKey = 'notifications.alarm_general';
      }

      await this.notificationsService.createFromTemplate(
        userId,
        'problem_alert',
        templateKey,
        { track, days: alarm.daysSinceStatusChange },
      );

      this.logger.log(`Sent alarm notification to client ${userId} for tax case ${taxCaseId}`);
    } catch (error) {
      this.logger.error(`Failed to notify client about alarm for tax case ${taxCaseId}:`, error);
      // Don't throw - notification failure shouldn't break the alarm recording
    }
  }

  /**
   * Auto-resolve alarms when status changes (e.g., moves out of in_process)
   */
  async autoResolveAlarms(
    taxCaseId: string,
    track: 'federal' | 'state',
    reason: string,
  ): Promise<void> {
    await this.prisma.alarmHistory.updateMany({
      where: {
        taxCaseId,
        track,
        resolution: { in: ['active', 'acknowledged'] },
      },
      data: {
        resolution: 'auto_resolved',
        resolvedAt: new Date(),
        autoResolveReason: reason,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Sync alarms for a tax case (recalculate and record/resolve as needed)
   * Call this after status updates to keep alarm history in sync
   */
  async syncAlarmsForCase(taxCaseId: string): Promise<void> {
    const taxCase = await this.prisma.taxCase.findUnique({
      where: { id: taxCaseId },
      include: { alarmThreshold: true },
    });

    if (!taxCase) return;

    const customThresholds: CustomAlarmThresholds | null = taxCase.alarmThreshold
      ? {
          federalInProcessDays: taxCase.alarmThreshold.federalInProcessDays,
          stateInProcessDays: taxCase.alarmThreshold.stateInProcessDays,
          verificationTimeoutDays: taxCase.alarmThreshold.verificationTimeoutDays,
          letterSentTimeoutDays: taxCase.alarmThreshold.letterSentTimeoutDays,
          disableFederalAlarms: taxCase.alarmThreshold.disableFederalAlarms,
          disableStateAlarms: taxCase.alarmThreshold.disableStateAlarms,
        }
      : null;

    const currentAlarms = calculateAlarms(
      taxCase.federalStatusNew,
      taxCase.federalStatusNewChangedAt,
      taxCase.stateStatusNew,
      taxCase.stateStatusNewChangedAt,
      customThresholds,
    );

    // Get current active alarms from history
    const activeHistoryAlarms = await this.prisma.alarmHistory.findMany({
      where: {
        taxCaseId,
        resolution: { in: ['active', 'acknowledged'] },
      },
    });

    // Find alarms that should be auto-resolved (no longer triggered)
    for (const historyAlarm of activeHistoryAlarms) {
      const stillActive = currentAlarms.some(
        (a) => a.type === historyAlarm.alarmType && a.track === historyAlarm.track,
      );

      if (!stillActive) {
        await this.prisma.alarmHistory.update({
          where: { id: historyAlarm.id },
          data: {
            resolution: 'auto_resolved',
            resolvedAt: new Date(),
            autoResolveReason: 'Status changed - alarm condition no longer met',
            updatedAt: new Date(),
          },
        });
      }
    }

    // Record new alarms that aren't in history yet
    for (const alarm of currentAlarms) {
      const statusChangedAt =
        alarm.track === 'federal'
          ? taxCase.federalStatusNewChangedAt
          : taxCase.stateStatusNewChangedAt;

      const statusAtTrigger =
        alarm.track === 'federal'
          ? taxCase.federalStatusNew
          : taxCase.stateStatusNew;

      if (statusChangedAt && statusAtTrigger) {
        await this.recordAlarm(taxCaseId, alarm, statusAtTrigger, statusChangedAt);
      }
    }
  }
}
