import {
  BlobSASPermissions,
  BlobServiceClient,
  type BlockBlobClient,
  type ContainerClient,
} from '@azure/storage-blob';
import { Readable } from 'stream';
import {
  SignedUrlOptions,
  StorageBackend,
  StorageListPage,
  StorageNotFoundError,
  StorageObjectMetadata,
  StoragePutOptions,
  StorageReadStream,
} from './types';

export interface AzureBackendConfig {
  connectionString: string;
  container: string;
}

const UPLOAD_STREAM_BUFFER_BYTES = 4 * 1024 * 1024;
const UPLOAD_STREAM_CONCURRENCY = 4;
const COPY_SOURCE_SAS_MINUTES = 10;

/**
 * Azure Blob / Data Lake Gen2 backend.
 *
 * A Gen2 account (hierarchical namespace enabled) is fully reachable through
 * the Blob API, and our object keys are already flat paths
 * ("user/folder/file.txt") that map 1:1 onto blob names. So this uses
 * @azure/storage-blob rather than @azure/storage-file-datalake, whose
 * directory semantics we do not need.
 *
 * Authentication is the account connection string, which must carry an account
 * key: SAS generation (used for every download/upload URL) requires it.
 */
export class AzureStorageBackend implements StorageBackend {
  readonly label = 'Azure Blob';

  private container: ContainerClient | null = null;

  constructor(private readonly config: AzureBackendConfig) {}

  async connect(): Promise<void> {
    this.container = BlobServiceClient
      .fromConnectionString(this.config.connectionString)
      .getContainerClient(this.config.container);

    await this.container.createIfNotExists();
  }

  async verify(): Promise<void> {
    await this.requireContainer().getProperties();
  }

  destroy(): void {
    this.container = null;
  }

