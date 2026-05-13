import { registerAs } from '@nestjs/config';
import { DEFAULT_ALLOWED_MIME_TYPES } from '../modules/document/constants/mime-types.constant';

export default registerAs('storage', () => ({
  azure: {
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
    containerName: process.env.AZURE_STORAGE_CONTAINER_NAME || 'documents',
    accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME || '',
  },

  // Upload constraints
  maxFileSizeMb: parseInt(process.env.STORAGE_MAX_FILE_SIZE_MB || '50', 10),
  maxFilesPerUpload: parseInt(process.env.STORAGE_MAX_FILES_PER_UPLOAD || '10', 10),

  // SAS URL settings
  sasExpiryMinutes: parseInt(process.env.STORAGE_SAS_EXPIRY_MINUTES || '60', 10),

  // Allowed MIME types (comma-separated in env, or uses centralized defaults)
  allowedMimeTypes: process.env.STORAGE_ALLOWED_MIME_TYPES
    ? process.env.STORAGE_ALLOWED_MIME_TYPES.split(',').map((t) => t.trim())
    : [...DEFAULT_ALLOWED_MIME_TYPES],

  // Connection health check settings
  healthCheck: {
    enabled: process.env.STORAGE_HEALTH_CHECK_ENABLED !== 'false',
    intervalMs: parseInt(process.env.STORAGE_HEALTH_CHECK_INTERVAL_MS || '60000', 10), // 60 seconds
  },

  // Reconnection settings
  reconnect: {
    enabled: process.env.STORAGE_RECONNECT_ENABLED !== 'false',
    initialDelayMs: parseInt(process.env.STORAGE_RECONNECT_INITIAL_DELAY_MS || '1000', 10),
    maxDelayMs: parseInt(process.env.STORAGE_RECONNECT_MAX_DELAY_MS || '30000', 10),
    maxAttempts: parseInt(process.env.STORAGE_RECONNECT_MAX_ATTEMPTS || '0', 10), // 0 = unlimited
    multiplier: parseFloat(process.env.STORAGE_RECONNECT_MULTIPLIER || '2'),
  },
}));
