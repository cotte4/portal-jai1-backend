import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsEnum,
  Min,
  Max,
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
  referralId?: string;

  @IsNumber()
  seasonYear: number;

  @IsOptional()
  @IsBoolean()
  applyImmediately?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
