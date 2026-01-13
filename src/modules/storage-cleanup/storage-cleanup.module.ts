import { Module } from '@nestjs/common';
import { StorageCleanupController } from './storage-cleanup.controller';
import { StorageCleanupService } from './storage-cleanup.service';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { StoragePathService } from '../../common/services';

@Module({
  controllers: [StorageCleanupController],
  providers: [
    StorageCleanupService,
    PrismaService,
    SupabaseService,
    StoragePathService,
  ],
  exports: [StorageCleanupService],
})
export class StorageCleanupModule {}
