import { registerAs } from '@nestjs/config';

/** Fixed-window rule: at most `limit` hits per `windowMs`. */
export interface AuthRateLimitRule {
  limit: number;
  windowMs: number;
}

/** Endpoints throttled per client IP (Express-resolved, see TRUST_PROXY). */
export type AuthIpRateLimitScope =
  | 'register'
  | 'login'
  | 'refresh'
  | 'verifyEmail'
  | 'resendVerification'
  | 'forgotPassword'
  | 'resetPassword'
  | 'oauthStart'
  | 'oauthCallback';

/** Flows additionally throttled per target account (email or token identity); 'login' counts failed attempts only. */
export type AuthAccountRateLimitScope = 'login' | 'forgotPassword' | 'resendVerification';

export interface AuthLockoutConfig {
  /** Consecutive failed logins for one email before it is temporarily locked. */
  threshold: number;
  /** First lock duration; doubles with every further failure. */
  baseSeconds: number;
  /** Upper bound of the lock duration. */
  maxSeconds: number;
  /** Failure streak is forgotten after this long without a new failure. */
  resetSeconds: number;
}

export interface AuthConfig {
  bcryptRounds: number;
  passwordResetExpiry: number; // hours
  refreshTokenCookieName: string;
  cookieSecure: boolean;
  cookieSameSite: 'strict' | 'lax' | 'none';
  /**
   * Base64 32-byte key encrypting refresh-rotation receipts (lost-response
   * recovery). Provisioned per deployment, distinct from JWT_SECRET. When
   * absent the receipt feature is disabled: rotations stay atomic, but a
   * lost refresh response cannot be recovered and conflicts instead.
   */
  rotationReceiptKey?: string;
  rotationReceiptKeyId: string;
  rotationReceiptWindowSeconds: number;
  /** Minimum wall time of POST /auth/register (0 disables); hides new-vs-existing email timing. */
  registerMinDurationMs: number;
  rateLimits: {
    ip: Record<AuthIpRateLimitScope, AuthRateLimitRule>;
    account: Record<AuthAccountRateLimitScope, AuthRateLimitRule>;
  };
  lockout: AuthLockoutConfig;
}

/** Unset and empty env values both fall back (an empty `NAME=` line in .env is "not configured"). */
function readString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function readInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Env: AUTH_RATE_LIMIT_<KEY>_LIMIT and AUTH_RATE_LIMIT_<KEY>_WINDOW_SECONDS. */
function rule(key: string, limit: number, windowSeconds: number): AuthRateLimitRule {
  return {
    limit: readInt(`AUTH_RATE_LIMIT_${key}_LIMIT`, limit),
    windowMs: readInt(`AUTH_RATE_LIMIT_${key}_WINDOW_SECONDS`, windowSeconds) * 1000,
  };
}

export default registerAs(
  'auth',
  (): AuthConfig => ({
    bcryptRounds: Number.parseInt(readString('AUTH_BCRYPT_ROUNDS', '12'), 10),
    passwordResetExpiry: Number.parseInt(readString('AUTH_PASSWORD_RESET_EXPIRY_HOURS', '1'), 10),
    refreshTokenCookieName: readString('AUTH_REFRESH_TOKEN_COOKIE_NAME', 'refresh_token'),
    cookieSecure: process.env.NODE_ENV === 'production',
    cookieSameSite: readString('AUTH_COOKIE_SAME_SITE', 'strict') as 'strict' | 'lax' | 'none',
    rotationReceiptKey: process.env.AUTH_ROTATION_RECEIPT_KEY,
    rotationReceiptKeyId: readString('AUTH_ROTATION_RECEIPT_KEY_ID', 'receipt-v1'),
    rotationReceiptWindowSeconds: Number.parseInt(
      readString('AUTH_ROTATION_RECEIPT_WINDOW_SECONDS', '120'),
      10,
    ),
    registerMinDurationMs: readNonNegativeInt('AUTH_REGISTER_MIN_DURATION_MS', 1000),
    rateLimits: {
      ip: {
        register: rule('REGISTER_IP', 5, 60),
        login: rule('LOGIN_IP', 10, 60),
        refresh: rule('REFRESH_IP', 30, 60),
        verifyEmail: rule('VERIFY_EMAIL_IP', 5, 60),
        resendVerification: rule('RESEND_VERIFICATION_IP', 3, 300),
        forgotPassword: rule('FORGOT_PASSWORD_IP', 5, 300),
        resetPassword: rule('RESET_PASSWORD_IP', 5, 60),
        oauthStart: rule('OAUTH_START_IP', 10, 60),
        oauthCallback: rule('OAUTH_CALLBACK_IP', 20, 60),
      },
      account: {
        // Failed attempts only (across all IPs); successful logins never count.
        login: rule('LOGIN_ACCOUNT', 20, 900),
        forgotPassword: rule('FORGOT_PASSWORD_ACCOUNT', 3, 900),
        resendVerification: rule('RESEND_VERIFICATION_ACCOUNT', 3, 900),
      },
    },
    lockout: {
      threshold: readInt('AUTH_LOCKOUT_THRESHOLD', 5),
      baseSeconds: readInt('AUTH_LOCKOUT_BASE_SECONDS', 30),
      maxSeconds: readInt('AUTH_LOCKOUT_MAX_SECONDS', 900),
      resetSeconds: readInt('AUTH_LOCKOUT_RESET_SECONDS', 900),
    },
  }),
);
