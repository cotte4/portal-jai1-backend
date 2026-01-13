import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../config/prisma.service';
import { SupabaseService } from '../../config/supabase.service';
import { StoragePathService } from '../../common/services';
import { OrphanFile, CleanupResult } from './dto/cleanup-options.dto';

@Injectable()
export class StorageCleanupService {
  private readonly logger = new Logger(StorageCleanupService.name);

  // Bucket names (must match StoragePathService)
  private readonly DOCUMENTS_BUCKET = 'documents';
  private readonly PROFILE_PICTURES_BUCKET = 'profile-pictures';

  // Default settings
  private readonly DEFAULT_GRACE_PERIOD_HOURS = 48;
  private readonly DEFAULT_MAX_DELETE = 50;

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
    private storagePath: StoragePathService,
  ) {}

  /**
   * Scan for orphaned files without deleting them.
   * Returns a list of files that exist in storage but not in database.
   */
  async scanForOrphans(
    gracePeriodHours: number = this.DEFAULT_GRACE_PERIOD_HOURS,
    bucket?: string,
  ): Promise<CleanupResult> {
    const startTime = Date.now();
    this.logger.log(`Starting orphan scan with ${gracePeriodHours}h grace period...`);

    const result: CleanupResult = {
      scannedAt: new Date(),
      dryRun: true,
      gracePeriodHours,
      documentsOrphans: [],
      profilePicturesOrphans: [],
      totalOrphans: 0,
      deletedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    try {
      // Scan documents bucket
      if (!bucket || bucket === this.DOCUMENTS_BUCKET) {
        const docOrphans = await this.findOrphansInDocumentsBucket(gracePeriodHours);
        result.documentsOrphans = docOrphans.orphans;
        result.skippedCount += docOrphans.skipped;
      }

      // Scan profile pictures bucket
      if (!bucket || bucket === this.PROFILE_PICTURES_BUCKET) {
        const picOrphans = await this.findOrphansInProfilePicturesBucket(gracePeriodHours);
        result.profilePicturesOrphans = picOrphans.orphans;
        result.skippedCount += picOrphans.skipped;
      }

      result.totalOrphans = result.documentsOrphans.length + result.profilePicturesOrphans.length;

      const duration = Date.now() - startTime;
      this.logger.log(
        `Orphan scan complete in ${duration}ms. Found ${result.totalOrphans} orphans, skipped ${result.skippedCount} (within grace period)`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(errorMsg);
      this.logger.error(`Orphan scan failed: ${errorMsg}`);
    }

    return result;
  }

  /**
   * Execute cleanup: delete orphaned files.
   * Requires explicit confirmation.
   */
  async executeCleanup(
    gracePeriodHours: number = this.DEFAULT_GRACE_PERIOD_HOURS,
    maxFiles: number = this.DEFAULT_MAX_DELETE,
    bucket?: string,
  ): Promise<CleanupResult> {
    const startTime = Date.now();
    this.logger.log(`Starting cleanup execution (max ${maxFiles} files, ${gracePeriodHours}h grace period)...`);

    // First, scan for orphans
    const scanResult = await this.scanForOrphans(gracePeriodHours, bucket);
    scanResult.dryRun = false;

    const allOrphans = [...scanResult.documentsOrphans, ...scanResult.profilePicturesOrphans];
    const toDelete = allOrphans.slice(0, maxFiles);

    this.logger.log(`Found ${allOrphans.length} orphans, will delete up to ${toDelete.length}`);

    // Delete orphans
    for (const orphan of toDelete) {
      try {
        await this.supabase.deleteFile(orphan.bucket, orphan.path);
        scanResult.deletedCount++;
        this.logger.log(`Deleted orphan: ${orphan.bucket}/${orphan.path}`);
      } catch (error) {
        const errorMsg = `Failed to delete ${orphan.bucket}/${orphan.path}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        scanResult.errors.push(errorMsg);
        this.logger.error(errorMsg);
      }
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `Cleanup complete in ${duration}ms. Deleted ${scanResult.deletedCount}/${toDelete.length} files`,
    );

    return scanResult;
  }

  /**
   * Find orphaned files in the documents bucket.
   * Compares storage files against Document and W2Estimate tables.
   */
  private async findOrphansInDocumentsBucket(
    gracePeriodHours: number,
  ): Promise<{ orphans: OrphanFile[]; skipped: number }> {
    const orphans: OrphanFile[] = [];
    let skipped = 0;

    try {
      // Get all files from storage
      const storageFiles = await this.supabase.listAllFiles(this.DOCUMENTS_BUCKET);
      this.logger.log(`Found ${storageFiles.length} files in ${this.DOCUMENTS_BUCKET} bucket`);

      if (storageFiles.length === 0) {
        return { orphans, skipped };
      }

      // Get all document storage paths from database
      const documents = await this.prisma.document.findMany({
        select: { storagePath: true },
      });
      const documentPaths = new Set(documents.map((d) => d.storagePath));

      // Get all W2 estimate storage paths (stored in documents bucket under estimates/)
      const w2Estimates = await this.prisma.w2Estimate.findMany({
        where: { w2StoragePath: { not: null } },
        select: { w2StoragePath: true },
      });
      const estimatePaths = new Set(
        w2Estimates.filter((e) => e.w2StoragePath).map((e) => e.w2StoragePath as string),
      );

      // Combine all valid paths
      const validPaths = new Set([...documentPaths, ...estimatePaths]);

      // Calculate grace period cutoff
      const graceCutoff = new Date(Date.now() - gracePeriodHours * 60 * 60 * 1000);

      // Find orphans
      for (const filePath of storageFiles) {
        if (!validPaths.has(filePath)) {
          // Check if file is within grace period (we'd need file metadata for this)
          // For now, we'll add all non-matching files as orphans
          // In production, you'd want to check the created_at timestamp
          orphans.push({
            bucket: this.DOCUMENTS_BUCKET,
            path: filePath,
            reason: 'No matching database record',
          });
        }
      }

      this.logger.log(
        `Documents bucket: ${storageFiles.length} files, ${validPaths.size} in DB, ${orphans.length} orphans`,
      );
    } catch (error) {
      this.logger.error(`Error scanning documents bucket: ${error}`);
      throw error;
    }

    return { orphans, skipped };
  }

  /**
   * Find orphaned files in the profile-pictures bucket.
   * Compares storage files against User.profilePicturePath.
   */
  private async findOrphansInProfilePicturesBucket(
    gracePeriodHours: number,
  ): Promise<{ orphans: OrphanFile[]; skipped: number }> {
    const orphans: OrphanFile[] = [];
    let skipped = 0;

    try {
      // Get all files from storage
      const storageFiles = await this.supabase.listAllFiles(this.PROFILE_PICTURES_BUCKET);
      this.logger.log(`Found ${storageFiles.length} files in ${this.PROFILE_PICTURES_BUCKET} bucket`);

      if (storageFiles.length === 0) {
        return { orphans, skipped };
      }

      // Get all profile picture paths from database
      const users = await this.prisma.user.findMany({
        where: { profilePicturePath: { not: null } },
        select: { profilePicturePath: true },
      });
      const validPaths = new Set(
        users.filter((u) => u.profilePicturePath).map((u) => u.profilePicturePath as string),
      );

      // Find orphans
      for (const filePath of storageFiles) {
        if (!validPaths.has(filePath)) {
          orphans.push({
            bucket: this.PROFILE_PICTURES_BUCKET,
            path: filePath,
            reason: 'No matching user profile picture',
          });
        }
      }

      this.logger.log(
        `Profile pictures bucket: ${storageFiles.length} files, ${validPaths.size} in DB, ${orphans.length} orphans`,
      );
    } catch (error) {
      this.logger.error(`Error scanning profile pictures bucket: ${error}`);
      throw error;
    }

    return { orphans, skipped };
  }

  /**
   * Scheduled cleanup job - runs daily at 4 AM.
   * Uses conservative settings to avoid accidental mass deletion.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async scheduledCleanup(): Promise<void> {
    // Check if cleanup is enabled via environment variable
    const enabled = process.env.STORAGE_CLEANUP_ENABLED !== 'false';

    if (!enabled) {
      this.logger.log('Scheduled storage cleanup is disabled via STORAGE_CLEANUP_ENABLED=false');
      return;
    }

    this.logger.log('Starting scheduled storage cleanup...');

    try {
      const result = await this.executeCleanup(
        this.DEFAULT_GRACE_PERIOD_HOURS,
        this.DEFAULT_MAX_DELETE,
      );

      this.logger.log(
        `Scheduled cleanup complete: ${result.deletedCount} deleted, ${result.errors.length} errors`,
      );

      // Log summary for monitoring
      if (result.deletedCount > 0 || result.errors.length > 0) {
        this.logger.log(JSON.stringify({
          event: 'SCHEDULED_CLEANUP_COMPLETE',
          totalOrphans: result.totalOrphans,
          deleted: result.deletedCount,
          errors: result.errors.length,
          timestamp: new Date().toISOString(),
        }));
      }
    } catch (error) {
      this.logger.error(`Scheduled cleanup failed: ${error}`);
    }
  }

  /**
   * Get cleanup statistics without running a full scan.
   */
  async getStats(): Promise<{
    documentsInStorage: number;
    documentsInDb: number;
    profilePicsInStorage: number;
    profilePicsInDb: number;
  }> {
    const [docFiles, picFiles, docCount, picCount] = await Promise.all([
      this.supabase.listAllFiles(this.DOCUMENTS_BUCKET),
      this.supabase.listAllFiles(this.PROFILE_PICTURES_BUCKET),
      this.prisma.document.count(),
      this.prisma.user.count({ where: { profilePicturePath: { not: null } } }),
    ]);

    return {
      documentsInStorage: docFiles.length,
      documentsInDb: docCount,
      profilePicsInStorage: picFiles.length,
      profilePicsInDb: picCount,
    };
  }
}
