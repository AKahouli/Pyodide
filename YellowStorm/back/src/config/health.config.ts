import { registerAs } from '@nestjs/config';

export default registerAs('health', () => ({
  // History tracking
  historyEnabled: process.env.HEALTH_HISTORY_ENABLED !== 'false',

  // Check interval in seconds (minimum 10 seconds to avoid overloading)
  checkIntervalSeconds: Math.max(
    Number.parseInt(process.env.HEALTH_CHECK_INTERVAL_SECONDS || '30', 10),
    10,
  ),

  // Data retention in hours (how long to keep history records)
  retentionHours: Number.parseInt(process.env.HEALTH_RETENTION_HOURS || '24', 10),
}));
