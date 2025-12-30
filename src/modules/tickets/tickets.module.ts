import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../../common/services';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [TicketsController],
  providers: [TicketsService, PrismaService, EmailService],
  exports: [TicketsService],
})
export class TicketsModule {}
