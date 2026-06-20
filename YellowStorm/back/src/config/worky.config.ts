import { registerAs } from '@nestjs/config';

/**
 * Worky (Chief of Staff) runtime configuration. Mirrors the per-feature
 * `registerAs` pattern used by `playbook-flow` and `conversationV2`. Values
 * are sourced from the `WORKY_*` env vars validated in `config.schema.ts`.
 */
export default registerAs('worky', () => ({
  runtimeBaseUrl: process.env.WORKY_RUNTIME_BASE_URL || 'http://worky-adk-runtime:8011',
  runtimeTimeoutMs: parseInt(process.env.WORKY_RUNTIME_TIMEOUT_MS || '120000', 10),
  serviceToken: process.env.WORKY_SERVICE_TOKEN || '',
  sseHeartbeatMs: parseInt(process.env.WORKY_SSE_HEARTBEAT_MS || '15000', 10),
  maxSseConnections: parseInt(process.env.WORKY_MAX_SSE_CONNECTIONS || '5', 10),
  defaultStorageBytes: parseInt(process.env.WORKY_DEFAULT_STORAGE_BYTES || '52428800', 10),
  idempotencyTtlHours: parseInt(process.env.WORKY_IDEMPOTENCY_TTL_HOURS || '24', 10),
}));
