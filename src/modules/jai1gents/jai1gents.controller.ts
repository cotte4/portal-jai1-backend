import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Jai1gentsService } from './jai1gents.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles, CurrentUser } from '../../common/decorators';
import {
  RegisterJai1gentDto,
  UpdateJai1gentProfileDto,
  GenerateInviteCodesDto,
  AdminCreateJai1gentDto,
  UpdateReferralCodeDto,
} from './dto';

@Controller('jai1gents')
export class Jai1gentsController {
  constructor(private readonly jai1gentsService: Jai1gentsService) {}

  // ============= PUBLIC ENDPOINTS =============

  /**
   * PUBLIC: Validate an invite code (for registration form)
   */
  @Get('validate-invite/:code')
  async validateInviteCode(@Param('code') code: string) {
    return this.jai1gentsService.validateInviteCode(code);
  }

  /**
   * PUBLIC: Validate a JAI1GENT referral code (for client registration)
   */
  @Get('validate-referral/:code')
  async validateReferralCode(@Param('code') code: string) {
    return this.jai1gentsService.validateReferralCode(code);
  }

  /**
   * PUBLIC: Register as a new JAI1GENT with invite code
   */
  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async register(@Body() dto: RegisterJai1gentDto, @Req() req: Request) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.jai1gentsService.register(dto, ipAddress, userAgent);
  }

  // ============= PROTECTED JAI1GENT ENDPOINTS =============

  /**
   * PROTECTED: Get JAI1GENT dashboard data
   */
  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.jai1gent)
  async getDashboard(@CurrentUser() user: any) {
    return this.jai1gentsService.getDashboard(user.id);
  }

  /**
   * PROTECTED: Update JAI1GENT profile (payment info)
   */
  @Patch('profile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.jai1gent)
  async updateProfile(
    @CurrentUser() user: any,
    @Body() dto: UpdateJai1gentProfileDto,
  ) {
    return this.jai1gentsService.updateProfile(user.id, dto);
  }

  // ============= ADMIN ENDPOINTS =============

  /**
   * ADMIN: Generate invite codes
   */
  @Post('admin/invite-codes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async generateInviteCodes(
    @CurrentUser() admin: any,
    @Body() dto: GenerateInviteCodesDto,
  ) {
    return this.jai1gentsService.generateInviteCodes(admin.id, dto);
  }

  /**
   * ADMIN: List invite codes
   */
  @Get('admin/invite-codes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async listInviteCodes(
    @Query('status') status?: 'used' | 'unused' | 'all',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.jai1gentsService.listInviteCodes({
      status: status || 'all',
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /**
   * ADMIN: List all JAI1GENTS
   */
  @Get('admin/list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async listJai1gents(
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.jai1gentsService.listJai1gents({
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /**
   * ADMIN: Get referral details for a specific JAI1GENT
   */
  @Get('admin/:userId/referrals')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async getJai1gentReferrals(
    @Param('userId') userId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.jai1gentsService.getJai1gentReferrals(userId, {
      status: status || 'all',
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /**
   * ADMIN: Activate or deactivate a JAI1GENT
   */
  @Patch('admin/:userId/toggle-active')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async toggleActive(
    @Param('userId') userId: string,
    @Body('is_active') isActive: boolean,
  ) {
    return this.jai1gentsService.toggleActive(userId, isActive);
  }

  /**
   * ADMIN: Create a JAI1GENT account directly (no invite code needed)
   */
  @Post('admin/create')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async adminCreate(@Body() dto: AdminCreateJai1gentDto) {
    return this.jai1gentsService.adminCreate(dto);
  }

  /**
   * ADMIN: Update a JAI1GENT's referral code
   */
  @Patch('admin/:userId/referral-code')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async updateReferralCode(
    @Param('userId') userId: string,
    @Body() dto: UpdateReferralCodeDto,
  ) {
    return this.jai1gentsService.updateReferralCode(userId, dto.referral_code);
  }
}
