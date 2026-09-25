import { registerAs } from '@nestjs/config';

// Default contexts that should only display (not saved to database)
// These are typically startup/bootstrap logs
const DEFAULT_DISPLAY_ONLY_CONTEXTS = [
  'NestFactory',
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
  'NestApplication',
  'Bootstrap',
  'DatabaseModule',
  'LoggerModule',
  'ConfigModule',
];

export default registerAs('logging', () => {
  // Parse display-only contexts from env or use defaults
  const envContexts = process.env.LOGGING_DISPLAY_ONLY_CONTEXTS;
  const displayOnlyContexts = envContexts
    ? envContexts.split(',').map((c) => c.trim()).filter(Boolean)
    : DEFAULT_DISPLAY_ONLY_CONTEXTS;

  return {
    // Buffer configuration
    buffer: {
      maxSize: Number.parseInt(process.env.LOGGING_BUFFER_SIZE || '100', 10),
      flushIntervalMs: Number.parseInt(process.env.LOGGING_FLUSH_INTERVAL_MS || '60000', 10),
    },

    // Enable/disable persistence
    persistenceEnabled: process.env.LOGGING_PERSISTENCE_ENABLED !== 'false',

    // Default options for display and save
    defaultSave: process.env.LOGGING_DEFAULT_SAVE !== 'false',
    defaultDisplay: process.env.LOGGING_DEFAULT_DISPLAY !== 'false',

    // Contexts that should only display (not saved to database)
    // Useful for startup/bootstrap logs that don't need persistence
    displayOnlyContexts,

    // How long persisted logs are kept (swept hourly from ops.logs). The Mongo TTL index was 30 days by
    // default; a busy dev environment writes several hundred thousand entries a day and may want fewer.
    retentionDays: Math.max(1, Number.parseInt(process.env.LOGGING_RETENTION_DAYS || '30', 10) || 30),
  };
});
