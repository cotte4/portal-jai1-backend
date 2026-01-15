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
  @IsEnum(['referral_bonus', 'referrer_reward'])
  discountType: 'referral_bonus' | 'referrer_reward';

  @IsNumber()
  @Min(0)
  discountAmount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Referral ID must be less than 100 characters' })
  referralId?: string;

  @IsNumber()
  seasonYear: number;

  @IsOptional()
  @IsBoolean()
  applyImmediately?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Notes must be less than 500 characters' })
  notes?: string;
}
