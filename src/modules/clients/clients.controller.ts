import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Res,
  StreamableFile,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import {
  ClientProfileService,
  ClientQueryService,
  ClientStatusService,
  ClientAdminService,
  ClientExportService,
  ClientReportingService,
} from './services';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles, CurrentUser } from '../../common/decorators';
import { PAGINATION_LIMITS, validateLimit } from '../../common/constants';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UpdateSensitiveProfileDto } from './dto/update-sensitive-profile.dto';
import { UpdateUserInfoDto } from './dto/update-user-info.dto';
import { ConfirmRefundDto } from './dto/confirm-refund.dto';
import {
  UpdateStatusDto,
  SetProblemDto,
  SendNotificationDto,
  AdminUpdateProfileDto,
  MarkCommissionPaidDto,
} from './dto/admin-update.dto';

@ApiTags('clients')
@Controller()
export class ClientsController {
  constructor(
    private readonly profileService: ClientProfileService,
    private readonly queryService: ClientQueryService,
    private readonly statusService: ClientStatusService,
    private readonly adminService: ClientAdminService,
    private readonly exportService: ClientExportService,
    private readonly reportingService: ClientReportingService,
  ) {}

  // Client endpoints
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile data' })
  async getProfile(@CurrentUser() user: any) {
    return this.profileService.getProfile(user.id);
  }

