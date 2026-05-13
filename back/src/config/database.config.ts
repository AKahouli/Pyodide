import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/yellostorm',

  // Connection Pool Settings
  maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '10', 10),
  minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE || '2', 10),

  // Timeout Settings (in milliseconds)
  serverSelectionTimeoutMs: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT || '5000', 10),
  socketTimeoutMs: parseInt(process.env.MONGODB_SOCKET_TIMEOUT || '45000', 10),
  connectTimeoutMs: parseInt(process.env.MONGODB_CONNECT_TIMEOUT || '10000', 10),

  // Retry Settings
  retryWrites: process.env.MONGODB_RETRY_WRITES !== 'false',
  retryReads: process.env.MONGODB_RETRY_READS !== 'false',
  maxIdleTimeMs: parseInt(process.env.MONGODB_MAX_IDLE_TIME || '60000', 10),

  // Heartbeat
  heartbeatFrequencyMs: parseInt(process.env.MONGODB_HEARTBEAT_FREQUENCY || '10000', 10),

  // Reconnection Settings
  reconnect: {
    enabled: process.env.MONGODB_RECONNECT_ENABLED !== 'false',
    initialDelayMs: parseInt(process.env.MONGODB_RECONNECT_INITIAL_DELAY || '1000', 10),
    maxDelayMs: parseInt(process.env.MONGODB_RECONNECT_MAX_DELAY || '30000', 10),
    maxAttempts: parseInt(process.env.MONGODB_RECONNECT_MAX_ATTEMPTS || '0', 10), // 0 = infinite
    multiplier: parseFloat(process.env.MONGODB_RECONNECT_MULTIPLIER || '2'),
  },
}));
