import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  ValidateNested,
  IsIn,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

class UpdateUserInfoAddressDto {
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

  @ApiPropertyOptional({ description: 'ZIP/Postal code', example: '10001' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9\s\-]{3,15}$/, { message: 'ZIP code must be 3-15 alphanumeric characters' })
  @MaxLength(20, { message: 'ZIP code must be less than 20 characters' })
  zip?: string;
}

/**
 * DTO for updating user info (name, phone, dateOfBirth, language, address).
 * All fields are optional - only provided fields will be updated.
 */
export class UpdateUserInfoDto {
  @ApiPropertyOptional({ description: 'Phone number', example: '+5491112345678' })
  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'Phone must be less than 30 characters' })
  phone?: string;

  @ApiPropertyOptional({ description: 'First name', example: 'John' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'First name must be less than 100 characters' })
  firstName?: string;

  @ApiPropertyOptional({ description: 'Last name', example: 'Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Last name must be less than 100 characters' })
  lastName?: string;

  @ApiPropertyOptional({ description: 'Date of birth (ISO 8601)', example: '1995-06-15' })
  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'Date of birth must be less than 30 characters' })
  dateOfBirth?: string;

  @ApiPropertyOptional({ description: 'Preferred language', enum: ['es', 'en', 'pt'], example: 'en' })
  @IsOptional()
  @IsString()
  @IsIn(['es', 'en', 'pt'], { message: 'Preferred language must be es, en, or pt' })
  preferredLanguage?: string;

  @ApiPropertyOptional({ description: 'Mailing address', type: UpdateUserInfoAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateUserInfoAddressDto)
  address?: UpdateUserInfoAddressDto;
}
