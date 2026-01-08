import { IsEnum } from 'class-validator';

export class UpdateReferralStatusDto {
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
