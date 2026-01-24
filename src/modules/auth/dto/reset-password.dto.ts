import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsNotEmpty } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Password reset token from email' })
  @IsString()
  @IsNotEmpty({ message: 'Token is required' })
  @MaxLength(500, { message: 'Token must be less than 500 characters' })
  token: string;

  @ApiProperty({ description: 'New password (min 8 characters)', example: 'NewSecureP@ss1' })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(50, { message: 'Password must not exceed 50 characters' })
  new_password: string;
}
