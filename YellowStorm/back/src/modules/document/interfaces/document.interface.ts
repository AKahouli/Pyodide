export interface UploadedDocument {
  /** Unique document ID (UUID) */
  id: string;

  /** Original filename */
  originalName: string;

  /** Sanitized filename stored in blob storage */
  storedName: string;

  /** Full blob path including folder structure */
  blobPath: string;

  /** MIME type of the file */
  mimeType: string;

  /** File size in bytes */
  size: number;

  /** MD5 hash of the file content */
  contentHash: string;

  /** Canonical object URL (requires presigning for access in private buckets) */
  url: string;

  /** Upload timestamp */
  uploadedAt: Date;

  /** Custom metadata attached to the document */
  metadata?: Record<string, string>;
}

export interface UploadOptions {
  /** Folder path within container (e.g., 'users/123/documents') */
  folder?: string;

  /** Custom metadata to attach to the blob */
  metadata?: Record<string, string>;

  /** Override the original filename */
  customFileName?: string;

  /** Whether to generate a unique filename (default: true) */
  generateUniqueName?: boolean;
}

export interface DownloadOptions {
  /** Return as Buffer instead of stream */
  asBuffer?: boolean;
}

export interface DocumentReadStream {
  body: Readable;
  contentType?: string;
  contentLength?: number;
  contentRange?: string;
  acceptRanges?: string;
}

export interface SasUrlOptions {
  /** Expiry time in minutes (default: from config) */
  expiryMinutes?: number;

  /** Permissions: 'r' = read, 'w' = write, 'd' = delete */
  permissions?: string;

  /** Content disposition for download */
  contentDisposition?: string;

  /** Check if the blob exists before generating the URL (throws NotFoundException if not) */
  checkExists?: boolean;

  /**
   * Allow object keys without a file extension (e.g. Dockerfile, LICENSE).
   * Default false — keys without '.' are treated as folders and rejected.
   */
  allowExtensionless?: boolean;
}

export interface DocumentListOptions {
  /** Folder prefix to filter by */
  folder?: string;

  /** Maximum number of results */
  maxResults?: number;

  /** Continuation token for pagination */
  continuationToken?: string;
}

export interface DocumentListResult {
  documents: DocumentInfo[];
  continuationToken?: string;
}

export interface DocumentInfo {
  name: string;
  blobPath: string;
  size: number;
  contentType: string;
  lastModified: Date;
  metadata?: Record<string, string>;
}
import type { Readable } from 'stream';
