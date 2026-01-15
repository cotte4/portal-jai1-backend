import { IsOptional, IsString, IsDateString, IsEnum, IsInt, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction } from '@prisma/client';

export class AuditLogFiltersDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'User ID must be less than 100 characters' })
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Target user ID must be less than 100 characters' })
  targetUserId?: string;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Search query must be less than 200 characters' })
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class ExportFiltersDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'User ID must be less than 100 characters' })
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Target user ID must be less than 100 characters' })
  targetUserId?: string;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
