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
} from '@nestjs/common';
import type { Response } from 'express';
import { ClientsService } from './clients.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles, CurrentUser } from '../../common/decorators';
import { CompleteProfileDto } from './dto/complete-profile.dto';

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
    @Body() updateData: {
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

  // Admin endpoints
  @Get('admin/clients')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin' as any)
  async findAll(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.clientsService.findAll({
      status,
      search,
      cursor,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('admin/clients/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin' as any)
  async exportToExcel(@Res({ passthrough: true }) res: Response) {
    const buffer = await this.clientsService.exportToExcel();
    const filename = `clientes-${new Date().toISOString().split('T')[0]}.xlsx`;

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(buffer);
  }

  @Get('admin/clients/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin' as any)
  async findOne(@Param('id') id: string) {
    return this.clientsService.findOne(id);
  }

  @Patch('admin/clients/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin' as any)
  async update(@Param('id') id: string, @Body() updateData: any) {
    return this.clientsService.update(id, updateData);
  }

  @Patch('admin/clients/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin' as any)
  async updateStatus(
    @Param('id') id: string,
    @Body() statusData: any,
    @CurrentUser() user: any,
  ) {
    return this.clientsService.updateStatus(id, statusData, user.id);
  }

  @Delete('admin/clients/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin' as any)
  async remove(@Param('id') id: string) {
    return this.clientsService.remove(id);
  }

  @Post('admin/clients/:id/mark-paid')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin' as any)
  async markPaid(@Param('id') id: string) {
    return this.clientsService.markPaid(id);
  }

  @Patch('admin/clients/:id/step')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin' as any)
  async updateAdminStep(
    @Param('id') id: string,
    @Body() stepData: { step: number },
    @CurrentUser() user: any,
  ) {
    return this.clientsService.updateAdminStep(id, stepData.step, user.id);
  }

  @Patch('admin/clients/:id/problem')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin' as any)
  async setProblem(
    @Param('id') id: string,
    @Body()
    problemData: {
      hasProblem: boolean;
      problemType?: string;
      problemDescription?: string;
    },
  ) {
    return this.clientsService.setProblem(id, problemData);
  }

  @Post('admin/clients/:id/notify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin' as any)
  async sendClientNotification(
    @Param('id') id: string,
    @Body()
    notifyData: {
      title: string;
      message: string;
      sendEmail?: boolean;
    },
  ) {
    return this.clientsService.sendClientNotification(id, notifyData);
  }
}
