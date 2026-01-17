import {
  IsString,
  IsOptional,
  IsBoolean,
  ValidateNested,
  IsDateString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Helper to check if validation should run (only when NOT a draft)
 * When is_draft=true, most fields become optional to allow partial saves
 */
const isNotDraft = (o: CompleteProfileDto) => o.is_draft !== true;

class AddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Street address must be less than 500 characters' })
  street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'City must be less than 100 characters' })
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'State must be less than 50 characters' })
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5}(-\d{4})?$/, { message: 'Invalid ZIP code format' })
  @MaxLength(20, { message: 'ZIP code must be less than 20 characters' })
  zip?: string;
}

class BankDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Bank name must be less than 100 characters' })
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{9}$/, { message: 'Routing number must be 9 digits' })
  @MaxLength(20, { message: 'Routing number must be less than 20 characters' })
  routing_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'Account number must be less than 30 characters' })
  account_number?: string;
}

export class CompleteProfileDto {
  // is_draft should be validated first to determine conditional validation
  @IsOptional()
  @IsBoolean()
  is_draft?: boolean;

  // Required only when NOT a draft (final submission)
  @ValidateIf(isNotDraft)
  @IsString()
  @Matches(/^(\d{9}|\d{3}-\d{2}-\d{4})$/, {
    message: 'SSN must be 9 digits (with or without dashes)'
  })
  @MaxLength(20, { message: 'SSN must be less than 20 characters' })
  ssn?: string;

  @ValidateIf(isNotDraft)
  @IsDateString()
  date_of_birth?: string;

  // Address and bank are always optional at DTO level
  // but nested fields have their own validation
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BankDto)
  bank?: BankDto;

  @ValidateIf(isNotDraft)
  @IsString()
  @MaxLength(50, { message: 'Work state must be less than 50 characters' })
  work_state?: string;

  @ValidateIf(isNotDraft)
  @IsString()
  @MaxLength(200, { message: 'Employer name must be less than 200 characters' })
  employer_name?: string;

  // Always optional fields (even on final submission)
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'TurboTax email must be less than 255 characters' })
  turbotax_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'TurboTax password must be less than 200 characters' })
  turbotax_password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'Phone must be less than 30 characters' })
  phone?: string;
}
