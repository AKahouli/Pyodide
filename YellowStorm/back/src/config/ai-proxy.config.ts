import { registerAs } from '@nestjs/config';

export default registerAs('aiProxy', () => ({
  rateLimitPerUser: Number.parseInt(process.env.AI_PROXY_RATE_LIMIT_PER_USER || '60', 10),
  rateLimitWindowMs: Number.parseInt(
    process.env.AI_PROXY_RATE_LIMIT_WINDOW_MS || '60000',
    10,
  ),
}));
