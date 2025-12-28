import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { PrismaService } from '../../config/prisma.service';
import { EncryptionService } from '../../common/services';

@Module({
  controllers: [ClientsController],
  providers: [ClientsService, PrismaService, EncryptionService],
  exports: [ClientsService],
})
export class ClientsModule {}
