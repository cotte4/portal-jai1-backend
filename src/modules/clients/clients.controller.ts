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
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { ClientsService } from './clients.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles, CurrentUser } from '../../common/decorators';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UpdateSensitiveProfileDto } from './dto/update-sensitive-profile.dto';
import {
  UpdateStatusDto,
  SetProblemDto,
  SendNotificationDto,
  AdminUpdateProfileDto,
} from './dto/admin-update.dto';

@Controller()
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  // Client endpoints
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: any) {
    return this.clientsService.getProfile(user.id);
  }

  @Post('profile/complete')
  @UseGuards(JwtAuthGuard)
  async completeProfile(
    @CurrentUser() user: any,
    @Body() completeProfileDto: CompleteProfileDto,
  ) {
    return this.clientsService.completeProfile(user.id, completeProfileDto);
  }

  @Get('profile/draft')
  @UseGuards(JwtAuthGuard)
  async getDraft(@CurrentUser() user: any) {
    return this.clientsService.getDraft(user.id);
  }

  @Patch('profile/user-info')
  @UseGuards(JwtAuthGuard)
  async updateUserInfo(
    @CurrentUser() user: any,
    @Body()
    updateData: {
      phone?: string;
      firstName?: string;
      lastName?: string;
      dateOfBirth?: string;
      preferredLanguage?: string;
      address?: {
        street?: string;
        city?: string;
        state?: string;
        zip?: string;
      };
    },
  ) {
    return this.clientsService.updateUserInfo(user.id, updateData);
  }

  @Post('profile/picture')
  @UseGuards(JwtAuthGuard)
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
    return this.clientsService.uploadProfilePicture(
      user.id,
      file.buffer,
      file.mimetype,
    );
  }

  @Delete('profile/picture')
  @UseGuards(JwtAuthGuard)
  async deleteProfilePicture(@CurrentUser() user: any) {
    return this.clientsService.deleteProfilePicture(user.id);
  }

  @Patch('profile/sensitive')
  @UseGuards(JwtAuthGuard)
  async updateSensitiveProfile(
    @CurrentUser() user: any,
    @Body() dto: UpdateSensitiveProfileDto,
  ) {
    return this.clientsService.updateSensitiveProfile(user.id, dto);
  }

  @Post('profile/mark-onboarding-complete')
  @UseGuards(JwtAuthGuard)
  async markOnboardingComplete(@CurrentUser() user: any) {
    return this.clientsService.markOnboardingComplete(user.id);
  }

  // Admin endpoints
  @Get('admin/stats/season')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async getSeasonStats() {
    return this.clientsService.getSeasonStats();
  }

  @Get('admin/accounts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  async getAllClientAccounts(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    // Validate limit to prevent DoS attacks
    const MAX_LIMIT = 500;
    const DEFAULT_LIMIT = 50;
    const parsedLimit = limit ? parseInt(limit, 10) : DEFAULT_LIMIT;
    const validatedLimit =
      isNaN(parsedLimit) || parsedLimit < 1
        ? DEFAULT_LIMIT
        : Math.min(parsedLimit, MAX_LIMIT);

    return this.clientsService.getAllClientAccounts({ cursor, limit: validatedLimit });
  }

  @Get('admin/clients/:id/credentials')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async getClientCredentials(
    @Param('id') id: string,
    @CurrentUser() user: any,
    // TODO: Add IP address and user agent from request headers if needed
  ) {
    return this.clientsService.getClientCredentials(id, user.id);
  }

  @Get('admin/payments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  async getPaymentsSummary(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    // Validate limit to prevent DoS attacks
    const MAX_LIMIT = 500;
    const DEFAULT_LIMIT = 50;
    const parsedLimit = limit ? parseInt(limit, 10) : DEFAULT_LIMIT;
    const validatedLimit =
      isNaN(parsedLimit) || parsedLimit < 1
        ? DEFAULT_LIMIT
        : Math.min(parsedLimit, MAX_LIMIT);

    return this.clientsService.getPaymentsSummary({ cursor, limit: validatedLimit });
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
    // Validate limit to prevent DoS attacks
    const MAX_LIMIT = 500;
    const DEFAULT_LIMIT = 50;
    const parsedLimit = limit ? parseInt(limit, 10) : DEFAULT_LIMIT;
    const validatedLimit =
      isNaN(parsedLimit) || parsedLimit < 1
        ? DEFAULT_LIMIT
        : Math.min(parsedLimit, MAX_LIMIT);

    return this.clientsService.getDelaysData({
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
    return this.clientsService.getClientsWithAlarms();
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
    // Validate limit to prevent DoS attacks
    const MAX_LIMIT = 1000;
    const DEFAULT_LIMIT = 20;
    const parsedLimit = limit ? parseInt(limit, 10) : DEFAULT_LIMIT;
    const validatedLimit =
      isNaN(parsedLimit) || parsedLimit < 1
        ? DEFAULT_LIMIT
        : Math.min(parsedLimit, MAX_LIMIT);

    // Parse boolean filter
    const hasProblemBool = hasProblem === 'true' ? true : hasProblem === 'false' ? false : undefined;

    // Validate sort order
    const validSortOrder = sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : 'desc';

    return this.clientsService.findAll({
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
    const stream = await this.clientsService.exportToExcelStream({
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
      // Chunked transfer encoding for streaming (no Content-Length since we don't know final size)
      'Transfer-Encoding': 'chunked',
      // Prevent timeout during large exports
      Connection: 'keep-alive',
      // Cache control - don't cache exports
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });

    return new StreamableFile(stream);
  }

  @Get('admin/clients/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async findOne(@Param('id') id: string) {
    return this.clientsService.findOne(id);
  }

  @Patch('admin/clients/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async update(@Param('id') id: string, @Body() updateData: AdminUpdateProfileDto) {
    return this.clientsService.update(id, updateData);
  }

  @Patch('admin/clients/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async updateStatus(
    @Param('id') id: string,
    @Body() statusData: UpdateStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.clientsService.updateStatus(id, statusData, user.id);
  }

  @Get('admin/clients/:id/valid-transitions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async getValidTransitions(@Param('id') id: string) {
    return this.clientsService.getValidTransitions(id);
  }

  @Delete('admin/clients/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async remove(@Param('id') id: string) {
    return this.clientsService.remove(id);
  }

  @Post('admin/clients/:id/mark-paid')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async markPaid(@Param('id') id: string) {
    return this.clientsService.markPaid(id);
  }

  // DEPRECATED: adminStep endpoint removed - use internalStatus instead
  // Referral code generation now triggers when internalStatus changes to EN_PROCESO

  @Patch('admin/clients/:id/problem')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async setProblem(
    @Param('id') id: string,
    @Body() problemData: SetProblemDto,
  ) {
    return this.clientsService.setProblem(id, problemData);
  }

  @Post('admin/clients/:id/notify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async sendClientNotification(
    @Param('id') id: string,
    @Body() notifyData: SendNotificationDto,
  ) {
    return this.clientsService.sendClientNotification(id, notifyData);
  }
}
