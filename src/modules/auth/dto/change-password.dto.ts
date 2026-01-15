import { IsString, MinLength, MaxLength, IsNotEmpty } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Current password is required' })
  @MaxLength(200, { message: 'Current password must be less than 200 characters' })
  current_password: string;

  @IsString()
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, { message: 'New password must be at least 8 characters' })
  @MaxLength(50, { message: 'New password must not exceed 50 characters' })
  new_password: string;
}
