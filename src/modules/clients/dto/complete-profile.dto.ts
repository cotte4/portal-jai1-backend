import {
  IsString,
  IsOptional,
  IsBoolean,
  ValidateNested,
  IsDateString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

class AddressDto {
  @IsString()
  @MaxLength(500, { message: 'Street address must be less than 500 characters' })
  street: string;

  @IsString()
  @MaxLength(100, { message: 'City must be less than 100 characters' })
  city: string;

  @IsString()
  @MaxLength(50, { message: 'State must be less than 50 characters' })
  state: string;

  @IsString()
  @Matches(/^\d{5}(-\d{4})?$/, { message: 'Invalid ZIP code format' })
  @MaxLength(20, { message: 'ZIP code must be less than 20 characters' })
  zip: string;
}

class BankDto {
  @IsString()
  @MaxLength(100, { message: 'Bank name must be less than 100 characters' })
  name: string;

  @IsString()
  @Matches(/^\d{9}$/, { message: 'Routing number must be 9 digits' })
  @MaxLength(20, { message: 'Routing number must be less than 20 characters' })
  routing_number: string;

  @IsString()
  @MaxLength(30, { message: 'Account number must be less than 30 characters' })
  account_number: string;
}

export class CompleteProfileDto {
  @IsString()
  @Matches(/^(\d{9}|\d{3}-\d{2}-\d{4})$/, {
    message: 'SSN must be 9 digits (with or without dashes)'
  })
  @MaxLength(20, { message: 'SSN must be less than 20 characters' })
  ssn: string;

  @IsDateString()
  date_of_birth: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;

  @ValidateNested()
  @Type(() => BankDto)
  bank: BankDto;

  @IsString()
  @MaxLength(50, { message: 'Work state must be less than 50 characters' })
  work_state: string;

  @IsString()
  @MaxLength(200, { message: 'Employer name must be less than 200 characters' })
  employer_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'TurboTax email must be less than 255 characters' })
  turbotax_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'TurboTax password must be less than 200 characters' })
  turbotax_password?: string;

  @IsOptional()
  @IsBoolean()
  is_draft?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'Phone must be less than 30 characters' })
  phone?: string;
}
