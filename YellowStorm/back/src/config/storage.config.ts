import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  // 'ceph' (default) keeps existing deployments untouched; 'azure' switches to
  // Azure Blob / Data Lake Gen2.
  provider: (process.env.STORAGE_PROVIDER || 'ceph').toLowerCase(),

  azure: {
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
    container: process.env.AZURE_STORAGE_CONTAINER_NAME || 'documents',
    // Off by default: existing deployments keep signing with the account key.
    // On, the connection string is unused — an account with shared-key access
    // disabled has none — and AZURE_STORAGE_ACCOUNT_URL names the account.
    useManagedIdentity: process.env.AZURE_STORAGE_USE_MANAGED_IDENTITY === 'true',
    accountUrl: process.env.AZURE_STORAGE_ACCOUNT_URL ?? '',
  },

  s3: {
    endpoint: process.env.CEPH_S3_ENDPOINT || process.env.CEPH_ENDPOINT || '',
    region: process.env.CEPH_S3_REGION || process.env.CEPH_REGION || 'us-east-1',
    bucket: process.env.CEPH_S3_BUCKET || process.env.CEPH_BUCKET_NAME || 'documents',
    accessKeyId: process.env.CEPH_S3_ACCESS_KEY_ID || process.env.CEPH_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.CEPH_S3_SECRET_ACCESS_KEY || process.env.CEPH_SECRET_ACCESS_KEY || '',
    forcePathStyle: process.env.CEPH_S3_FORCE_PATH_STYLE !== 'false',
    publicUrl: process.env.CEPH_S3_PUBLIC_URL || process.env.CEPH_PUBLIC_URL || '',
  },

  // Upload size/count/MIME limits are admin-managed at runtime via
  // catalog.system_settings `platform_settings` (PlatformSettingsService).

  sasExpiryMinutes: Number.parseInt(process.env.STORAGE_SAS_EXPIRY_MINUTES || '60', 10),
  semanticDatasetPrefix: process.env.SEMANTIC_DATASET_STORAGE_PREFIX || 'semantic-model/datasets',
  semanticDatasetMaxSizeMb: Number.parseInt(process.env.SEMANTIC_DATASET_MAX_SIZE_MB || '200', 10),


  healthCheck: {
    enabled: process.env.STORAGE_HEALTH_CHECK_ENABLED !== 'false',
    intervalMs: Number.parseInt(process.env.STORAGE_HEALTH_CHECK_INTERVAL_MS || '60000', 10),
  },

  reconnect: {
    enabled: process.env.STORAGE_RECONNECT_ENABLED !== 'false',
    initialDelayMs: Number.parseInt(process.env.STORAGE_RECONNECT_INITIAL_DELAY_MS || '1000', 10),
    maxDelayMs: Number.parseInt(process.env.STORAGE_RECONNECT_MAX_DELAY_MS || '30000', 10),
    maxAttempts: Number.parseInt(process.env.STORAGE_RECONNECT_MAX_ATTEMPTS || '0', 10),
    multiplier: Number.parseFloat(process.env.STORAGE_RECONNECT_MULTIPLIER || '2'),
  },
}));
