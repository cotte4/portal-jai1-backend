import { ConfigService } from '@nestjs/config';

/**
 * Centralized authentication configuration
 * All auth-related settings in one place for easy maintenance
 */
export interface AuthConfig {
  jwtSecret: string;
  accessTokenExpiry: string;
  accessTokenExpiryRememberMe: string;
  refreshTokenExpiry: string;
  refreshTokenExpiryRememberMe: string;
  refreshTokenExpiryMs: number;
  refreshTokenExpiryMsRememberMe: number;
  oauthCodeTtlMs: number;
  /** Access token expiry in seconds (for JWT signing and API response) */
  accessTokenExpirySeconds: number;
  /** Access token expiry in seconds with rememberMe */
  accessTokenExpirySecondsRememberMe: number;
  /** Refresh token expiry in seconds (for JWT signing) */
  refreshTokenExpirySeconds: number;
  /** Refresh token expiry in seconds with rememberMe */
  refreshTokenExpirySecondsRememberMe: number;
}

/**
 * Parse duration string (e.g., '15m', '7d', '30d') to milliseconds
 */
export function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Expected format: <number><unit> (e.g., 15m, 7d)`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Parse duration string to seconds
 */
export function parseDurationToSeconds(duration: string): number {
  return Math.floor(parseDurationToMs(duration) / 1000);
}

/**
 * Get authentication configuration from environment variables
 *
 * Environment variables:
 * - JWT_SECRET: Secret key for signing JWTs (required)
 * - JWT_ACCESS_EXPIRY: Access token expiration (default: '15m')
 * - JWT_ACCESS_EXPIRY_REMEMBER: Access token expiration with rememberMe (default: '7d')
 * - JWT_REFRESH_EXPIRY: Refresh token expiration (default: '7d')
 * - JWT_REFRESH_EXPIRY_REMEMBER: Refresh token expiration with rememberMe (default: '30d')
 * - OAUTH_CODE_TTL: OAuth authorization code TTL (default: '5m')
 */
export function getAuthConfig(configService: ConfigService): AuthConfig {
  const accessTokenExpiry = configService.get<string>('JWT_ACCESS_EXPIRY') || '15m';
  const accessTokenExpiryRememberMe = configService.get<string>('JWT_ACCESS_EXPIRY_REMEMBER') || '1h';
  const refreshTokenExpiry = configService.get<string>('JWT_REFRESH_EXPIRY') || '7d';
  const refreshTokenExpiryRememberMe = configService.get<string>('JWT_REFRESH_EXPIRY_REMEMBER') || '30d';
  const oauthCodeTtl = configService.get<string>('OAUTH_CODE_TTL') || '5m';

  return {
    jwtSecret: configService.get<string>('JWT_SECRET') || '',
    accessTokenExpiry,
    accessTokenExpiryRememberMe,
    refreshTokenExpiry,
    refreshTokenExpiryRememberMe,
    refreshTokenExpiryMs: parseDurationToMs(refreshTokenExpiry),
    refreshTokenExpiryMsRememberMe: parseDurationToMs(refreshTokenExpiryRememberMe),
    oauthCodeTtlMs: parseDurationToMs(oauthCodeTtl),
    accessTokenExpirySeconds: parseDurationToSeconds(accessTokenExpiry),
    accessTokenExpirySecondsRememberMe: parseDurationToSeconds(accessTokenExpiryRememberMe),
    refreshTokenExpirySeconds: parseDurationToSeconds(refreshTokenExpiry),
    refreshTokenExpirySecondsRememberMe: parseDurationToSeconds(refreshTokenExpiryRememberMe),
  };
}
