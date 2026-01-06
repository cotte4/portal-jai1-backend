import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

// Config
import { PrismaService } from './config/prisma.service';
import { SupabaseService } from './config/supabase.service';

// Common
import { HttpExceptionFilter } from './common/filters';
import { EncryptionService, EmailService } from './common/services';

// Modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ClientsModule } from './modules/clients/clients.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { CalculatorModule } from './modules/calculator/calculator.module';
import { ProgressModule } from './modules/progress/progress.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    UsersModule,
    ClientsModule,
    DocumentsModule,
    TicketsModule,
    NotificationsModule,
    WebhooksModule,
    CalculatorModule,
    ProgressModule,
  ],
  controllers: [],
  providers: [
    PrismaService,
    SupabaseService,
    EncryptionService,
    EmailService,
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
