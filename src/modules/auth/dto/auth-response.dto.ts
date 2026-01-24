import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * User information included in auth responses.
 */
export class AuthUserDto {
  @ApiProperty({ description: 'User ID', example: 'uuid-string' })
  id: string;

  @ApiProperty({ description: 'User email', example: 'user@example.com' })
  email: string;

  @ApiProperty({ description: 'User role', enum: ['admin', 'client'], example: 'client' })
  role: 'admin' | 'client';

  @ApiPropertyOptional({ description: 'User first name' })
  firstName?: string;

  @ApiPropertyOptional({ description: 'User last name' })
  lastName?: string;

  @ApiPropertyOptional({ description: 'Whether profile is complete' })
  isProfileComplete?: boolean;

  @ApiPropertyOptional({ description: 'Whether email is verified' })
  isEmailVerified?: boolean;
}

/**
 * Response for login and token refresh endpoints.
 */
export class AuthResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  access_token: string;

  @ApiProperty({ description: 'Refresh token for obtaining new access tokens' })
  refresh_token: string;

  @ApiProperty({ description: 'Access token expiry time in seconds', example: 900 })
  expires_in: number;

  @ApiPropertyOptional({ description: 'User information', type: AuthUserDto })
  user?: AuthUserDto;
}

/**
 * Response for registration endpoint.
 */
export class RegisterResponseDto {
  @ApiProperty({ description: 'Success message', example: 'Registration successful' })
  message: string;

  @ApiProperty({ description: 'User information', type: AuthUserDto })
  user: AuthUserDto;

  @ApiPropertyOptional({ description: 'Whether verification email was sent' })
  verificationEmailSent?: boolean;
}

/**
 * Response for password-related endpoints.
 */
export class PasswordResponseDto {
  @ApiProperty({ description: 'Success message' })
  message: string;
}

/**
 * Response for logout endpoint.
 */
export class LogoutResponseDto {
  @ApiProperty({ description: 'Success message', example: 'Logged out successfully' })
  message: string;
}
