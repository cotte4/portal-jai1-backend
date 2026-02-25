import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as Joi from 'joi';

// Config
import { PrismaService } from './config/prisma.service';
import { SupabaseService } from './config/supabase.service';

// Common
import { HttpExceptionFilter, PrismaExceptionFilter } from './common/filters';
import { EncryptionService, EmailService, StoragePathService } from './common/services';

// i18n
import { I18nModule } from './i18n';

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
import { StorageCleanupModule } from './modules/storage-cleanup/storage-cleanup.module';
import { AlarmsModule } from './modules/alarms/alarms.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { Jai1gentsModule } from './modules/jai1gents/jai1gents.module';
import { ConsentFormModule } from './modules/consent-form/consent-form.module';
import { IrsMonitorModule } from './modules/irs-monitor/irs-monitor.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        ENCRYPTION_KEY: Joi.string().min(32).required(),
        SUPABASE_URL: Joi.string().uri().required(),
        SUPABASE_SERVICE_KEY: Joi.string().required(),
        RESEND_API_KEY: Joi.string().optional(),
        OPENAI_API_KEY: Joi.string().optional(),
        GOOGLE_CLIENT_ID: Joi.string().optional(),
        GOOGLE_CLIENT_SECRET: Joi.string().optional(),
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        PORT: Joi.number().default(3000),
        FRONTEND_URL: Joi.string().required(),
      }),
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{
      ttl: 60000, // 1 minute
      limit: 100, // 100 requests per minute globally
    }]),
    I18nModule,
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
    StorageCleanupModule,
    AlarmsModule,
    ChatbotModule,
    Jai1gentsModule,
    ConsentFormModule,
    IrsMonitorModule,
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
      provide: APP_FILTER,
      useClass: PrismaExceptionFilter,
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
