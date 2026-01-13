import { Module } from '@nestjs/common';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [NotificationsModule, AuditLogsModule],
  controllers: [ReferralsController],
  providers: [ReferralsService, PrismaService, SupabaseService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
