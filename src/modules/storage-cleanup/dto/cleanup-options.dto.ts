import { IsBoolean, IsNumber, IsOptional, IsString, Min, Max, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class ScanOptionsDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(168) // Max 1 week
  @Transform(({ value }) => parseInt(value, 10))
  gracePeriodHours?: number = 48;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Bucket name must be less than 100 characters' })
  bucket?: string;
}

export class ExecuteCleanupDto {
  @IsString()
  @MaxLength(50, { message: 'Confirmation must be less than 50 characters' })
  confirmDeletion: string; // Must be 'DELETE_ORPHANS' to proceed

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(168)
  gracePeriodHours?: number = 48;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  maxFiles?: number = 100;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Bucket name must be less than 100 characters' })
  bucket?: string;
}

export interface OrphanFile {
  bucket: string;
  path: string;
  createdAt?: Date;
  reason: string;
}

export interface CleanupResult {
  scannedAt: Date;
  dryRun: boolean;
  gracePeriodHours: number;
  documentsOrphans: OrphanFile[];
  profilePicturesOrphans: OrphanFile[];
  totalOrphans: number;
  deletedCount: number;
  skippedCount: number;
  errors: string[];
}
