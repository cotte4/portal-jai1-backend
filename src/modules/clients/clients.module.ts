import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { PrismaService } from '../../config/prisma.service';
import { EncryptionService, EmailService } from '../../common/services';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProgressModule } from '../progress/progress.module';
import { ReferralsModule } from '../referrals/referrals.module';

@Module({
  imports: [NotificationsModule, ProgressModule, ReferralsModule],
  controllers: [ClientsController],
  providers: [ClientsService, PrismaService, EncryptionService, EmailService],
  exports: [ClientsService],
})
export class ClientsModule {}
