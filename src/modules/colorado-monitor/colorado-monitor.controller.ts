import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Query,
  Body,
  UseGuards,
  Logger,
  Res,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import { ColoradoMonitorService } from './colorado-monitor.service';
import { ColoradoMonitorSchedulerService } from './colorado-monitor-scheduler.service';
import { IrsCheckTrigger } from '@prisma/client';

@ApiTags('colorado-monitor')
@ApiBearerAuth()
@Controller('colorado-monitor')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ColoradoMonitorController {
  private readonly logger = new Logger(ColoradoMonitorController.name);
  constructor(
    private readonly coloradoMonitorService: ColoradoMonitorService,
    private readonly schedulerService: ColoradoMonitorSchedulerService,
  ) {}

  @Post('scheduler/start')
  @ApiOperation({ summary: 'Start the Colorado auto-monitor scheduler' })
  async startScheduler() {
    await this.schedulerService.startScheduler();
    return { active: true };
  }

  @Post('scheduler/stop')
  @ApiOperation({ summary: 'Stop the Colorado auto-monitor scheduler' })
  async stopScheduler() {
    await this.schedulerService.stopScheduler();
    return { active: false };
  }

  @Get('scheduler/status')
  @ApiOperation({ summary: 'Get Colorado scheduler active state' })
  async getSchedulerStatus() {
    return this.schedulerService.getSchedulerStatus();
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Colorado monitor stats (status changes in last 24h)',
  })
  async getStats() {
    return this.coloradoMonitorService.getStats();
  }

  @Get('queue')
  @ApiOperation({
    summary: 'Get monitored Colorado clients sorted by most overdue',
  })
  async getQueue() {
    return this.coloradoMonitorService.getQueue();
  }

  @Get('clients')
  @ApiOperation({ summary: 'Get all Colorado clients with taxes_filed status' })
  async getFiledClients() {
    return this.coloradoMonitorService.getFiledClients();
  }

  @Patch('clients/:taxCaseId/monitor')
  @ApiOperation({
    summary: 'Enable or disable scheduled monitoring for a Colorado client',
  })
  async toggleMonitor(
    @Param('taxCaseId', new ParseUUIDPipe()) taxCaseId: string,
    @Body() body: { enabled: boolean; intervalHours?: number },
  ) {
    return this.coloradoMonitorService.toggleMonitor(
      taxCaseId,
      body.enabled,
      body.intervalHours,
    );
  }

  @Post('purge-failed-checks')
  @ApiOperation({
    summary:
      'Delete all Colorado checks with error/timeout result (and their Supabase screenshots)',
  })
  async purgeFailedChecks() {
    const result = await this.coloradoMonitorService.purgeFailedChecks();
    this.logger.log(
      `purgeFailedChecks: deleted ${result.deleted} checks, ${result.screenshotsDeleted} screenshots`,
    );
    return result;
  }

  @Post('check-all')
  @ApiOperation({
    summary: 'Run Colorado check for all filed CO clients (fire & forget)',
  })
  async runCheckAll(@CurrentUser() user: any) {
    void this.coloradoMonitorService
      .runAllChecks(IrsCheckTrigger.manual, user.id)
      .catch((err: Error) =>
        this.logger.error(`check-all error: ${err.message}`),
      );
    return { started: true };
  }

  @Post('check/:taxCaseId')
  @ApiOperation({
    summary: 'Run Colorado refund check for a specific client (fire & forget)',
  })
  async runCheck(
    @Param('taxCaseId', new ParseUUIDPipe()) taxCaseId: string,
    @CurrentUser() user: any,
  ) {
    void this.coloradoMonitorService
      .runCheck(taxCaseId, user.id)
      .catch((err: Error) =>
        this.logger.error(`check error [${taxCaseId}]: ${err.message}`),
      );
    return { started: true };
  }

  @Get('checks')
  @ApiOperation({ summary: 'Get all recent Colorado checks (paginated)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getChecks(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.coloradoMonitorService.getChecks(
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('checks/:taxCaseId')
  @ApiOperation({ summary: 'Get Colorado check history for a specific client' })
  async getChecksForClient(
    @Param('taxCaseId', new ParseUUIDPipe()) taxCaseId: string,
  ) {
    return this.coloradoMonitorService.getChecksForClient(taxCaseId);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export all Colorado checks as CSV' })
  async exportCsv(@Res() res: Response) {
    const csv = await this.coloradoMonitorService.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="colorado-checks-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }

  @Post('checks/:checkId/approve')
  @ApiOperation({
    summary: 'Approve a recommended status change from a Colorado check',
  })
  async approveCheck(
    @Param('checkId', new ParseUUIDPipe()) checkId: string,
    @CurrentUser() user: any,
  ) {
    return this.coloradoMonitorService.approveCheck(checkId, user.id);
  }

  @Post('checks/:checkId/dismiss')
  @ApiOperation({
    summary: 'Dismiss a recommended status change (no update applied)',
  })
  async dismissCheck(@Param('checkId', new ParseUUIDPipe()) checkId: string) {
    return this.coloradoMonitorService.dismissCheck(checkId);
  }

  @Get('screenshot/:checkId')
  @ApiOperation({ summary: 'Get a 24-hour signed URL for a check screenshot' })
  async getScreenshot(@Param('checkId', new ParseUUIDPipe()) checkId: string) {
    return this.coloradoMonitorService.getScreenshotUrl(checkId);
  }
}
