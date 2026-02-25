import { Module } from '@nestjs/common';
import { IrsMonitorController } from './irs-monitor.controller';
import { IrsMonitorService } from './irs-monitor.service';
import { IrsScraperService } from './irs-scraper.service';
import { IrsStatusMapperService } from './irs-status-mapper.service';
import { IrsMonitorSchedulerService } from './irs-monitor-scheduler.service';
import { PrismaService } from '../../config/prisma.service';
import { EncryptionService } from '../../common/services';
import { SupabaseService } from '../../config/supabase.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [IrsMonitorController],
  providers: [
    IrsMonitorService,
    IrsScraperService,
    IrsStatusMapperService,
    IrsMonitorSchedulerService,
    PrismaService,
    EncryptionService,
    SupabaseService,
  ],
  exports: [IrsMonitorService],
})
export class IrsMonitorModule {}
