import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsNotEmpty } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password for verification' })
  @IsString()
  @IsNotEmpty({ message: 'Current password is required' })
  @MaxLength(200, { message: 'Current password must be less than 200 characters' })
  current_password: string;

  @ApiProperty({ description: 'New password (min 8 characters)', example: 'NewSecureP@ss1' })
  @IsString()
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, { message: 'New password must be at least 8 characters' })
  @MaxLength(50, { message: 'New password must not exceed 50 characters' })
  new_password: string;
}
