import { registerAs } from '@nestjs/config';

export default registerAs('aiProxy', () => ({
  rateLimitPerUser: Number.parseInt(process.env.AI_PROXY_RATE_LIMIT_PER_USER || '60', 10),
  rateLimitWindowMs: Number.parseInt(
    process.env.AI_PROXY_RATE_LIMIT_WINDOW_MS || '60000',
    10,
  ),
  allowedModels: (process.env.AI_PROXY_ALLOWED_MODELS || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean),
  maxTokensPerRequest: Number.parseInt(
    process.env.AI_PROXY_MAX_TOKENS_PER_REQUEST || '4096',
    10,
  ),
  maxBodyBytes: Number.parseInt(
    process.env.AI_PROXY_MAX_BODY_BYTES || '1048576',
    10,
  ),
  maxMessages: Number.parseInt(
    process.env.AI_PROXY_MAX_MESSAGES || '100',
    10,
  ),
  maxMessageContentChars: Number.parseInt(
    process.env.AI_PROXY_MAX_MESSAGE_CONTENT_CHARS || '100000',
    10,
  ),
  /** TTL for opaque AI preview tickets (parent relay only). Default 10 min. */
  previewTicketTtlMs: Number.parseInt(
    process.env.AI_PROXY_PREVIEW_TICKET_TTL_MS || '600000',
    10,
  ),
}));
