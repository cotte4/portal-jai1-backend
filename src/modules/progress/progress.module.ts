import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProgressAutomationService } from './progress-automation.service';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailService } from '../../common/services';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => NotificationsModule),
  ],
  providers: [
    ProgressAutomationService,
    PrismaService,
    EmailService,
  ],
  exports: [ProgressAutomationService],
})
export class ProgressModule {}
