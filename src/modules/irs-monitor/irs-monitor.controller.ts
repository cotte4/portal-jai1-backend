import { Controller, Post, Get, Param, Query, UseGuards, Logger, Res, ParseUUIDPipe } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import { IrsMonitorService } from './irs-monitor.service';
import { IrsCheckTrigger } from '@prisma/client';

@ApiTags('irs-monitor')
@ApiBearerAuth()
@Controller('irs-monitor')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class IrsMonitorController {
  private readonly logger = new Logger(IrsMonitorController.name);
  constructor(private readonly irsMonitorService: IrsMonitorService) {}

  @Get('stats')
  @ApiOperation({ summary: 'IRS monitor stats (status changes in last 24h)' })
  async getStats() {
    return this.irsMonitorService.getStats();
  }

  @Get('clients')
  @ApiOperation({ summary: 'Get all clients with taxes_filed status' })
  async getFiledClients() {
    return this.irsMonitorService.getFiledClients();
  }

  @Post('check-all')
  @ApiOperation({ summary: 'Run IRS check for all taxes_filed clients (fire & forget)' })
  async runCheckAll(@CurrentUser() user: any) {
    // Fire and forget — each check takes ~20s so we cannot block the HTTP response
    void this.irsMonitorService
      .runAllChecks(IrsCheckTrigger.manual, user.id)
      .catch((err: Error) => this.logger.error(`check-all error: ${err.message}`));
    return { started: true };
  }

  @Post('check/:taxCaseId')
  @ApiOperation({ summary: 'Run IRS WMR check for a specific client' })
  async runCheck(
    @Param('taxCaseId', new ParseUUIDPipe()) taxCaseId: string,
    @CurrentUser() user: any,
  ) {
    return this.irsMonitorService.runCheck(taxCaseId, user.id);
  }

  @Get('checks')
  @ApiOperation({ summary: 'Get all recent IRS checks (paginated)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getChecks(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.irsMonitorService.getChecks(cursor, limit ? parseInt(limit, 10) : 20);
  }

  @Get('checks/:taxCaseId')
  @ApiOperation({ summary: 'Get IRS check history for a specific client' })
  async getChecksForClient(@Param('taxCaseId', new ParseUUIDPipe()) taxCaseId: string) {
    return this.irsMonitorService.getChecksForClient(taxCaseId);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export all IRS checks as CSV' })
  async exportCsv(@Res() res: Response) {
    const csv = await this.irsMonitorService.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="irs-checks-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }

  @Get('screenshot/:checkId')
  @ApiOperation({ summary: 'Get a 24-hour signed URL for a check screenshot' })
  async getScreenshot(@Param('checkId', new ParseUUIDPipe()) checkId: string) {
    return this.irsMonitorService.getScreenshotUrl(checkId);
  }
}
