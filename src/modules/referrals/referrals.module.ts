import { Module } from '@nestjs/common';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ReferralsController],
  providers: [ReferralsService, PrismaService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
