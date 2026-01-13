import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { StoragePathService } from '../../common/services';
import { ProgressModule } from '../progress/progress.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [ProgressModule, AuditLogsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, PrismaService, SupabaseService, StoragePathService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
