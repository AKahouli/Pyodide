import { registerAs } from '@nestjs/config';

export default registerAs('email', () => ({
  // Provider Selection
  provider: (process.env.EMAIL_PROVIDER || 'smtp') as 'smtp' | 'outlook',

  // SMTP Configuration
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
  },

  // Outlook / Microsoft Graph Configuration
  outlook: {
    clientId: process.env.AZURE_AD_CLIENT_ID || '',
    clientSecret: process.env.AZURE_AD_CLIENT_SECRET || '',
    tenantId: process.env.AZURE_AD_TENANT_ID || '',
    authority: process.env.AZURE_AD_INSTANCE || 'https://login.microsoftonline.com',
    senderEmail: process.env.OUTLOOK_SENDER_EMAIL || process.env.EMAIL_FROM_ADDRESS || '',
  },

  // Sender Configuration
  from: {
    name: process.env.EMAIL_FROM_NAME || 'YelloStorm',
    address: process.env.EMAIL_FROM_ADDRESS || 'noreply@yellostorm.com',
  },

  // Connection Pool
  pool: {
    enabled: process.env.EMAIL_POOL_ENABLED !== 'false',
    maxConnections: parseInt(process.env.EMAIL_POOL_MAX_CONNECTIONS || '5', 10),
    maxMessages: parseInt(process.env.EMAIL_POOL_MAX_MESSAGES || '100', 10),
  },

  // Retry Configuration
  retry: {
    enabled: process.env.EMAIL_RETRY_ENABLED !== 'false',
    maxAttempts: parseInt(process.env.EMAIL_RETRY_MAX_ATTEMPTS || '3', 10),
    initialDelayMs: parseInt(process.env.EMAIL_RETRY_INITIAL_DELAY || '1000', 10),
    maxDelayMs: parseInt(process.env.EMAIL_RETRY_MAX_DELAY || '10000', 10),
    multiplier: parseFloat(process.env.EMAIL_RETRY_MULTIPLIER || '2'),
  },

  // Rate Limiting
  rateLimit: {
    maxPerSecond: parseInt(process.env.EMAIL_RATE_LIMIT_PER_SECOND || '10', 10),
    maxPerMinute: parseInt(process.env.EMAIL_RATE_LIMIT_PER_MINUTE || '100', 10),
  },

  // Timeouts
  connectionTimeoutMs: parseInt(process.env.EMAIL_CONNECTION_TIMEOUT || '10000', 10),
  socketTimeoutMs: parseInt(process.env.EMAIL_SOCKET_TIMEOUT || '30000', 10),

  // Connection health check settings
  healthCheck: {
    enabled: process.env.EMAIL_HEALTH_CHECK_ENABLED !== 'false',
    intervalMs: parseInt(process.env.EMAIL_HEALTH_CHECK_INTERVAL_MS || '60000', 10), // 60 seconds
  },

  // Reconnection settings (separate from retry which is for sending)
  reconnect: {
    enabled: process.env.EMAIL_RECONNECT_ENABLED !== 'false',
    initialDelayMs: parseInt(process.env.EMAIL_RECONNECT_INITIAL_DELAY_MS || '1000', 10),
    maxDelayMs: parseInt(process.env.EMAIL_RECONNECT_MAX_DELAY_MS || '30000', 10),
    maxAttempts: parseInt(process.env.EMAIL_RECONNECT_MAX_ATTEMPTS || '0', 10), // 0 = unlimited
    multiplier: parseFloat(process.env.EMAIL_RECONNECT_MULTIPLIER || '2'),
  },
}));
