import { Module } from '@nestjs/common';
import { ConsentFormController } from './consent-form.controller';
import { ConsentFormService } from './consent-form.service';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { StoragePathService } from '../../common/services';

@Module({
  controllers: [ConsentFormController],
  providers: [
    ConsentFormService,
    PrismaService,
    SupabaseService,
    StoragePathService,
  ],
  exports: [ConsentFormService],
})
export class ConsentFormModule {}
