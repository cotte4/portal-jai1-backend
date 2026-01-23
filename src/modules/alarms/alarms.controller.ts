import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles, CurrentUser } from '../../common/decorators';
import { AlarmsService, AlarmHistoryFilters, AlarmDashboardFilters } from './alarms.service';
import { SetThresholdsDto } from './dto/set-thresholds.dto';
import type { AlarmType, AlarmLevel, AlarmResolution } from '@prisma/client';

@Controller('admin/alarms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin)
export class AlarmsController {
  constructor(private readonly alarmsService: AlarmsService) {}

  /**
   * GET /admin/alarms/dashboard
   * Get all cases with active alarms (supports pagination and filters)
   * Query params:
   * - hideCompleted: boolean - hide cases with completed status
   * - level: 'warning' | 'critical' | 'all' - filter by alarm level
   * - cursor: string - pagination cursor (taxCaseId)
   * - limit: number - items per page (max 100, default 50)
   */
  @Get('dashboard')
  async getDashboard(
    @Query('hideCompleted') hideCompleted?: string,
    @Query('level') level?: 'warning' | 'critical' | 'all',
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const filters: AlarmDashboardFilters = {};

    if (hideCompleted === 'true') filters.hideCompleted = true;
    if (level) filters.level = level;
    if (cursor) filters.cursor = cursor;
    if (limit) filters.limit = parseInt(limit, 10);

    return this.alarmsService.getDashboard(filters);
  }

  /**
   * GET /admin/alarms/history
   * Get alarm history with optional filters
   */
  @Get('history')
  async getHistory(
    @Query('taxCaseId') taxCaseId?: string,
    @Query('alarmType') alarmType?: AlarmType,
    @Query('alarmLevel') alarmLevel?: AlarmLevel,
    @Query('resolution') resolution?: AlarmResolution,
    @Query('track') track?: 'federal' | 'state',
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const filters: AlarmHistoryFilters = {};

    if (taxCaseId) filters.taxCaseId = taxCaseId;
    if (alarmType) filters.alarmType = alarmType;
    if (alarmLevel) filters.alarmLevel = alarmLevel;
    if (resolution) filters.resolution = resolution;
    if (track) filters.track = track;
    if (fromDate) filters.fromDate = new Date(fromDate);
    if (toDate) filters.toDate = new Date(toDate);

    return this.alarmsService.getHistory(filters);
  }

  /**
   * POST /admin/alarms/:alarmId/acknowledge
   * Acknowledge an alarm (mark as seen)
   */
  @Post(':alarmId/acknowledge')
  async acknowledgeAlarm(
    @Param('alarmId') alarmId: string,
    @Request() req: any,
  ) {
    await this.alarmsService.acknowledgeAlarm(alarmId, req.user.id);
    return { message: 'Alarm acknowledged' };
  }

  /**
   * POST /admin/alarms/:alarmId/resolve
   * Resolve an alarm with optional note
   */
  @Post(':alarmId/resolve')
  async resolveAlarm(
    @Param('alarmId') alarmId: string,
    @Body('note') note: string | undefined,
    @Request() req: any,
  ) {
    await this.alarmsService.resolveAlarm(alarmId, req.user.id, note);
    return { message: 'Alarm resolved' };
  }

  /**
   * POST /admin/alarms/:alarmId/dismiss
   * Dismiss an alarm for a completed client (hides from dashboard)
   */
  @Post(':alarmId/dismiss')
  async dismissAlarm(
    @Param('alarmId') alarmId: string,
    @Body('reason') reason: string | undefined,
    @Request() req: any,
  ) {
    await this.alarmsService.dismissAlarm(alarmId, req.user.id, reason);
    return { message: 'Alarm dismissed' };
  }

  /**
   * POST /admin/alarms/dismiss-all/:taxCaseId
   * Dismiss all alarms for a completed tax case
   */
  @Post('dismiss-all/:taxCaseId')
  async dismissAllForCase(
    @Param('taxCaseId') taxCaseId: string,
    @Request() req: any,
  ) {
    await this.alarmsService.dismissAllForCase(taxCaseId, req.user.id);
    return { message: 'All alarms dismissed for this case' };
  }

  /**
   * GET /admin/alarms/thresholds/:taxCaseId
   * Get thresholds for a tax case (custom or defaults)
   */
  @Get('thresholds/:taxCaseId')
  async getThresholds(@Param('taxCaseId') taxCaseId: string) {
    return this.alarmsService.getThresholds(taxCaseId);
  }

  /**
   * PATCH /admin/alarms/thresholds/:taxCaseId
   * Set custom thresholds for a tax case
   */
  @Patch('thresholds/:taxCaseId')
  async setThresholds(
    @Param('taxCaseId') taxCaseId: string,
    @Body() dto: SetThresholdsDto,
    @Request() req: any,
  ) {
    return this.alarmsService.setThresholds(taxCaseId, dto, req.user.id);
  }

  /**
   * DELETE /admin/alarms/thresholds/:taxCaseId
   * Delete custom thresholds (revert to defaults)
   */
  @Delete('thresholds/:taxCaseId')
  async deleteThresholds(@Param('taxCaseId') taxCaseId: string) {
    await this.alarmsService.deleteThresholds(taxCaseId);
    return { message: 'Custom thresholds deleted, reverted to defaults' };
  }

  /**
   * POST /admin/alarms/sync/:taxCaseId
   * Manually trigger alarm sync for a tax case
   */
  @Post('sync/:taxCaseId')
  async syncAlarms(@Param('taxCaseId') taxCaseId: string) {
    await this.alarmsService.syncAlarmsForCase(taxCaseId);
    return { message: 'Alarms synced' };
  }
}
