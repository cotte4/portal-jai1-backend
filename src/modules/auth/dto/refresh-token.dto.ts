import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token for obtaining new access tokens' })
  @IsString()
  @MaxLength(500, { message: 'Refresh token must be less than 500 characters' })
  refresh_token: string;
}
