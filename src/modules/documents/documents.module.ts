import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, PrismaService, SupabaseService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
