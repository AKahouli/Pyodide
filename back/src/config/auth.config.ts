import { registerAs } from '@nestjs/config';

export interface AuthConfig {
  bcryptRounds: number;
  emailVerificationExpiry: number; // hours
  passwordResetExpiry: number; // hours
  maxSessionsPerUser: number;
  refreshTokenCookieName: string;
  cookieSecure: boolean;
  cookieSameSite: 'strict' | 'lax' | 'none';
}

export default registerAs(
  'auth',
  (): AuthConfig => ({
    bcryptRounds: parseInt(process.env.AUTH_BCRYPT_ROUNDS || '12', 10),
    emailVerificationExpiry: parseInt(process.env.AUTH_EMAIL_VERIFICATION_EXPIRY_HOURS || '24', 10),
    passwordResetExpiry: parseInt(process.env.AUTH_PASSWORD_RESET_EXPIRY_HOURS || '1', 10),
    maxSessionsPerUser: parseInt(process.env.AUTH_MAX_SESSIONS_PER_USER || '10', 10),
    refreshTokenCookieName: process.env.AUTH_REFRESH_TOKEN_COOKIE_NAME || 'refresh_token',
    cookieSecure: process.env.NODE_ENV === 'production',
    cookieSameSite: (process.env.AUTH_COOKIE_SAME_SITE as 'strict' | 'lax' | 'none') || 'strict',
  }),
);
