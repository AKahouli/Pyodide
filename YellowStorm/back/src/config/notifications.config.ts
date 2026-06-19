import { registerAs } from '@nestjs/config';

export default registerAs('notifications', () => ({
  ttlDays: Number.parseInt(process.env.NOTIFICATION_TTL_DAYS || '30', 10),
  maxConnectionsPerUser: Number.parseInt(
    process.env.NOTIFICATION_MAX_CONNECTIONS_PER_USER || '5',
    10,
  ),
  heartbeatIntervalMs: Number.parseInt(
    process.env.NOTIFICATION_HEARTBEAT_INTERVAL_MS || '15000',
    10,
  ),
  maxPayloadSizeBytes: Number.parseInt(
    process.env.NOTIFICATION_MAX_PAYLOAD_SIZE_BYTES || '10240',
    10,
  ),
  staleCheckIntervalMs: Number.parseInt(
    process.env.NOTIFICATION_STALE_CHECK_INTERVAL_MS || '30000',
    10,
  ),
  tcpKeepAliveMs: Number.parseInt(
    process.env.NOTIFICATION_TCP_KEEP_ALIVE_MS || '30000',
    10,
  ),
}));
