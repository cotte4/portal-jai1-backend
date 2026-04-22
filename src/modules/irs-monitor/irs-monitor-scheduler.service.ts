import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../../config/prisma.service';
import { IrsMonitorService } from './irs-monitor.service';

const CRON_JOB_NAME = 'irs-scheduler';
const SETTING_KEY = 'irs_scheduler_active';

@Injectable()
export class IrsMonitorSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(IrsMonitorSchedulerService.name);

  constructor(
    private readonly irsMonitorService: IrsMonitorService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    if (setting?.value === 'true') {
      this.registerCron();
      this.logger.log('IRS scheduler restored from DB (active)');
    } else {
      this.logger.log('IRS scheduler not started (inactive in DB)');
    }
  }

  async startScheduler(): Promise<void> {
    if (!this.schedulerRegistry.doesExist('cron', CRON_JOB_NAME)) {
      this.registerCron();
    }
    await this.persistState(true);
    this.logger.log('IRS scheduler started');
  }

  async stopScheduler(): Promise<void> {
    if (this.schedulerRegistry.doesExist('cron', CRON_JOB_NAME)) {
      this.schedulerRegistry.deleteCronJob(CRON_JOB_NAME);
    }
    await this.persistState(false);
    this.logger.log('IRS scheduler stopped');
  }

  async getSchedulerStatus(): Promise<{ active: boolean }> {
    const active = this.schedulerRegistry.doesExist('cron', CRON_JOB_NAME);
    return { active };
  }

  private registerCron() {
    const job = new CronJob(
      '0,30 * * * *',
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
        description: 'IRS auto-monitor scheduler state',
      },
    });
  }

  private async runScheduledCheck() {
    this.logger.log('Scheduled IRS check triggered');
    try {
      const result = await this.irsMonitorService.runNextScheduledCheck();
      if (result.skipped) {
        this.logger.log('Scheduled IRS check: no monitored clients — skipped');
      } else {
        this.logger.log(
          `Scheduled IRS check complete for taxCase ${result.taxCaseId}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Scheduled IRS check failed: ${(err as Error).message}`,
      );
    }
  }
}
