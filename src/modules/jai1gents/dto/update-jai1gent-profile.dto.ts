import { IsEnum, IsOptional, IsString, IsEmail, Matches } from 'class-validator';
import { Jai1gentPaymentMethod } from '@prisma/client';

export class UpdateJai1gentProfileDto {
  @IsEnum(Jai1gentPaymentMethod, { message: 'Payment method must be bank_transfer or zelle' })
  @IsOptional()
  payment_method?: Jai1gentPaymentMethod;

  // Bank transfer fields
  @IsString()
  @IsOptional()
  bank_name?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{9}$/, { message: 'Routing number must be 9 digits' })
  bank_routing_number?: string;

  @IsString()
  @IsOptional()
  bank_account_number?: string;

  // Zelle fields
  @IsEmail({}, { message: 'Zelle email must be a valid email' })
  @IsOptional()
  zelle_email?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\+?[\d\s-]{10,}$/, { message: 'Invalid phone number format' })
  zelle_phone?: string;
}
