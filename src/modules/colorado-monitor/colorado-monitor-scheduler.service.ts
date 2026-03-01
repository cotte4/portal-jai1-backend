import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IrsCheckTrigger } from '@prisma/client';
import { ColoradoMonitorService } from './colorado-monitor.service';

@Injectable()
export class ColoradoMonitorSchedulerService {
  private readonly logger = new Logger(ColoradoMonitorSchedulerService.name);

  constructor(private readonly coloradoMonitorService: ColoradoMonitorService) {}

  /**
   * Runs daily at 09:00 AM Eastern Time (offset from IRS 8 AM).
   * Checks all Colorado clients with caseStatus = taxes_filed.
   * TEMPORARILY DISABLED — remove the comment on @Cron to re-enable.
   */
  // @Cron('0 9 * * *', { timeZone: 'America/New_York' })
  async runDailyCheck() {
    this.logger.log('Daily Colorado check triggered by scheduler');
    try {
      const result = await this.coloradoMonitorService.runAllChecks(IrsCheckTrigger.schedule);
      this.logger.log(
        `Daily Colorado check complete — ${result.succeeded}/${result.total} succeeded, ${result.failed} failed`,
      );
    } catch (err) {
      this.logger.error(`Daily Colorado check failed: ${(err as Error).message}`);
    }
  }
}
