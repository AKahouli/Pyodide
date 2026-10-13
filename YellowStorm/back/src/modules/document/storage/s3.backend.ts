import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import {
  SignedUrlOptions,
  StorageAmbiguousError,
  StorageBackend,
  StorageListPage,
  StorageNotFoundError,
  StorageObjectMetadata,
  StoragePutOptions,
  StorageReadStream,
} from './types';

export interface S3BackendConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicUrl: string;
}

interface S3BackendHooks {
  warn: (message: string, context: Record<string, unknown>) => void;
  log: (message: string, context: Record<string, unknown>) => void;
}

const HEAD_MAX_ATTEMPTS = 3;

export class S3StorageBackend implements StorageBackend {
  readonly label = 'Ceph S3';

  private client: S3Client | null = null;

  constructor(
    private readonly config: S3BackendConfig,
    private readonly hooks: S3BackendHooks,
  ) {}

  async connect(): Promise<void> {
    this.client = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      forcePathStyle: this.config.forcePathStyle,
    });

    await this.ensureBucket();
  }

  async verify(): Promise<void> {
    await this.requireClient().send(new HeadBucketCommand({ Bucket: this.config.bucket }));
  }

  destroy(): void {
    this.client?.destroy();
    this.client = null;
  }

  async head(key: string): Promise<StorageObjectMetadata | null> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= HEAD_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.requireClient().send(
          new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
        );
        return {
          sizeBytes: response.ContentLength || 0,
          contentType: response.ContentType,
          lastModified: response.LastModified,
          metadata: response.Metadata,
        };
      } catch (error) {
        lastError = error;
        if (isNotFound(error)) return null;
        if (!isTransient(error)) throw error;

        if (attempt === HEAD_MAX_ATTEMPTS) break;
        const delayMs = 200 * attempt;
        this.hooks.warn('S3 HeadObject transient error, retrying', {
          attempt,
          maxAttempts: HEAD_MAX_ATTEMPTS,
          delayMs,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Ceph RGW keeps answering 403 Unknown for a short window after a
    // presigned PUT even though the object landed. Report the ambiguity
    // instead of guessing; callers decide what it means.
    if (isTransient(lastError)) throw new StorageAmbiguousError(key);
    throw lastError;
  }

  async getStream(key: string, range?: string): Promise<StorageReadStream> {
    try {
      const response = await this.requireClient().send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key, Range: range }),
      );
      if (!response.Body) throw new StorageNotFoundError(key);

      return {
        body: response.Body as Readable,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        contentRange: response.ContentRange,
        acceptRanges: response.AcceptRanges,
        ...(response.Metadata ? { metadata: response.Metadata } : {}),
      };
    } catch (error) {
      if (error instanceof StorageNotFoundError) throw error;
      if (isNotFound(error)) throw new StorageNotFoundError(key);
      throw error;
    }
  }

  async put(key: string, body: Buffer | Readable, options: StoragePutOptions): Promise<void> {
    await this.requireClient().send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        ContentLength: options.contentLength,
        CacheControl: options.cacheControl,
        Metadata: options.metadata,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.requireClient().send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  async list(
    prefix: string | undefined,
    maxKeys: number,
    continuationToken?: string,
  ): Promise<StorageListPage> {
    const response = await this.requireClient().send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
        ContinuationToken: continuationToken,
      }),
    );

    return {
      objects: (response.Contents || []).map((item) => ({
        key: item.Key || '',
        sizeBytes: item.Size || 0,
        lastModified: item.LastModified,
      })),
      continuationToken: response.NextContinuationToken,
    };
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    await this.requireClient().send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        CopySource: `/${this.config.bucket}/${encodeURIComponent(sourceKey)}`,
        Key: destinationKey,
      }),
    );
  }

  async signedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const command = options.write
      ? new PutObjectCommand({ Bucket: this.config.bucket, Key: key })
      : new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          ResponseContentDisposition: options.contentDisposition,
        });

    return getSignedUrl(this.requireClient(), command, { expiresIn: options.expirySeconds });
  }

  publicUrl(key: string): string {
    const base = (this.config.publicUrl || this.config.endpoint).replace(/\/+$/, '');
    return `${base}/${this.config.bucket}/${key}`;
  }

  // ============ Private ============

  private requireClient(): S3Client {
    if (!this.client) throw new Error('S3 client not initialized');
    return this.client;
  }

  private async ensureBucket(): Promise<void> {
    try {
      await this.requireClient().send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch (error) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      const status = err.$metadata?.httpStatusCode;
      if (status === 404 || err.name === 'NotFound' || err.name === 'NoSuchBucket') {
        this.hooks.log('Bucket not found, creating it', { bucket: this.config.bucket });
        await this.requireClient().send(new CreateBucketCommand({ Bucket: this.config.bucket }));
      } else {
        throw error;
      }
    }
  }
}

function isTransient(error: unknown): boolean {
  const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.$metadata?.httpStatusCode === 403 && err?.name === 'Unknown';
}

function isNotFound(error: unknown): boolean {
  const err = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    err?.name === 'NotFound' ||
    err?.name === 'NoSuchKey' ||
    err?.Code === 'NoSuchKey' ||
    err?.Code === 'NotFound' ||
    err?.$metadata?.httpStatusCode === 404
  );
}
