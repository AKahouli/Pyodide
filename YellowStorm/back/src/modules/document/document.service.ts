import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';
import { LoggerService } from '../logger';
import {
  UploadedDocument,
  UploadOptions,
  SasUrlOptions,
  DocumentListOptions,
  DocumentListResult,
  DocumentInfo,
} from './interfaces/document.interface';
import { BadRequestException, InternalServerException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { DocumentConnectionService, StorageConnectionStatus } from './document-connection.service';
import {
  collapseCharSet,
  collapseRepeatedChar,
  stripLeadingTrailingChar,
  stripLeadingTrailingWhitespaceOrDot,
  stripTrailingChar,
} from '@common/utils';

@Injectable()
export class DocumentService {
  private readonly maxFileSizeBytes: number;
  private readonly maxFilesPerUpload: number;
  private readonly sasExpiryMinutes: number;
  private readonly allowedMimeTypes: string[];

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly connectionService: DocumentConnectionService,
  ) {
    this.logger.setContext(DocumentService.name);

    this.maxFileSizeBytes =
      this.configService.get<number>('storage.maxFileSizeMb', 50) * 1024 * 1024;
    this.maxFilesPerUpload = this.configService.get<number>('storage.maxFilesPerUpload', 10);
    this.sasExpiryMinutes = this.configService.get<number>('storage.sasExpiryMinutes', 60);
    this.allowedMimeTypes = this.configService.get<string[]>('storage.allowedMimeTypes', []);
  }

  isAvailable(): boolean {
    return this.connectionService.isConnectedNow();
  }

  getHealthStatus(): StorageConnectionStatus {
    return this.connectionService.getHealthStatus();
  }

  private getS3Client(): S3Client {
    const client = this.connectionService.getS3Client();
    if (!client) {
      throw new InternalServerException(undefined, 'Document service is not available');
    }
    return client;
  }

  private getBucket(): string {
    return this.connectionService.getBucket();
  }

  /**
   * Upload a document to Ceph S3
   */
  async upload(
    file: Buffer | Readable,
    originalName: string,
    mimeType: string,
    options: UploadOptions = {},
  ): Promise<UploadedDocument> {
    this.ensureAvailable();
    this.validateFile(originalName, mimeType, file instanceof Buffer ? file.length : undefined);

    const id = uuidv4();
    const sanitizedName = this.sanitizeFileName(originalName);
    const storedName =
      options.generateUniqueName !== false
        ? `${id}-${sanitizedName}`
        : options.customFileName || sanitizedName;

    const folder = options.folder ? this.sanitizePath(options.folder) : '';
    const objectKey = folder ? `${folder}/${storedName}` : storedName;

    let uploadData: Buffer;
    if (file instanceof Buffer) {
      uploadData = file;
    } else {
      uploadData = await this.streamToBuffer(file as Readable);
    }

    const size = uploadData.length;
    if (size > this.maxFileSizeBytes) {
      throw new BadRequestException(
        `File size ${Math.round(size / 1024 / 1024)}MB exceeds maximum ${Math.round(
          this.maxFileSizeBytes / 1024 / 1024,
        )}MB`,
      );
    }

    const contentHash = this.calculateHash(uploadData);

    const metadata: Record<string, string> = {
      originalname: encodeURIComponent(originalName),
      uploadedat: new Date().toISOString(),
      contenthash: contentHash,
      ...this.normalizeMetadata(options.metadata),
    };

    try {
      await this.getS3Client().send(
        new PutObjectCommand({
          Bucket: this.getBucket(),
          Key: objectKey,
          Body: uploadData,
          ContentType: mimeType,
          CacheControl: 'max-age=31536000',
          Metadata: metadata,
        }),
      );

      this.logger.log('Document uploaded', {
        id,
        objectKey,
        size,
        mimeType,
      });

      return {
        id,
        originalName,
        storedName,
        blobPath: objectKey,
        mimeType,
        size,
        contentHash,
        url: this.getObjectUrl(objectKey),
        uploadedAt: new Date(),
        metadata: options.metadata,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to upload document', {
        message: err.message,
        objectKey,
      });
      throw new InternalServerException(err, 'Failed to upload document');
    }
  }

  async uploadMany(
    files: Array<{ buffer: Buffer; originalName: string; mimeType: string }>,
    options: UploadOptions = {},
  ): Promise<UploadedDocument[]> {
    if (files.length > this.maxFilesPerUpload) {
      throw new BadRequestException(
        `Cannot upload more than ${this.maxFilesPerUpload} files at once`,
      );
    }

    return Promise.all(
      files.map((file) => this.upload(file.buffer, file.originalName, file.mimeType, options)),
    );
  }

  async download(objectKey: string): Promise<Buffer> {
    this.ensureAvailable();

    try {
      const response = await this.getS3Client().send(
        new GetObjectCommand({ Bucket: this.getBucket(), Key: objectKey }),
      );

      if (!response.Body) {
        throw new BadRequestException('Document not found');
      }

      return this.streamToBuffer(response.Body as Readable);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (this.isNotFoundError(error)) {
        throw new BadRequestException('Document not found');
      }

      const err = error as Error;
      this.logger.error('Failed to download document', {
        message: err.message,
        objectKey,
      });
      throw new InternalServerException(err, 'Failed to download document');
    }
  }

  async delete(objectKey: string): Promise<void> {
    this.ensureAvailable();

    try {
      await this.getS3Client().send(
        new DeleteObjectCommand({ Bucket: this.getBucket(), Key: objectKey }),
      );

      this.logger.log('Document deleted', { objectKey });
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to delete document', {
        message: err.message,
        objectKey,
      });
      throw new InternalServerException(err, 'Failed to delete document');
    }
  }

  async deleteMany(objectKeys: string[]): Promise<void> {
    await Promise.all(objectKeys.map((key) => this.delete(key)));
  }

  async exists(objectKey: string): Promise<boolean> {
    this.ensureAvailable();

    try {
      await this.headObjectWithRetry(objectKey);
      return true;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return false;
      }
      const err = error as {
        name?: string;
        message?: string;
        $metadata?: { httpStatusCode?: number };
      };
      this.logger.error('S3 HeadObject failed (not a 404)', {
        objectKey,
        bucket: this.getBucket(),
        errorName: err?.name,
        message: err?.message,
        httpStatusCode: err?.$metadata?.httpStatusCode,
      });
      throw error;
    }
  }

  /**
   * Generate a presigned URL for temporary access (read by default).
   * Method name retained for backward compatibility with existing callers
   * — the underlying mechanism is S3 presigned URLs (not Azure SAS).
   */
  async generateSasUrl(objectKey: string, options: SasUrlOptions = {}): Promise<string> {
    this.ensureAvailable();

    // Folders have no extension and no underlying S3 object — reject early.
    if (!objectKey.includes('.')) {
      throw new BadRequestException('Cannot generate download URL for folders');
    }

    if (options.checkExists) {
      const objectExists = await this.exists(objectKey);
      if (!objectExists) {
        throw new NotFoundException(
          ErrorCode.WORKSPACE_DOCUMENT_NOT_IN_BLOB,
          'Document file not found in storage',
        );
      }
    }

    const expirySeconds = (options.expiryMinutes || this.sasExpiryMinutes) * 60;
    const permissions = options.permissions || 'r';
    const isWrite = permissions.includes('w') || permissions.includes('c');

    if (isWrite) {
      return getSignedUrl(
        this.getS3Client(),
        new PutObjectCommand({
          Bucket: this.getBucket(),
          Key: objectKey,
        }),
        { expiresIn: expirySeconds },
      );
    }

    return getSignedUrl(
      this.getS3Client(),
      new GetObjectCommand({
        Bucket: this.getBucket(),
        Key: objectKey,
        ResponseContentDisposition: options.contentDisposition,
      }),
      { expiresIn: expirySeconds },
    );
  }

  async list(options: DocumentListOptions = {}): Promise<DocumentListResult> {
    this.ensureAvailable();

    try {
      const response: ListObjectsV2CommandOutput = await this.getS3Client().send(
        new ListObjectsV2Command({
          Bucket: this.getBucket(),
          Prefix: options.folder,
          MaxKeys: options.maxResults || 100,
          ContinuationToken: options.continuationToken,
        }),
      );

      const documents: DocumentInfo[] = (response.Contents || []).map((item) => ({
        name: (item.Key || '').split('/').pop() || item.Key || '',
        blobPath: item.Key || '',
        size: item.Size || 0,
        contentType: 'application/octet-stream',
        lastModified: item.LastModified || new Date(),
      }));

      return {
        documents,
        continuationToken: response.NextContinuationToken,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to list documents', {
        message: err.message,
        folder: options.folder,
      });
      throw new InternalServerException(err, 'Failed to list documents');
    }
  }

  async getMetadata(objectKey: string): Promise<DocumentInfo | null> {
    this.ensureAvailable();

    try {
      const response = await this.getS3Client().send(
        new HeadObjectCommand({ Bucket: this.getBucket(), Key: objectKey }),
      );

      return {
        name: objectKey.split('/').pop() || objectKey,
        blobPath: objectKey,
        size: response.ContentLength || 0,
        contentType: response.ContentType || 'application/octet-stream',
        lastModified: response.LastModified || new Date(),
        metadata: response.Metadata,
      };
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      const err = error as Error;
      this.logger.error('Failed to get document metadata', {
        message: err.message,
        objectKey,
      });
      return null;
    }
  }

  async copy(sourceKey: string, destinationKey: string): Promise<string> {
    this.ensureAvailable();

    try {
      const sourceExists = await this.exists(sourceKey);
      if (!sourceExists) {
        throw new BadRequestException('Source document not found');
      }

      await this.getS3Client().send(
        new CopyObjectCommand({
          Bucket: this.getBucket(),
          CopySource: `/${this.getBucket()}/${encodeURIComponent(sourceKey)}`,
          Key: destinationKey,
        }),
      );

      this.logger.log('Document copied', {
        source: sourceKey,
        destination: destinationKey,
      });

      return destinationKey;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;

      const err = error as Error;
      this.logger.error('Failed to copy document', {
        message: err.message,
        sourceKey,
        destinationKey,
      });
      throw new InternalServerException(err, 'Failed to copy document');
    }
  }

  /**
   * Get the canonical object URL (without presigning). Used by indexing service
   * and other consumers that need a stable identifier rather than a temporary URL.
   */
  getBlobUrl(objectKey: string): string {
    this.ensureAvailable();
    return this.getObjectUrl(objectKey);
  }

  // ============ Private Methods ============

  private getObjectUrl(objectKey: string): string {
    const base = stripTrailingChar(this.connectionService.getPublicUrl(), '/');
    const bucket = this.getBucket();
    return `${base}/${bucket}/${objectKey}`;
  }

  private ensureAvailable(): void {
    if (!this.connectionService.isConnectedNow()) {
      throw new InternalServerException(undefined, 'Document service is not available');
    }
  }

  private validateFile(fileName: string, mimeType: string, size?: number): void {
    if (this.allowedMimeTypes.length > 0 && !this.allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(
        `File type '${mimeType}' is not allowed. Allowed types: ${this.allowedMimeTypes.join(', ')}`,
      );
    }

    if (size !== undefined && size > this.maxFileSizeBytes) {
      throw new BadRequestException(
        `File size ${Math.round(size / 1024 / 1024)}MB exceeds maximum ${Math.round(
          this.maxFileSizeBytes / 1024 / 1024,
        )}MB`,
      );
    }

    if (!fileName || fileName.length === 0) {
      throw new BadRequestException('File name is required');
    }

    if (fileName.length > 255) {
      throw new BadRequestException('File name is too long (max 255 characters)');
    }
  }

  private sanitizeFileName(fileName: string): string {
    let sanitized = fileName.replaceAll(/[/\\:\0]/g, '_');
    sanitized = stripLeadingTrailingWhitespaceOrDot(sanitized);
    sanitized = collapseCharSet(sanitized, '_ \t\n\r\f\v', '_');

    if (!sanitized || sanitized === '_') {
      sanitized = `file_${Date.now()}`;
    }

    return sanitized;
  }

  private sanitizePath(path: string): string {
    let sanitized = stripLeadingTrailingChar(path, '/');
    sanitized = sanitized.replaceAll(/[\0\\]/g, '');
    sanitized = collapseRepeatedChar(sanitized, '/');
    sanitized = sanitized.replaceAll('..', '');
    return sanitized;
  }

  private calculateHash(buffer: Buffer): string {
    return createHash('md5').update(buffer).digest('hex');
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  private async headObjectWithRetry(objectKey: string): Promise<void> {
    try {
      await this.getS3Client().send(
        new HeadObjectCommand({ Bucket: this.getBucket(), Key: objectKey }),
      );
    } catch (error) {
      if (!this.isTransientS3Error(error)) throw error;

      this.logger.warn('S3 HeadObject transient error, retrying once', {
        objectKey,
        bucket: this.getBucket(),
        httpStatusCode: (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode,
      });

      await this.getS3Client().send(
        new HeadObjectCommand({ Bucket: this.getBucket(), Key: objectKey }),
      );
    }
  }

  private isTransientS3Error(error: unknown): boolean {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return err?.$metadata?.httpStatusCode === 403 && err?.name === 'Unknown';
  }

  private isNotFoundError(error: unknown): boolean {
    const err = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    return (
      err?.name === 'NotFound' ||
      err?.name === 'NoSuchKey' ||
      err?.Code === 'NoSuchKey' ||
      err?.Code === 'NotFound' ||
      err?.$metadata?.httpStatusCode === 404
    );
  }

  private normalizeMetadata(metadata?: Record<string, string>): Record<string, string> {
    if (!metadata) return {};
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized;
  }
}
