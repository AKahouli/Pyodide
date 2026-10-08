import { Readable } from 'stream';

/**
 * Storage port. Two backends implement it (Ceph S3 and Azure Blob / Data Lake
 * Gen2), selected by STORAGE_PROVIDER. DocumentService talks only to this
 * interface, so no SDK type or provider quirk leaks into business logic.
 */

export interface StorageObjectMetadata {
  sizeBytes: number;
  contentType?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
}

export interface StorageReadStream {
  body: Readable;
  contentType?: string;
  contentLength?: number;
  contentRange?: string;
  acceptRanges?: string;
  metadata?: Record<string, string>;
}

export interface StoragePutOptions {
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
  contentLength?: number;
}

export interface StorageListPage {
  objects: Array<{ key: string; sizeBytes: number; lastModified?: Date }>;
  continuationToken?: string;
}

export interface SignedUrlOptions {
  expirySeconds: number;
  write: boolean;
  contentDisposition?: string;
}

/** The object is not there. */
export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`Storage object not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}

/**
 * The backend would not say whether the object exists (Ceph RGW answers
 * 403 Unknown to HeadObject for a short window after a presigned PUT).
 * Callers decide how to read the ambiguity.
 */
export class StorageAmbiguousError extends Error {
  constructor(key: string) {
    super(`Storage could not confirm object state: ${key}`);
    this.name = 'StorageAmbiguousError';
  }
}

export interface StorageBackend {
  /** Human-readable backend name, used in connection logs. */
  readonly label: string;

  /** Build the client and make sure the bucket/container is usable. */
  connect(): Promise<void>;
  /** Health probe. Resolves when reachable, throws otherwise. */
  verify(): Promise<void>;
  destroy(): void;

  /** Metadata, or null when the object does not exist. */
  head(key: string): Promise<StorageObjectMetadata | null>;
  getStream(key: string, range?: string): Promise<StorageReadStream>;
  put(key: string, body: Buffer | Readable, options: StoragePutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string | undefined, maxKeys: number, continuationToken?: string): Promise<StorageListPage>;
  copy(sourceKey: string, destinationKey: string): Promise<void>;

  /** Time-limited URL: S3 presigned URL, or Azure SAS URL. */
  signedUrl(key: string, options: SignedUrlOptions): Promise<string>;
  /** Stable, non-signed object URL used as an identifier by the indexer. */
  publicUrl(key: string): string;
}
