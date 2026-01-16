import { Module } from '@nestjs/common';
import { AlarmsController } from './alarms.controller';
import { AlarmsService } from './alarms.service';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [AlarmsController],
  providers: [AlarmsService, PrismaService],
  exports: [AlarmsService],
})
export class AlarmsModule {}
