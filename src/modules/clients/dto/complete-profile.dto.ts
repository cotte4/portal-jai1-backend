import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  ValidateNested,
  IsDateString,
  Matches,
  MaxLength,
  ValidateIf,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Helper to check if validation should run (only when NOT a draft)
 * When is_draft=true, most fields become optional to allow partial saves
 */
const isNotDraft = (o: CompleteProfileDto) => o.is_draft !== true;

/**
 * Helper to check if bank fields should be required
 * Bank fields are required only when NOT a draft AND payment_method is 'bank_deposit' (or not specified)
 */
const requiresBankInfo = (o: CompleteProfileDto) =>
  o.is_draft !== true && o.payment_method !== 'check';

class AddressDto {
  @ApiPropertyOptional({ description: 'Street address', example: '123 Main St' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Street address must be less than 500 characters' })
  street?: string;

  @ApiPropertyOptional({ description: 'City', example: 'New York' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'City must be less than 100 characters' })
  city?: string;

  @ApiPropertyOptional({ description: 'State', example: 'NY' })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'State must be less than 50 characters' })
  state?: string;

  @ApiPropertyOptional({ description: 'ZIP code', example: '10001' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}(-\d{4})?$/, { message: 'Invalid ZIP code format' })
  @MaxLength(20, { message: 'ZIP code must be less than 20 characters' })
  zip?: string;
}

class BankDto {
  @ApiPropertyOptional({ description: 'Bank name', example: 'Chase Bank' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Bank name must be less than 100 characters' })
  name?: string;

  @ApiPropertyOptional({ description: 'Bank routing number (9 digits)', example: '123456789' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{9}$/, { message: 'Routing number must be 9 digits' })
  @MaxLength(20, { message: 'Routing number must be less than 20 characters' })
  routing_number?: string;

  @ApiPropertyOptional({ description: 'Bank account number' })
  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'Account number must be less than 30 characters' })
  account_number?: string;
}

export class CompleteProfileDto {
  @ApiPropertyOptional({ description: 'Whether this is a draft save (allows partial data)', default: false })
  @IsOptional()
  @IsBoolean()
  is_draft?: boolean;

  @ApiPropertyOptional({ description: 'Payment method', enum: ['bank_deposit', 'check'], default: 'bank_deposit' })
  @IsOptional()
  @IsString()
  @IsIn(['bank_deposit', 'check'], { message: 'Payment method must be bank_deposit or check' })
  payment_method?: 'bank_deposit' | 'check';

  @ApiPropertyOptional({ description: 'Social Security Number (9 digits, with or without dashes)', example: '123-45-6789' })
  @ValidateIf(isNotDraft)
  @IsString()
  @Matches(/^(\d{9}|\d{3}-\d{2}-\d{4})$/, {
    message: 'SSN must be 9 digits (with or without dashes)'
  })
  @MaxLength(20, { message: 'SSN must be less than 20 characters' })
  ssn?: string;

  @ApiPropertyOptional({ description: 'Date of birth (ISO 8601)', example: '1995-06-15' })
  @ValidateIf(isNotDraft)
  @IsDateString()
  date_of_birth?: string;

  @ApiPropertyOptional({ description: 'Mailing address', type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ApiPropertyOptional({ description: 'Bank account information', type: BankDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BankDto)
  bank?: BankDto;

  @ApiPropertyOptional({ description: 'State where client worked', example: 'CA' })
  @ValidateIf(isNotDraft)
  @IsString()
  @MaxLength(50, { message: 'Work state must be less than 50 characters' })
  work_state?: string;

  @ApiPropertyOptional({ description: 'Employer name', example: 'Acme Corporation' })
  @ValidateIf(isNotDraft)
  @IsString()
  @MaxLength(200, { message: 'Employer name must be less than 200 characters' })
  employer_name?: string;

  @ApiPropertyOptional({ description: 'TurboTax account email' })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'TurboTax email must be less than 255 characters' })
  turbotax_email?: string;

  @ApiPropertyOptional({ description: 'TurboTax account password' })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'TurboTax password must be less than 200 characters' })
  turbotax_password?: string;

  @ApiPropertyOptional({ description: 'Phone number in E.164 format', example: '+5491112345678' })
  @ValidateIf(isNotDraft)
  @IsString()
  @Matches(/^\+\d{9,18}$/, {
    message: 'Phone must be in E.164 format (e.g., +54911XXXXXXXX)'
  })
  @MaxLength(30, { message: 'Phone must be less than 30 characters' })
  phone?: string;
}