  @Post('profile/complete')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Complete or update profile' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async completeProfile(
    @CurrentUser() user: any,
    @Body() completeProfileDto: CompleteProfileDto,
  ) {
    return this.profileService.completeProfile(user.id, completeProfileDto);
  }

  @Get('profile/draft')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get profile draft data' })
  @ApiResponse({ status: 200, description: 'Draft data' })
  async getDraft(@CurrentUser() user: any) {
    return this.profileService.getDraft(user.id);
  }

  @Patch('profile/user-info')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user info (name, phone, address)' })
  @ApiResponse({ status: 200, description: 'User info updated' })
  async updateUserInfo(
    @CurrentUser() user: any,
    @Body() updateData: UpdateUserInfoDto,
  ) {
    return this.profileService.updateUserInfo(user.id, updateData);
  }

  @Post('profile/picture')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload profile picture' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Picture uploaded' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadProfilePicture(
    @CurrentUser() user: any,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({ fileType: /(image\/(jpeg|png|webp|gif))/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.profileService.uploadProfilePicture(
      user.id,
      file.buffer,
      file.mimetype,
    );
  }

  @Delete('profile/picture')
  @UseGuards(JwtAuthGuard)
  async deleteProfilePicture(@CurrentUser() user: any) {
    return this.profileService.deleteProfilePicture(user.id);
  }

  @Patch('profile/sensitive')
  @UseGuards(JwtAuthGuard)
  async updateSensitiveProfile(
    @CurrentUser() user: any,
    @Body() dto: UpdateSensitiveProfileDto,
  ) {
    return this.profileService.updateSensitiveProfile(user.id, dto);
  }

  @Post('refund/confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm receipt of federal or state refund' })
  @ApiResponse({ status: 200, description: 'Refund receipt confirmed' })
  @ApiResponse({ status: 400, description: 'Invalid refund type or already confirmed' })
  @ApiResponse({ status: 404, description: 'No tax case found' })
  async confirmRefundReceived(
    @CurrentUser() user: any,
    @Body() dto: ConfirmRefundDto,
  ) {
    return this.statusService.confirmRefundReceived(user.id, dto.type);
  }

  @Post('profile/mark-onboarding-complete')
  @UseGuards(JwtAuthGuard)
  async markOnboardingComplete(@CurrentUser() user: any) {
    return this.profileService.markOnboardingComplete(user.id);
  }

  // Admin endpoints
  @Get('admin/stats/season')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async getSeasonStats() {
    return this.reportingService.getSeasonStats();
  }

  @Get('admin/accounts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  async getAllClientAccounts(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const validatedLimit = validateLimit(limit, PAGINATION_LIMITS.ACCOUNTS);
    return this.queryService.getAllClientAccounts({ cursor, limit: validatedLimit });
  }

  @Get('admin/clients/:id/credentials')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async getClientCredentials(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.queryService.getClientCredentials(id, user.id);
  }

  @Get('admin/payments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  async getPaymentsSummary(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const validatedLimit = validateLimit(limit, PAGINATION_LIMITS.PAYMENTS);
    return this.reportingService.getPaymentsSummary({ cursor, limit: validatedLimit });
  }

  @Get('admin/delays')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  async getDelaysData(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('status') status?: string,
  ) {
    const validatedLimit = validateLimit(limit, PAGINATION_LIMITS.DELAYS);
    return this.reportingService.getDelaysData({
      cursor,
      limit: validatedLimit,
      dateFrom,
      dateTo,
      status,
    });
  }

  @Get('admin/alarms')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async getClientsWithAlarms() {
    return this.reportingService.getClientsWithAlarms();
  }

  @Get('admin/clients')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async findAll(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    // Advanced filters
    @Query('hasProblem') hasProblem?: string,
    @Query('federalStatus') federalStatus?: string,
    @Query('stateStatus') stateStatus?: string,
    @Query('caseStatus') caseStatus?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    // Sorting
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const validatedLimit = validateLimit(limit, PAGINATION_LIMITS.CLIENTS);

    // Parse boolean filter
    const hasProblemBool = hasProblem === 'true' ? true : hasProblem === 'false' ? false : undefined;

    // Validate sort order
    const validSortOrder = sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : 'desc';

    return this.queryService.findAll({
      status,
      search,
      cursor,
      limit: validatedLimit,
      // Advanced filters
      hasProblem: hasProblemBool,
      federalStatus,
      stateStatus,
      caseStatus,
      dateFrom,
      dateTo,
      // Sorting
      sortBy,
      sortOrder: validSortOrder,
    });
  }

  @Get('admin/clients/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async exportToExcel(
    @Res({ passthrough: true }) res: Response,
    // Same filters as findAll
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('hasProblem') hasProblem?: string,
    @Query('federalStatus') federalStatus?: string,
    @Query('stateStatus') stateStatus?: string,
    @Query('caseStatus') caseStatus?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    // Parse boolean filter
    const hasProblemBool = hasProblem === 'true' ? true : hasProblem === 'false' ? false : undefined;

    // Use streaming export to handle large datasets without timeout
    const stream = await this.exportService.exportToExcelStream({
      status,
      search,
      hasProblem: hasProblemBool,
      federalStatus,
      stateStatus,
      caseStatus,
      dateFrom,
      dateTo,
    });
    const filename = `clientes-${new Date().toISOString().split('T')[0]}.xlsx`;

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Transfer-Encoding': 'chunked',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });

    return new StreamableFile(stream);
  }

  @Get('admin/clients/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async findOne(@Param('id') id: string) {
    return this.queryService.findOne(id);
  }

  @Patch('admin/clients/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async update(@Param('id') id: string, @Body() updateData: AdminUpdateProfileDto) {
    return this.statusService.update(id, updateData);
  }

  @Patch('admin/clients/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async updateStatus(
    @Param('id') id: string,
    @Body() statusData: UpdateStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.statusService.updateStatus(id, statusData, user.id);
  }

  @Get('admin/clients/:id/valid-transitions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async getValidTransitions(@Param('id') id: string) {
    return this.statusService.getValidTransitions(id);
  }

  @Delete('admin/clients/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async remove(@Param('id') id: string) {
    return this.adminService.remove(id);
  }

  @Post('admin/clients/:id/mark-paid')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async markPaid(@Param('id') id: string) {
    return this.adminService.markPaid(id);
  }

  @Post('admin/clients/:id/commission')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Mark federal or state commission as paid' })
  @ApiResponse({ status: 200, description: 'Commission marked as paid' })
  @ApiResponse({ status: 400, description: 'Invalid type or commission already paid' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  async markCommissionPaid(
    @Param('id') id: string,
    @Body() dto: MarkCommissionPaidDto,
    @CurrentUser() user: any,
  ) {
    return this.adminService.markCommissionPaid(id, dto.type, user.id, dto.reviewNote);
  }

  @Get('admin/clients/unpaid-commissions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Get clients who confirmed refunds but have not paid commission' })
  @ApiResponse({ status: 200, description: 'List of clients with unpaid commissions' })
  async getUnpaidCommissions(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const validatedLimit = validateLimit(limit, PAGINATION_LIMITS.PAYMENTS);
    return this.adminService.getUnpaidCommissions({ cursor, limit: validatedLimit });
  }

  // DEPRECATED: adminStep endpoint removed - use internalStatus instead

  @Patch('admin/clients/:id/problem')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async setProblem(
    @Param('id') id: string,
    @Body() problemData: SetProblemDto,
  ) {
    return this.adminService.setProblem(id, problemData);
  }

  @Post('admin/clients/:id/notify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async sendClientNotification(
    @Param('id') id: string,
    @Body() notifyData: SendNotificationDto,
  ) {
    return this.adminService.sendClientNotification(id, notifyData);
  }

  @Delete('admin/clients/:id/w2-estimate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Reset W2 estimate for a client (allows recalculation)' })
  @ApiResponse({ status: 200, description: 'W2 estimate reset successfully' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  async resetW2Estimate(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.reportingService.resetW2Estimate(id, user.id);
  }

  @Get('admin/clients/:id/w2-estimate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Get W2 estimate data for a client (for visual review)' })
  @ApiResponse({ status: 200, description: 'W2 estimate data' })
  @ApiResponse({ status: 404, description: 'Client not found or no W2 estimate' })
  async getW2Estimate(@Param('id') id: string) {
    return this.reportingService.getW2EstimateForClient(id);
  }
}
