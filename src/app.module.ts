import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

// Config
import { PrismaService } from './config/prisma.service';
import { SupabaseService } from './config/supabase.service';

// Common
import { HttpExceptionFilter } from './common/filters';
import { EncryptionService, EmailService, StoragePathService } from './common/services';

// Modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ClientsModule } from './modules/clients/clients.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CalculatorModule } from './modules/calculator/calculator.module';
import { ProgressModule } from './modules/progress/progress.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    ClientsModule,
    DocumentsModule,
    TicketsModule,
    NotificationsModule,
    CalculatorModule,
    ProgressModule,
    ReferralsModule,
    AuditLogsModule,
    HealthModule,
  ],
  controllers: [],
  providers: [
    PrismaService,
    SupabaseService,
    EncryptionService,
    EmailService,
    StoragePathService,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    },
  ],
})
export class AppModule {}
