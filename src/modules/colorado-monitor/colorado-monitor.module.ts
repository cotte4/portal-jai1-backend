import { Module } from '@nestjs/common';
import { ColoradoMonitorController } from './colorado-monitor.controller';
import { ColoradoMonitorService } from './colorado-monitor.service';
import { ColoradoScraperService } from './colorado-scraper.service';
import { ColoradoStatusMapperService } from './colorado-status-mapper.service';
import { ColoradoMonitorSchedulerService } from './colorado-monitor-scheduler.service';
import { PrismaService } from '../../config/prisma.service';
import { EncryptionService } from '../../common/services';
import { SupabaseService } from '../../config/supabase.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ColoradoMonitorController],
  providers: [
    ColoradoMonitorService,
    ColoradoScraperService,
    ColoradoStatusMapperService,
    ColoradoMonitorSchedulerService,
    PrismaService,
    EncryptionService,
    SupabaseService,
  ],
  exports: [ColoradoMonitorService],
})
export class ColoradoMonitorModule {}
