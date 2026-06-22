import { registerAs } from '@nestjs/config';
import { DEFAULT_ALLOWED_MIME_TYPES } from '../modules/document/constants/mime-types.constant';

export default registerAs('workspace', () => ({
  // File limits
  maxFileSizeMb: Number.parseInt(process.env.WORKSPACE_MAX_FILE_SIZE_MB || '500', 10),
  maxFilesPerBulkUpload: Number.parseInt(
    process.env.WORKSPACE_MAX_FILES_PER_BULK_UPLOAD || '50',
    10,
  ),
  smallFileThresholdMb: Number.parseInt(
    process.env.WORKSPACE_SMALL_FILE_THRESHOLD_MB || '10',
    10,
  ),

  // Session management
  uploadSessionTtlMinutes: Number.parseInt(
    process.env.WORKSPACE_UPLOAD_SESSION_TTL_MINUTES || '60',
    10,
  ),
  sasUrlExpiryMinutes: Number.parseInt(
    process.env.WORKSPACE_SAS_URL_EXPIRY_MINUTES || '60',
    10,
  ),

  // @deprecated Allowed file types are now managed through the admin
  // workspace settings page and read from the `system_settings` collection
  // (key: 'workspace_uploads'). The env var is retained so existing
  // deployments keep their schema entry until they remove it; the upload
  // service no longer consults this value.
  allowedMimeTypes: process.env.WORKSPACE_ALLOWED_MIME_TYPES
    ? process.env.WORKSPACE_ALLOWED_MIME_TYPES.split(',').map((t) => t.trim())
    : [...DEFAULT_ALLOWED_MIME_TYPES],
}));
