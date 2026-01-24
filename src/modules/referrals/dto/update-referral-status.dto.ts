import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class UpdateReferralStatusDto {
  @ApiProperty({
    description: 'New referral status',
    enum: ['pending', 'tax_form_submitted', 'awaiting_refund', 'successful', 'expired'],
    example: 'successful',
  })
  @IsEnum([
    'pending',
    'tax_form_submitted',
    'awaiting_refund',
    'successful',
    'expired',
  ])
  status:
    | 'pending'
    | 'tax_form_submitted'
    | 'awaiting_refund'
    | 'successful'
    | 'expired';
}
