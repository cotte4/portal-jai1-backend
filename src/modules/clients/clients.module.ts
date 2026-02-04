import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ClientsController } from './clients.controller';
import {
  ClientProfileService,
  ClientQueryService,
  ClientStatusService,
  ClientAdminService,
  ClientExportService,
  ClientReportingService,
} from './services';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { EncryptionService, EmailService } from '../../common/services';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProgressModule } from '../progress/progress.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    NotificationsModule,
    ProgressModule,
    ReferralsModule,
    AuditLogsModule,
    MulterModule.register({
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }),
  ],
  controllers: [ClientsController],
  providers: [
    ClientProfileService,
    ClientQueryService,
    ClientStatusService,
    ClientAdminService,
    ClientExportService,
    ClientReportingService,
    PrismaService,
    SupabaseService,
    EncryptionService,
    EmailService,
  ],
  exports: [
    ClientProfileService,
    ClientQueryService,
    ClientStatusService,
    ClientAdminService,
    ClientExportService,
    ClientReportingService,
  ],
})
export class ClientsModule {}
