import {
  IsString,
  IsOptional,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * DTO for updating sensitive profile fields after initial profile completion.
 * All fields are optional - only provided fields will be updated.
 */
export class UpdateSensitiveProfileDto {
  @IsOptional()
  @IsString()
  @Matches(/^(\d{9}|\d{3}-\d{2}-\d{4})$/, {
    message: 'SSN must be 9 digits (with or without dashes)',
  })
  @MaxLength(20, { message: 'SSN must be less than 20 characters' })
  ssn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Bank name must be less than 100 characters' })
  bankName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{9}$/, { message: 'Routing number must be exactly 9 digits' })
  bankRoutingNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'Account number must be less than 30 characters' })
  bankAccountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'TurboTax email must be less than 255 characters' })
  turbotaxEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'TurboTax password must be less than 200 characters' })
  turbotaxPassword?: string;
}
