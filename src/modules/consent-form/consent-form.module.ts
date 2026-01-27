import { Module, forwardRef } from '@nestjs/common';
import { ConsentFormController } from './consent-form.controller';
import { ConsentFormService } from './consent-form.service';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { StoragePathService } from '../../common/services';
import { ProgressModule } from '../progress/progress.module';

@Module({
  imports: [forwardRef(() => ProgressModule)],
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
