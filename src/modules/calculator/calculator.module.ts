import { Module } from '@nestjs/common';
import { CalculatorController } from './calculator.controller';
import { CalculatorService } from './calculator.service';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { StoragePathService } from '../../common/services';

@Module({
  controllers: [CalculatorController],
  providers: [CalculatorService, PrismaService, SupabaseService, StoragePathService],
  exports: [CalculatorService],
})
export class CalculatorModule {}
