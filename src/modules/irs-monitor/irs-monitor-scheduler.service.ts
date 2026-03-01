import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IrsCheckTrigger } from '@prisma/client';
import { IrsMonitorService } from './irs-monitor.service';

@Injectable()
export class IrsMonitorSchedulerService {
  private readonly logger = new Logger(IrsMonitorSchedulerService.name);

  constructor(private readonly irsMonitorService: IrsMonitorService) {}

  /**
   * Runs daily at 08:00 AM Eastern Time.
   * Checks all clients with caseStatus = taxes_filed against IRS WMR.
   * IRS WMR is most reliable during morning hours; results are cached ~24h on their end.
   * TEMPORARILY DISABLED — remove the comment on @Cron to re-enable.
   */
  // @Cron('0 8 * * *', { timeZone: 'America/New_York' })
  async runDailyCheck() {
    this.logger.log('Daily IRS check triggered by scheduler');
    try {
      const result = await this.irsMonitorService.runAllChecks(IrsCheckTrigger.schedule);
      this.logger.log(
        `Daily IRS check complete — ${result.succeeded}/${result.total} succeeded, ${result.failed} failed`,
      );
    } catch (err) {
      this.logger.error(`Daily IRS check failed: ${(err as Error).message}`);
    }
  }
}
