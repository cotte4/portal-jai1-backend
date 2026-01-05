import {
  IsString,
  IsOptional,
  IsBoolean,
  ValidateNested,
  IsDateString,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

class AddressDto {
  @IsString()
  street: string;

  @IsString()
  city: string;

  @IsString()
  state: string;

  @IsString()
  @Matches(/^\d{5}(-\d{4})?$/, { message: 'Invalid ZIP code format' })
  zip: string;
}

class BankDto {
  @IsString()
  name: string;

  @IsString()
  @Matches(/^\d{9}$/, { message: 'Routing number must be 9 digits' })
  routing_number: string;

  @IsString()
  account_number: string;
}

export class CompleteProfileDto {
  @IsString()
  @Matches(/^(\d{9}|\d{3}-\d{2}-\d{4})$/, {
    message: 'SSN must be 9 digits (with or without dashes)'
  })
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
  work_state: string;

  @IsString()
  employer_name: string;

  @IsOptional()
  @IsString()
  turbotax_email?: string;

  @IsOptional()
  @IsString()
  turbotax_password?: string;

  @IsOptional()
  @IsBoolean()
  is_draft?: boolean;

  @IsOptional()
  @IsString()
  phone?: string;
}
