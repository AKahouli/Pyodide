import { registerAs } from '@nestjs/config';

export interface JwtConfig {
  secret: string;
  accessExpiry: string;
  refreshExpiry: string;
  issuer: string;
  audience: string;
}

export default registerAs('jwt', (): JwtConfig => {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!secret && isProduction) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }

  if (!secret) {
    console.warn(
      '\x1b[33m[WARNING] JWT_SECRET not set - using insecure default. Set JWT_SECRET in production!\x1b[0m',
    );
  }

  return {
    secret: secret || 'dev-only-insecure-secret-do-not-use-in-production',
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
    issuer: process.env.JWT_ISSUER || 'yellostorm',
    audience: process.env.JWT_AUDIENCE || 'yellostorm-api',
  };
});
