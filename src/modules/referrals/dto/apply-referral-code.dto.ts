import { IsString, MinLength, MaxLength } from 'class-validator';

export class ApplyReferralCodeDto {
  @IsString()
  @MinLength(4, { message: 'Referral code must be at least 4 characters' })
  @MaxLength(10, { message: 'Referral code must be at most 10 characters' })
  code: string;
}
