import { Controller, Post, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import { IrsMonitorService } from './irs-monitor.service';

@ApiTags('irs-monitor')
@ApiBearerAuth()
@Controller('irs-monitor')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class IrsMonitorController {
  constructor(private readonly irsMonitorService: IrsMonitorService) {}

  @Get('clients')
  @ApiOperation({ summary: 'Get all clients with taxes_filed status' })
  async getFiledClients() {
    return this.irsMonitorService.getFiledClients();
  }

  @Post('check/:taxCaseId')
  @ApiOperation({ summary: 'Run IRS WMR check for a specific client' })
  async runCheck(
    @Param('taxCaseId') taxCaseId: string,
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
  async getChecksForClient(@Param('taxCaseId') taxCaseId: string) {
    return this.irsMonitorService.getChecksForClient(taxCaseId);
  }
}
