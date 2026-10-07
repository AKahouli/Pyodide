import { registerAs } from '@nestjs/config';

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
}

export default registerAs(
  'auth',
  (): AuthConfig => ({
    bcryptRounds: Number.parseInt(process.env.AUTH_BCRYPT_ROUNDS || '12', 10),
    passwordResetExpiry: Number.parseInt(process.env.AUTH_PASSWORD_RESET_EXPIRY_HOURS || '1', 10),
    refreshTokenCookieName: process.env.AUTH_REFRESH_TOKEN_COOKIE_NAME || 'refresh_token',
    cookieSecure: process.env.NODE_ENV === 'production',
    cookieSameSite: (process.env.AUTH_COOKIE_SAME_SITE as 'strict' | 'lax' | 'none') || 'strict',
    rotationReceiptKey: process.env.AUTH_ROTATION_RECEIPT_KEY,
    rotationReceiptKeyId: process.env.AUTH_ROTATION_RECEIPT_KEY_ID || 'receipt-v1',
    rotationReceiptWindowSeconds: Number.parseInt(
      process.env.AUTH_ROTATION_RECEIPT_WINDOW_SECONDS || '120',
      10,
    ),
  }),
);
