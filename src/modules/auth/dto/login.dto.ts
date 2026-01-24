import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'User email address', example: 'user@example.com' })
  @IsEmail()
  @MaxLength(255, { message: 'Email must be less than 255 characters' })
  email: string;

  @ApiProperty({ description: 'User password', example: 'SecureP@ss1' })
  @IsString()
  @MaxLength(200, { message: 'Password must be less than 200 characters' })
  password: string;

  @ApiPropertyOptional({ description: 'Remember login session', default: false })
  @IsBoolean()
  @IsOptional()
  rememberMe?: boolean;
}
