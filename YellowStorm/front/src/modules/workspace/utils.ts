/**
 * Workspace Module Utilities
 * Shared constants and helper functions
 */

import { toast } from 'sonner';

// ===== Upload Constants =====

/**
 * Allowed MIME types for document upload
 * SYNC WITH: back/src/modules/document/constants/mime-types.constant.ts
 *
 * @deprecated Server-side validation now consults the admin-managed
 * workspace upload settings. This list remains as a client-side
 * pre-filter in `validateFiles` only and should not be treated as
 * authoritative.
 */
export const ALLOWED_MIME_TYPES = [
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/html',
  'text/css',
  'application/json',
  // Images
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

/**
 * Maximum file size in bytes (500MB)
 */
export const MAX_FILE_SIZE = 500 * 1024 * 1024;

/**
 * Maximum files per upload batch
 */
export const MAX_FILES_PER_UPLOAD = 50;

/**
 * Small file threshold for direct upload vs presigned URL (10MB)
 */
export const SMALL_FILE_THRESHOLD = 10 * 1024 * 1024;

/**
 * Default pagination limit
 */
export const DEFAULT_PAGE_LIMIT = 10;

// ===== Formatting Utilities =====

/**
 * Format bytes to human-readable size
 */
export function formatFileSize(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '-';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
export function formatFileSizeNumber(bytes: number): number {
  if (bytes === 0) return 0;
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1));
}

/**
 * Format date string to localized short format
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get file type label from MIME type
 */
export function getFileTypeLabel(mimeType: string): string {
  const typeMap: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/msword': 'DOC',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.ms-excel': 'XLS',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'application/vnd.ms-powerpoint': 'PPT',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
    'text/plain': 'TXT',
    'text/csv': 'CSV',
    'text/markdown': 'MD',
    'text/html': 'HTML',
    'application/json': 'JSON',
    'image/png': 'PNG',
    'image/jpeg': 'JPG',
    'image/gif': 'GIF',
    'image/webp': 'WEBP',
    'image/svg+xml': 'SVG',
  };
  return typeMap[mimeType] || mimeType?.split('/')[1]?.toUpperCase() || 'FILE';
}

// ===== Validation Utilities =====

export interface FileValidationResult {
  validFiles: File[];
  errors: string[];
}

export const ALLOWED_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'csv', 'md', 'html', 'htm', 'json',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
] as const;

/**
 * Check if a file is allowed by MIME type, with extension fallback.
 * Browsers on Windows often report empty MIME for .md files.
 */
function isAllowedFile(file: File): boolean {
  if (ALLOWED_MIME_TYPES.includes(file.type as typeof ALLOWED_MIME_TYPES[number])) {
    return true;
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Validate files for upload
 * Returns valid files and any validation errors
 */
export function validateFiles(files: File[]): FileValidationResult {
  const validFiles: File[] = [];
  const errors: string[] = [];

  if (files.length > MAX_FILES_PER_UPLOAD) {
    toast.error(`Maximum ${MAX_FILES_PER_UPLOAD} files allowed per upload`);
    return { validFiles: [], errors: [] };
  }

  for (const file of files) {
    // Check file type (MIME with extension fallback for unregistered types like .md)
    if (!isAllowedFile(file)) {
      errors.push(`${file.name}: Unsupported file type`);
      continue;
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      errors.push(`${file.name}: File too large (max 500MB)`);
      continue;
    }

    // Check for empty files
    if (file.size === 0) {
      errors.push(`${file.name}: Empty file`);
      continue;
    }

    validFiles.push(file);
  }

  // Show errors
  if (errors.length > 0) {
    const message =
      errors.length > 3
        ? `${errors.slice(0, 3).join('\n')}\n...and ${errors.length - 3} more`
        : errors.join('\n');
    toast.error('Some files were rejected', { description: message });
  }

  return { validFiles, errors };
}

// ===== Link Utilities =====

/**
 * Extract the first http(s) URL from arbitrary dropped/typed text.
 * Returns the URL string, or null if none found.
 */
export function extractUrlFromText(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  const match = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  const candidate = match[0];
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return candidate;
  } catch {
    return null;
  }
}
