import { registerAs } from '@nestjs/config';

export interface JwtConfig {
  secret: string;
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
    issuer: process.env.JWT_ISSUER || 'yellostorm',
    audience: process.env.JWT_AUDIENCE || 'yellostorm-api',
  };
});
