import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ReferralsService } from './referrals.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles, CurrentUser } from '../../common/decorators';
import { PAGINATION_LIMITS, validateLimit, validateOffset } from '../../common/constants';
import { ApplyDiscountDto } from './dto/apply-discount.dto';
import { ApplyReferralCodeDto } from './dto/apply-referral-code.dto';
import { UpdateReferralStatusDto } from './dto/update-referral-status.dto';

@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  /**
   * PUBLIC: Validate a referral code (for registration form)
   */
  @Get('validate/:code')
  async validateCode(@Param('code') code: string) {
    return this.referralsService.validateCode(code);
  }

  /**
   * PROTECTED: Apply a referral code to current user (post-registration)
   * Used when user registered with Google OAuth or missed the referral field
   */
  @Post('apply-code')
  @UseGuards(JwtAuthGuard)
  async applyCode(
    @CurrentUser() user: any,
    @Body() dto: ApplyReferralCodeDto,
  ) {
    return this.referralsService.applyReferralCode(user.id, dto.code);
  }

  /**
   * PROTECTED: Check if current user was referred by someone
   */
  @Get('my-referrer')
  @UseGuards(JwtAuthGuard)
  async getMyReferrer(@CurrentUser() user: any) {
    return this.referralsService.getMyReferrer(user.id);
  }

  /**
   * PROTECTED: Get current user's referral code
   */
  @Get('my-code')
  @UseGuards(JwtAuthGuard)
  async getMyCode(@CurrentUser() user: any) {
    return this.referralsService.getMyCode(user.id);
  }

  /**
   * PROTECTED: Get referrals made by current user
   */
  @Get('my-referrals')
  @UseGuards(JwtAuthGuard)
  async getMyReferrals(@CurrentUser() user: any) {
    return this.referralsService.getMyReferrals(user.id);
  }

  /**
   * PROTECTED: Get current user's discount info
   */
  @Get('my-discount')
  @UseGuards(JwtAuthGuard)
  async getMyDiscount(@CurrentUser() user: any) {
    return this.referralsService.getMyDiscount(user.id);
  }

  /**
   * PROTECTED: Get global leaderboard
   */
  @Get('leaderboard')
  @UseGuards(JwtAuthGuard)
  async getLeaderboard(@Query('limit') limit?: string) {
    const validatedLimit = validateLimit(limit, PAGINATION_LIMITS.LEADERBOARD);
    return this.referralsService.getLeaderboard(validatedLimit);
  }

  /**
   * PROTECTED: Mark referral onboarding as complete
   */
  @Post('mark-onboarding-complete')
  @UseGuards(JwtAuthGuard)
  async markReferralOnboardingComplete(@CurrentUser() user: any) {
    return this.referralsService.markReferralOnboardingComplete(user.id);
  }

  /**
   * PROTECTED: Get referral onboarding status
   */
  @Get('onboarding-status')
  @UseGuards(JwtAuthGuard)
  async getReferralOnboardingStatus(@CurrentUser() user: any) {
    return this.referralsService.getReferralOnboardingStatus(user.id);
  }

  /**
   * ADMIN: Get all referrals
   */
  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async getAllReferrals(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const validatedLimit = limit ? validateLimit(limit, PAGINATION_LIMITS.REFERRALS) : undefined;
    const validatedOffset = offset ? validateOffset(offset) : undefined;

    return this.referralsService.getAllReferrals({
      status,
      search,
      limit: validatedLimit,
      offset: validatedOffset,
    });
  }

  /**
   * ADMIN: Get referral summary - aggregated by referrer
   * Supports cursor-based pagination with optional cursor and limit params
   */
  @Get('admin/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async getReferralSummary(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const validatedLimit = validateLimit(limit, PAGINATION_LIMITS.REFERRALS_SUMMARY);
    return this.referralsService.getReferralSummary({
      cursor,
      limit: validatedLimit,
    });
  }

  /**
   * ADMIN: Get referral program stats
   */
  @Get('admin/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async getStats() {
    return this.referralsService.getStats();
  }

  /**
   * ADMIN: Update referral status
   */
  @Patch('admin/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateReferralStatusDto,
  ) {
    return this.referralsService.updateStatus(id, dto);
  }

  /**
   * ADMIN: Apply discount to a client
   */
  @Post('admin/clients/:id/apply-discount')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  async applyDiscount(
    @Param('id') clientId: string,
    @Body() dto: ApplyDiscountDto,
    @CurrentUser() admin: any,
  ) {
    return this.referralsService.applyDiscount(clientId, dto, admin.id);
  }
}
