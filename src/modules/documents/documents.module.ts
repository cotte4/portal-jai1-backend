import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { ProgressModule } from '../progress/progress.module';

@Module({
  imports: [ProgressModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, PrismaService, SupabaseService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
