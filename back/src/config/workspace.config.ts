import { registerAs } from '@nestjs/config';
import { DEFAULT_ALLOWED_MIME_TYPES } from '../modules/document/constants/mime-types.constant';

export default registerAs('workspace', () => ({
  // File limits
  maxFileSizeMb: parseInt(process.env.WORKSPACE_MAX_FILE_SIZE_MB || '500', 10),
  maxFilesPerBulkUpload: parseInt(
    process.env.WORKSPACE_MAX_FILES_PER_BULK_UPLOAD || '50',
    10,
  ),
  smallFileThresholdMb: parseInt(
    process.env.WORKSPACE_SMALL_FILE_THRESHOLD_MB || '10',
    10,
  ),

  // Session management
  uploadSessionTtlMinutes: parseInt(
    process.env.WORKSPACE_UPLOAD_SESSION_TTL_MINUTES || '60',
    10,
  ),
  sasUrlExpiryMinutes: parseInt(
    process.env.WORKSPACE_SAS_URL_EXPIRY_MINUTES || '60',
    10,
  ),

  // Allowed file types (comma-separated in env, or uses centralized defaults)
  allowedMimeTypes: process.env.WORKSPACE_ALLOWED_MIME_TYPES
    ? process.env.WORKSPACE_ALLOWED_MIME_TYPES.split(',').map((t) => t.trim())
    : [...DEFAULT_ALLOWED_MIME_TYPES],
}));