  async head(key: string): Promise<StorageObjectMetadata | null> {
    try {
      const properties = await this.blob(key).getProperties();
      // A directory entry is not an object; S3 has no equivalent to report.
      if (isDirectoryMarker(properties.metadata)) return null;

      return {
        sizeBytes: properties.contentLength || 0,
        contentType: properties.contentType,
        lastModified: properties.lastModified,
        metadata: properties.metadata,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async getStream(key: string, range?: string): Promise<StorageReadStream> {
    const blob = this.blob(key);

    try {
      const { offset, count } = range
        ? await this.resolveRange(blob, range)
        : { offset: 0, count: undefined };

      const response = await blob.download(offset, count);
      if (!response.readableStreamBody) throw new StorageNotFoundError(key);

      return {
        body: response.readableStreamBody as Readable,
        contentType: response.contentType,
        contentLength: response.contentLength,
        contentRange: response.contentRange,
        acceptRanges: response.acceptRanges ?? 'bytes',
        ...(response.metadata ? { metadata: response.metadata } : {}),
      };
    } catch (error) {
      if (error instanceof StorageNotFoundError) throw error;
      if (isNotFound(error)) throw new StorageNotFoundError(key);
      throw error;
    }
  }

  async put(key: string, body: Buffer | Readable, options: StoragePutOptions): Promise<void> {
    const blob = this.blob(key);
    const uploadOptions = {
      blobHTTPHeaders: {
        blobContentType: options.contentType,
        ...(options.cacheControl ? { blobCacheControl: options.cacheControl } : {}),
      },
      ...(options.metadata ? { metadata: sanitizeMetadata(options.metadata) } : {}),
    };

    if (Buffer.isBuffer(body)) {
      await blob.upload(body, body.byteLength, uploadOptions);
      return;
    }

    await blob.uploadStream(
      body,
      UPLOAD_STREAM_BUFFER_BYTES,
      UPLOAD_STREAM_CONCURRENCY,
      uploadOptions,
    );
  }

  async delete(key: string): Promise<void> {
    await this.blob(key).deleteIfExists();
  }

  async list(
    prefix: string | undefined,
    maxKeys: number,
    continuationToken?: string,
  ): Promise<StorageListPage> {
    // includeMetadata is required to spot the directory entries that a
    // hierarchical-namespace (Data Lake Gen2) account creates on its own:
    // writing "a/b/c.txt" materialises "a" and "a/b", and those survive the
    // deletion of every blob under them. They are not documents, and S3 has
    // no equivalent, so they must not reach callers.
    const pages = this.requireContainer()
      .listBlobsFlat({ includeMetadata: true, ...(prefix ? { prefix } : {}) })
      .byPage({ maxPageSize: maxKeys, continuationToken });

    // Filtering directories can empty a page that still has pages behind it, so
    // keep pulling until something real shows up. Only all-directory pages are
    // skipped, so no page is ever returned twice and nothing overshoots maxKeys.
    let objects: StorageListPage['objects'] = [];
    let token: string | undefined = continuationToken;

    do {
      const { value, done } = await pages.next();
      if (done || !value) {
        token = undefined;
        break;
      }

      const items: Array<{
        name: string;
        metadata?: Record<string, string>;
        properties?: { contentLength?: number; lastModified?: Date };
      }> = value.segment?.blobItems ?? [];

      objects = items
        .filter((item) => !isDirectoryMarker(item.metadata))
        .map((item) => ({
          key: item.name,
          sizeBytes: item.properties?.contentLength || 0,
          lastModified: item.properties?.lastModified,
        }));
      token = value.continuationToken || undefined;
    } while (objects.length === 0 && token);

    return { objects, continuationToken: token };
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    // Server-side copy; the source URL must carry a SAS for Azure to read it.
    const sourceUrl = await this.blob(sourceKey).generateSasUrl({
      permissions: BlobSASPermissions.parse('r'),
      expiresOn: minutesFromNow(COPY_SOURCE_SAS_MINUTES),
    });

    await this.blob(destinationKey).syncCopyFromURL(sourceUrl);
  }

  async signedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    return this.blob(key).generateSasUrl({
      // "cw" mirrors the S3 presigned PutObject this replaces: create + write.
      permissions: BlobSASPermissions.parse(options.write ? 'cw' : 'r'),
      expiresOn: new Date(Date.now() + options.expirySeconds * 1000),
      ...(options.contentDisposition ? { contentDisposition: options.contentDisposition } : {}),
    });
  }

  publicUrl(key: string): string {
    return this.blob(key).url;
  }

  // ============ Private ============

  private requireContainer(): ContainerClient {
    if (!this.container) throw new Error('Azure Blob client not initialized');
    return this.container;
  }

  private blob(key: string): BlockBlobClient {
    return this.requireContainer().getBlockBlobClient(key);
  }

  /**
   * Translate an HTTP byte range into Azure's offset/count pair. Azure has no
   * equivalent of the suffix form ("bytes=-500"), so that one is resolved
   * against the blob length.
   */
  private async resolveRange(
    blob: BlockBlobClient,
    range: string,
  ): Promise<{ offset: number; count: number | undefined }> {
    const [rawStart, rawEnd] = range.replace('bytes=', '').split('-');

    if (rawStart === '') {
      const suffixLength = Number(rawEnd);
      const { contentLength = 0 } = await blob.getProperties();
      const offset = Math.max(0, contentLength - suffixLength);
      return { offset, count: contentLength - offset };
    }

    const offset = Number(rawStart);
    if (rawEnd === '' || rawEnd === undefined) return { offset, count: undefined };
    return { offset, count: Number(rawEnd) - offset + 1 };
  }
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

/**
 * Azure metadata names must be valid C# identifiers, so hyphens — legal in S3
 * metadata — would make the whole upload fail with 400. Map them to
 * underscores rather than losing the upload.
 */
function sanitizeMetadata(metadata: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    sanitized[key.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(?=\d)/, '_')] = value;
  }
  return sanitized;
}

/**
 * Data Lake Gen2 flags its auto-created directory entries with this metadata
 * key. They list like zero-byte blobs but are not objects.
 */
function isDirectoryMarker(metadata?: Record<string, string>): boolean {
  return metadata?.hdi_isfolder === 'true';
}

function isNotFound(error: unknown): boolean {
  const err = error as { statusCode?: number; code?: string; details?: { errorCode?: string } };
  return (
    err?.statusCode === 404 ||
    err?.code === 'BlobNotFound' ||
    err?.code === 'ContainerNotFound' ||
    err?.details?.errorCode === 'BlobNotFound'
  );
}
