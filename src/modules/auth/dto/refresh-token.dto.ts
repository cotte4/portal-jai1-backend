import { IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @MaxLength(500, { message: 'Refresh token must be less than 500 characters' })
  refresh_token: string;
}
