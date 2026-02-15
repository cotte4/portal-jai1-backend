import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class UpdateReferralCodeDto {
  @IsString()
  @IsNotEmpty({ message: 'Referral code is required' })
  @Matches(/^[A-Z0-9]{5,15}$/, { message: 'Referral code must be 5-15 uppercase alphanumeric characters' })
  referral_code: string;
}
