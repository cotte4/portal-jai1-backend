import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../../config/prisma.service';
import { ColoradoMonitorService } from './colorado-monitor.service';

const CRON_JOB_NAME = 'colorado-scheduler';
const SETTING_KEY = 'colorado_scheduler_active';

@Injectable()
export class ColoradoMonitorSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ColoradoMonitorSchedulerService.name);

  constructor(
    private readonly coloradoMonitorService: ColoradoMonitorService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    if (process.env.COLORADO_MONITOR_ENABLED !== 'true') {
      this.logger.log(
        'Colorado scheduler disabled (COLORADO_MONITOR_ENABLED not set) — skipping',
      );
      return;
    }
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    if (setting?.value === 'true') {
      this.registerCron();
      this.logger.log('Colorado scheduler restored from DB (active)');
    } else {
      this.logger.log('Colorado scheduler not started (inactive in DB)');
    }
  }

  async startScheduler(): Promise<void> {
    if (process.env.COLORADO_MONITOR_ENABLED !== 'true') {
      this.logger.warn(
        'Colorado scheduler start ignored — COLORADO_MONITOR_ENABLED not set',
      );
      return;
    }
    if (!this.schedulerRegistry.doesExist('cron', CRON_JOB_NAME)) {
      this.registerCron();
    }
    await this.persistState(true);
    this.logger.log('Colorado scheduler started');
  }

  async stopScheduler(): Promise<void> {
    if (this.schedulerRegistry.doesExist('cron', CRON_JOB_NAME)) {
      this.schedulerRegistry.deleteCronJob(CRON_JOB_NAME);
    }
    await this.persistState(false);
    this.logger.log('Colorado scheduler stopped');
  }

  async getSchedulerStatus(): Promise<{ active: boolean }> {
    const active = this.schedulerRegistry.doesExist('cron', CRON_JOB_NAME);
    return { active };
  }

  // Runs daily at 09:00 AM Eastern Time (offset from IRS 8 AM)
  private registerCron() {
    const job = new CronJob(
      '0 9 * * *',
      () => void this.runScheduledCheck(),
      null,
      true,
      'America/New_York',
    );
    this.schedulerRegistry.addCronJob(CRON_JOB_NAME, job);
  }

  private async persistState(active: boolean) {
    await this.prisma.systemSetting.upsert({
      where: { key: SETTING_KEY },
      update: { value: String(active) },
      create: {
        key: SETTING_KEY,
        value: String(active),
        description: 'Colorado auto-monitor scheduler state',
      },
    });
  }

  private async runScheduledCheck() {
    this.logger.log('Scheduled Colorado check triggered');
    try {
      const result = await this.coloradoMonitorService.runScheduledChecks();
      this.logger.log(
        `Scheduled Colorado check complete — ${result.succeeded}/${result.total} succeeded, ${result.failed} failed`,
      );
    } catch (err) {
      this.logger.error(
        `Scheduled Colorado check failed: ${(err as Error).message}`,
      );
    }
  }
}
