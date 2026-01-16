import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProgressAutomationService } from './progress-automation.service';

@Controller('admin/progress')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ProgressController {
  constructor(private readonly progressAutomation: ProgressAutomationService) {}

  /**
   * Trigger check for missing documents and send notifications
   * Admin-only endpoint
   */
  @Post('check-missing-documents')
  @HttpCode(HttpStatus.OK)
  async checkMissingDocuments(
    @Query('daysThreshold') daysThreshold?: string,
    @Query('maxNotifications') maxNotifications?: string,
  ) {
    const days = daysThreshold ? parseInt(daysThreshold, 10) : 3;
    const maxNotifs = maxNotifications ? parseInt(maxNotifications, 10) : 3;

    const result = await this.progressAutomation.checkAndNotifyMissingDocuments(
      days,
      maxNotifs,
    );

    return {
      message: 'Missing documents check completed',
      ...result,
    };
  }

  /**
   * Send docs_missing notification to a specific client
   * Admin-only endpoint
   */
  @Post('send-missing-docs-notification')
  @HttpCode(HttpStatus.OK)
  async sendMissingDocsNotification(@Body('userId') userId: string) {
    const success = await this.progressAutomation.sendMissingDocsNotification(userId);

    return {
      success,
      message: success
        ? 'Notification sent successfully'
        : 'No notification sent (no missing documents or user not found)',
    };
  }

  /**
   * Get the status of the missing docs cron job
   */
  @Get('cron/missing-docs/status')
  async getMissingDocsCronStatus() {
    return this.progressAutomation.getMissingDocsCronStatus();
  }

  /**
   * Enable or disable the missing docs cron job
   */
  @Patch('cron/missing-docs/status')
  @HttpCode(HttpStatus.OK)
  async setMissingDocsCronStatus(
    @Body('enabled') enabled: boolean,
    @CurrentUser() user: any,
  ) {
    return this.progressAutomation.setMissingDocsCronEnabled(enabled, user?.id);
  }
}
