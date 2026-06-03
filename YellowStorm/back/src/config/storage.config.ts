import { registerAs } from '@nestjs/config';
import { DEFAULT_ALLOWED_MIME_TYPES } from '../modules/document/constants/mime-types.constant';

export default registerAs('storage', () => ({
  s3: {
    endpoint: process.env.CEPH_S3_ENDPOINT || process.env.CEPH_ENDPOINT || '',
    region: process.env.CEPH_S3_REGION || process.env.CEPH_REGION || 'us-east-1',
    bucket: process.env.CEPH_S3_BUCKET || process.env.CEPH_BUCKET_NAME || 'documents',
    accessKeyId: process.env.CEPH_S3_ACCESS_KEY_ID || process.env.CEPH_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.CEPH_S3_SECRET_ACCESS_KEY || process.env.CEPH_SECRET_ACCESS_KEY || '',
    forcePathStyle: process.env.CEPH_S3_FORCE_PATH_STYLE !== 'false',
    publicUrl: process.env.CEPH_S3_PUBLIC_URL || process.env.CEPH_PUBLIC_URL || '',
  },

  maxFileSizeMb: parseInt(process.env.STORAGE_MAX_FILE_SIZE_MB || '50', 10),
  maxFilesPerUpload: parseInt(process.env.STORAGE_MAX_FILES_PER_UPLOAD || '10', 10),

  sasExpiryMinutes: parseInt(process.env.STORAGE_SAS_EXPIRY_MINUTES || '60', 10),

  allowedMimeTypes: process.env.STORAGE_ALLOWED_MIME_TYPES
    ? process.env.STORAGE_ALLOWED_MIME_TYPES.split(',').map((t) => t.trim())
    : [...DEFAULT_ALLOWED_MIME_TYPES],

  healthCheck: {
    enabled: process.env.STORAGE_HEALTH_CHECK_ENABLED !== 'false',
    intervalMs: parseInt(process.env.STORAGE_HEALTH_CHECK_INTERVAL_MS || '60000', 10),
  },

  reconnect: {
    enabled: process.env.STORAGE_RECONNECT_ENABLED !== 'false',
    initialDelayMs: parseInt(process.env.STORAGE_RECONNECT_INITIAL_DELAY_MS || '1000', 10),
    maxDelayMs: parseInt(process.env.STORAGE_RECONNECT_MAX_DELAY_MS || '30000', 10),
    maxAttempts: parseInt(process.env.STORAGE_RECONNECT_MAX_ATTEMPTS || '0', 10),
    multiplier: parseFloat(process.env.STORAGE_RECONNECT_MULTIPLIER || '2'),
  },
}));
