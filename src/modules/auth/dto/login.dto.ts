import { IsEmail, IsString, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(255, { message: 'Email must be less than 255 characters' })
  email: string;

  @IsString()
  @MaxLength(200, { message: 'Password must be less than 200 characters' })
  password: string;

  @IsBoolean()
  @IsOptional()
  rememberMe?: boolean;
}
