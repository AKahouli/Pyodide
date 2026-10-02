/**
 * Default file extensions authorized for upload across all workspaces.
 * Source of truth for the seeded `system_settings` document with
 * `key: 'workspace_uploads'`. The full extension set is also covered by
 * `EXTENSION_MIME_TYPES` in `document/constants/mime-types.constant.ts` —
 * any extension the admin enables must exist in that map.
 */
export const WORKSPACE_UPLOAD_SETTINGS_KEY = 'workspace_uploads';

export const DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS: readonly string[] = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.csv',
  '.md',
  '.html',
  '.htm',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.zip',
  '.eml',
];

const EXTENSION_PATTERN = /^\.[a-z0-9][a-z0-9+-]{0,15}$/;

export function isValidUploadExtension(value: string): boolean {
  return EXTENSION_PATTERN.test(value);
}

/**
 * Normalize a single user-entered extension. Returns null when the value
 * cannot be turned into a valid extension; callers log and drop.
 */
export function normalizeUploadExtension(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  const withDot = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
  return isValidUploadExtension(withDot) ? withDot : null;
}

/**
 * Extract the extension from a filename. Returns null if no extension
 * is present or it is invalid.
 */
export function getUploadExtension(filename: string): string | null {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === filename.length - 1) return null;
  const raw = filename.slice(lastDot).toLowerCase();
  return isValidUploadExtension(raw) ? raw : null;
}
