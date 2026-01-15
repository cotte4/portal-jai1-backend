import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { StorageCleanupService } from './storage-cleanup.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators';
import { ScanOptionsDto, ExecuteCleanupDto } from './dto/cleanup-options.dto';

@Controller('admin/storage-cleanup')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin)
export class StorageCleanupController {
  private readonly logger = new Logger(StorageCleanupController.name);

  constructor(private readonly cleanupService: StorageCleanupService) {}

  /**
   * GET /admin/storage-cleanup/stats
   * Get storage statistics without running a full scan.
   */
  @Get('stats')
  async getStats() {
    this.logger.log('Admin requested storage stats');
    return this.cleanupService.getStats();
  }

  /**
   * GET /admin/storage-cleanup/scan
   * Scan for orphaned files (dry run - does not delete).
   * Returns list of files that would be deleted.
   */
  @Get('scan')
  async scan(@Query() options: ScanOptionsDto) {
    this.logger.log(`Admin requested orphan scan with options: ${JSON.stringify(options)}`);

    const result = await this.cleanupService.scanForOrphans(
      options.gracePeriodHours,
      options.bucket,
    );

    return {
      message: 'Scan complete (dry run)',
      ...result,
    };
  }

  /**
   * POST /admin/storage-cleanup/execute
   * Execute cleanup and delete orphaned files.
   * Requires confirmation string to prevent accidental deletion.
   */
  @Post('execute')
  async execute(@Body() dto: ExecuteCleanupDto) {
    // Safety check: require explicit confirmation
    if (dto.confirmDeletion !== 'DELETE_ORPHANS') {
      throw new BadRequestException(
        'Confirmation required. Set confirmDeletion to "DELETE_ORPHANS" to proceed.',
      );
    }

    this.logger.warn(
      `Admin executing storage cleanup: maxFiles=${dto.maxFiles}, gracePeriod=${dto.gracePeriodHours}h`,
    );

    const result = await this.cleanupService.executeCleanup(
      dto.gracePeriodHours,
      dto.maxFiles,
      dto.bucket,
    );

    return {
      message: `Cleanup complete. Deleted ${result.deletedCount} orphaned files.`,
      ...result,
    };
  }
}
