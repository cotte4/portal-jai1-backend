import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() user: any) {
    return this.usersService.findById(user.id);
  }

  @Post('referral-onboarding/complete')
  async completeReferralOnboarding(@CurrentUser() user: any) {
    return this.usersService.completeReferralOnboarding(user.id);
  }

  @Get('referral-onboarding/status')
  async getReferralOnboardingStatus(@CurrentUser() user: any) {
    const completed = await this.usersService.getReferralOnboardingStatus(user.id);
    return { referralOnboardingCompleted: completed };
  }
}
