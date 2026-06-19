import { registerAs } from '@nestjs/config';

export default registerAs('telegram', () => ({
  enabled: process.env.TELEGRAM_ENABLED !== 'false',
  apiBaseUrl: process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org',
  apiTimeoutMs: Number.parseInt(process.env.TELEGRAM_API_TIMEOUT_MS || '15000', 10),
  linkCodeTtlSeconds: Number.parseInt(process.env.TELEGRAM_LINK_CODE_TTL_SECONDS || '900', 10),
  linkCodeLength: Number.parseInt(process.env.TELEGRAM_LINK_CODE_LENGTH || '8', 10),
  webhookRateLimit: Number.parseInt(process.env.TELEGRAM_WEBHOOK_RATE_LIMIT || '60', 10),
  webhookRateWindowMs: Number.parseInt(process.env.TELEGRAM_WEBHOOK_RATE_WINDOW_MS || '60000', 10),
  maxReplyLength: Number.parseInt(process.env.TELEGRAM_MAX_REPLY_LENGTH || '3900', 10),
}));
