import { registerAs } from '@nestjs/config';

export default registerAs('litellm', () => ({
  apiUrl: process.env.LITELLM_API_URL || '',
  apiKey: process.env.LITELLM_API_KEY || '',
  healthEndpoint: '/health/readiness',
  modelsEndpoint: '/v1/model/info',
  timeoutMs: Number.parseInt(process.env.LITELLM_TIMEOUT_MS || '10000', 10),

  // Connection health check settings
  healthCheck: {
    enabled: process.env.LITELLM_HEALTH_CHECK_ENABLED !== 'false',
    intervalMs: Number.parseInt(process.env.LITELLM_HEALTH_CHECK_INTERVAL_MS || '60000', 10), // 60 seconds
  },

  // Reconnection settings
  reconnect: {
    enabled: process.env.LITELLM_RECONNECT_ENABLED !== 'false',
    initialDelayMs: Number.parseInt(process.env.LITELLM_RECONNECT_INITIAL_DELAY_MS || '1000', 10),
    maxDelayMs: Number.parseInt(process.env.LITELLM_RECONNECT_MAX_DELAY_MS || '30000', 10),
    maxAttempts: Number.parseInt(process.env.LITELLM_RECONNECT_MAX_ATTEMPTS || '0', 10), // 0 = unlimited
    multiplier: Number.parseFloat(process.env.LITELLM_RECONNECT_MULTIPLIER || '2'),
  },
}));
