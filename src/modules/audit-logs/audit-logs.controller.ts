import {
  Controller,
  Get,
  Query,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogFiltersDto, ExportFiltersDto } from './dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  /**
   * GET /admin/audit-logs
   * List all audit logs with filters and pagination
   */
  @Get()
  async findAll(@Query() filters: AuditLogFiltersDto) {
    return this.auditLogsService.findAll(filters);
  }

  /**
   * GET /admin/audit-logs/actions
   * Get available audit actions for filter dropdowns
   */
  @Get('actions')
  getAvailableActions() {
    return {
      actions: this.auditLogsService.getAvailableActions(),
    };
  }

  /**
   * GET /admin/audit-logs/stats
   * Get audit log statistics
   */
  @Get('stats')
  async getStats(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.auditLogsService.getStats(dateFrom, dateTo);
  }

  /**
   * GET /admin/audit-logs/export
   * Export logs to CSV
   */
  @Get('export')
  async exportToCsv(@Query() filters: ExportFiltersDto, @Res() res: Response) {
    const csv = await this.auditLogsService.exportToCsv(filters);

    const filename = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  /**
   * GET /admin/audit-logs/user/:id
   * Get all logs for a specific user
   */
  @Get('user/:id')
  async findByUser(
    @Param('id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // Validate page and limit to prevent DoS attacks
    const MAX_LIMIT = 100;
    const DEFAULT_LIMIT = 50;
    const MAX_PAGE = 10000;
    const DEFAULT_PAGE = 1;

    const parsedPage = page ? parseInt(page, 10) : DEFAULT_PAGE;
    const validatedPage =
      isNaN(parsedPage) || parsedPage < 1
        ? DEFAULT_PAGE
        : Math.min(parsedPage, MAX_PAGE);

    const parsedLimit = limit ? parseInt(limit, 10) : DEFAULT_LIMIT;
    const validatedLimit =
      isNaN(parsedLimit) || parsedLimit < 1
        ? DEFAULT_LIMIT
        : Math.min(parsedLimit, MAX_LIMIT);

    return this.auditLogsService.findByUser(
      userId,
      validatedPage,
      validatedLimit,
    );
  }
}
