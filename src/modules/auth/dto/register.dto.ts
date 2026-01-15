import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(255, { message: 'Email must be less than 255 characters' })
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(50)
  password: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  first_name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  last_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'Phone must be less than 30 characters' })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  referral_code?: string;
}
