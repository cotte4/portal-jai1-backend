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
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { ClientsService } from './clients.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles, CurrentUser } from '../../common/decorators';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import {
  UpdateStatusDto,
  SetProblemDto,
  SendNotificationDto,
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

  // Admin endpoints
  @Get('admin/stats/season')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async getSeasonStats() {
    return this.clientsService.getSeasonStats();
  }

  @Get('admin/accounts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async getAllClientAccounts() {
    return this.clientsService.getAllClientAccounts();
  }

  @Get('admin/payments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async getPaymentsSummary() {
    return this.clientsService.getPaymentsSummary();
  }

  @Get('admin/delays')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async getDelaysData() {
    return this.clientsService.getDelaysData();
  }

  @Get('admin/clients')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async findAll(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    // Validate limit to prevent DoS attacks
    const MAX_LIMIT = 1000;
    const DEFAULT_LIMIT = 20;
    const parsedLimit = limit ? parseInt(limit, 10) : DEFAULT_LIMIT;
    const validatedLimit =
      isNaN(parsedLimit) || parsedLimit < 1
        ? DEFAULT_LIMIT
        : Math.min(parsedLimit, MAX_LIMIT);

    return this.clientsService.findAll({
      status,
      search,
      cursor,
      limit: validatedLimit,
    });
  }

  @Get('admin/clients/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async exportToExcel(@Res({ passthrough: true }) res: Response) {
    // Use streaming export to handle large datasets without timeout
    const stream = await this.clientsService.exportToExcelStream();
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
  async update(@Param('id') id: string, @Body() updateData: any) {
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
