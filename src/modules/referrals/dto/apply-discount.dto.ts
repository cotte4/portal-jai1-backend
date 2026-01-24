import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsEnum,
  Min,
  Max,
  MaxLength,
} from 'class-validator';

export class ApplyDiscountDto {
  @ApiProperty({ description: 'Type of discount', enum: ['referral_bonus', 'referrer_reward'], example: 'referral_bonus' })
  @IsEnum(['referral_bonus', 'referrer_reward'])
  discountType: 'referral_bonus' | 'referrer_reward';

  @ApiProperty({ description: 'Fixed discount amount in USD', example: 50 })
  @IsNumber()
  @Min(0)
  discountAmount: number;

  @ApiPropertyOptional({ description: 'Percentage discount (0-100)', example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiPropertyOptional({ description: 'Associated referral ID' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Referral ID must be less than 100 characters' })
  referralId?: string;

  @ApiProperty({ description: 'Tax season year', example: 2024 })
  @IsNumber()
  seasonYear: number;

  @ApiPropertyOptional({ description: 'Whether to apply discount immediately', default: false })
  @IsOptional()
  @IsBoolean()
  applyImmediately?: boolean;

  @ApiPropertyOptional({ description: 'Admin notes about the discount' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Notes must be less than 500 characters' })
  notes?: string;
}
