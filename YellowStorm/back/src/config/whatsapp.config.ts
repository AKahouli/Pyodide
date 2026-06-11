import { registerAs } from '@nestjs/config';

export default registerAs('whatsapp', () => ({
  enabled: process.env.WHATSAPP_ENABLED !== 'false',
  maxReplyLength: parseInt(process.env.WHATSAPP_MAX_REPLY_LENGTH || '4000', 10),
  pairingTimeoutMs: parseInt(process.env.WHATSAPP_PAIRING_TIMEOUT_MS || '300000', 10),
  reconnectInitialDelayMs: parseInt(process.env.WHATSAPP_RECONNECT_INITIAL_DELAY_MS || '1000', 10),
  reconnectMaxDelayMs: parseInt(process.env.WHATSAPP_RECONNECT_MAX_DELAY_MS || '120000', 10),
  reconnectMaxAttempts: parseInt(process.env.WHATSAPP_RECONNECT_MAX_ATTEMPTS || '10', 10),
  connectivityProbeTimeoutMs: parseInt(
    process.env.WHATSAPP_CONNECTIVITY_PROBE_TIMEOUT_MS || '10000',
    10,
  ),
  adkUrl: process.env.API_ADK_URL || '',
  adkUsername: process.env.INDEXING_API_USERNAME || '',
  adkPassword: process.env.INDEXING_API_PASSWORD || '',
  adkStreamTimeoutMs: parseInt(
    process.env.WHATSAPP_ADK_STREAM_TIMEOUT_MS ||
      process.env.CONVERSATION_GRPC_TIMEOUT_MS ||
      '120000',
    10,
  ),
  processingTimeoutMs: parseInt(process.env.WHATSAPP_PROCESSING_TIMEOUT_MS || '180000', 10),
  maxInboundPerMinute: parseInt(process.env.WHATSAPP_MAX_INBOUND_PER_MINUTE || '30', 10),
  fallbackReply: process.env.WHATSAPP_FALLBACK_REPLY || 'I could not generate a response for this message.',
  circuitBreakerFailureThreshold: parseInt(
    process.env.WHATSAPP_CIRCUIT_BREAKER_FAILURE_THRESHOLD || '3',
    10,
  ),
  circuitBreakerCooldownMs: parseInt(
    process.env.WHATSAPP_CIRCUIT_BREAKER_COOLDOWN_MS || '60000',
    10,
  ),
}));
