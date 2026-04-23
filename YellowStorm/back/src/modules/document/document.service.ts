import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContainerClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
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

@Injectable()
export class DocumentService {
  private readonly containerName: string;
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

    this.containerName = this.configService.get<string>('storage.azure.containerName', 'documents');
    this.maxFileSizeBytes =
      this.configService.get<number>('storage.maxFileSizeMb', 50) * 1024 * 1024;
    this.maxFilesPerUpload = this.configService.get<number>('storage.maxFilesPerUpload', 10);
    this.sasExpiryMinutes = this.configService.get<number>('storage.sasExpiryMinutes', 60);
    this.allowedMimeTypes = this.configService.get<string[]>('storage.allowedMimeTypes', []);
  }

  /**
   * Check if the document service is available and connected
   */
  isAvailable(): boolean {
    return this.connectionService.isConnectedNow();
  }

  /**
   * Get health status details for monitoring (live status from connection service)
   */
  getHealthStatus(): StorageConnectionStatus {
    return this.connectionService.getHealthStatus();
  }

  /**
   * Get the container client from connection service
   */
  private getContainerClient(): ContainerClient {
    const containerClient = this.connectionService.getContainerClient();
    if (!containerClient) {
      throw new InternalServerException(undefined, 'Document service is not available');
    }
    return containerClient;
  }

  /**
   * Upload a document to Azure Blob Storage
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
    const storedName = options.generateUniqueName !== false
      ? `${id}-${sanitizedName}`
      : options.customFileName || sanitizedName;

    const folder = options.folder ? this.sanitizePath(options.folder) : '';
    const blobPath = folder ? `${folder}/${storedName}` : storedName;

    const containerClient = this.getContainerClient();
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

    // Calculate content hash
    let contentHash: string;
    let size: number;
    let uploadData: Buffer;

    if (file instanceof Buffer) {
      uploadData = file;
      contentHash = this.calculateHash(file);
      size = file.length;
    } else {
      // Convert stream to buffer for hash calculation
      uploadData = await this.streamToBuffer(file as Readable);
      contentHash = this.calculateHash(uploadData);
      size = uploadData.length;

      // Validate size after reading stream
      if (size > this.maxFileSizeBytes) {
        throw new BadRequestException(
          `File size ${Math.round(size / 1024 / 1024)}MB exceeds maximum ${Math.round(this.maxFileSizeBytes / 1024 / 1024)}MB`,
        );
      }
    }

    // Prepare metadata
    const metadata: Record<string, string> = {
      originalName: encodeURIComponent(originalName),
      uploadedAt: new Date().toISOString(),
      contentHash,
      ...options.metadata,
    };

    try {
      await blockBlobClient.upload(uploadData, size, {
        blobHTTPHeaders: {
          blobContentType: mimeType,
          blobCacheControl: 'max-age=31536000', // 1 year cache
        },
        metadata,
      });

      this.logger.log('Document uploaded', {
        id,
        blobPath,
        size,
        mimeType,
      });

      return {
        id,
        originalName,
        storedName,
        blobPath,
        mimeType,
        size,
        contentHash,
        url: blockBlobClient.url,
        uploadedAt: new Date(),
        metadata: options.metadata,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to upload document', {
        message: err.message,
        blobPath,
      });
      throw new InternalServerException(err, 'Failed to upload document');
    }
  }

  /**
   * Upload multiple documents
   */
  async uploadMany(
    files: Array<{ buffer: Buffer; originalName: string; mimeType: string }>,
    options: UploadOptions = {},
  ): Promise<UploadedDocument[]> {
    if (files.length > this.maxFilesPerUpload) {
      throw new BadRequestException(
        `Cannot upload more than ${this.maxFilesPerUpload} files at once`,
      );
    }

    const results = await Promise.all(
      files.map((file) => this.upload(file.buffer, file.originalName, file.mimeType, options)),
    );

    return results;
  }

  /**
   * Download a document
   */
  async download(blobPath: string): Promise<Buffer> {
    this.ensureAvailable();

    const containerClient = this.getContainerClient();
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

    try {
      const exists = await blockBlobClient.exists();
      if (!exists) {
        throw new BadRequestException('Document not found');
      }

      const downloadResponse = await blockBlobClient.download(0);
      return this.streamToBuffer(downloadResponse.readableStreamBody as Readable);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;

      const err = error as Error;
      this.logger.error('Failed to download document', {
        message: err.message,
        blobPath,
      });
      throw new InternalServerException(err, 'Failed to download document');
    }
  }

  /**
   * Delete a document
   */
  async delete(blobPath: string): Promise<void> {
    this.ensureAvailable();

    const containerClient = this.getContainerClient();
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

    try {
      await blockBlobClient.deleteIfExists({
        deleteSnapshots: 'include',
      });

      this.logger.log('Document deleted', { blobPath });
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to delete document', {
        message: err.message,
        blobPath,
      });
      throw new InternalServerException(err, 'Failed to delete document');
    }
  }

  /**
   * Delete multiple documents
   */
  async deleteMany(blobPaths: string[]): Promise<void> {
    await Promise.all(blobPaths.map((path) => this.delete(path)));
  }

  /**
   * Check if a document exists
   */
  async exists(blobPath: string): Promise<boolean> {
    this.ensureAvailable();

    const containerClient = this.getContainerClient();
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    return blockBlobClient.exists();
  }

  /**
   * Generate a SAS URL for temporary access.
   * When `checkExists` is true, verifies the blob exists before generating the URL.
   */
  async generateSasUrl(blobPath: string, options: SasUrlOptions = {}): Promise<string> {
    this.ensureAvailable();

    // If checkExists is true and blob doesn't exist, throw 404 error
    // This allows folder operations to fail early without trying to generate SAS URLs
    if (options.checkExists) {
      const blobExists = await this.exists(blobPath);
      if (!blobExists) {
        throw new NotFoundException(
          ErrorCode.WORKSPACE_DOCUMENT_NOT_IN_BLOB,
          'Document file not found in storage',
        );
      }
    }

    // Check if this is a folder path (no filename extension)
    // Folders should not have SAS URLs generated
    const isFolder = !blobPath.includes('.');

    if (isFolder) {
      throw new BadRequestException(
        'Cannot generate download URL for folders',
      );
    }

    const sharedKeyCredential = this.connectionService.getSharedKeyCredential();
    if (!sharedKeyCredential) {
      throw new InternalServerException(undefined, 'SAS URL generation not configured');
    }

    const containerClient = this.getContainerClient();
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    const expiryMinutes = options.expiryMinutes || this.sasExpiryMinutes;

    const startsOn = new Date();
    const expiresOn = new Date(startsOn.getTime() + expiryMinutes * 30 * 1000); // 30 minutes expiry

    const permissions = BlobSASPermissions.parse(options.permissions || 'r');

    const containerName = this.connectionService.getContainerName();
    const sasToken = generateBlobSASQueryParameters(
      {
        containerName,
        blobName: blobPath,
        permissions,
        startsOn,
        expiresOn,
        contentDisposition: options.contentDisposition,
      },
      sharedKeyCredential,
    ).toString();

    return `${blockBlobClient.url}?${sasToken}`;
  }

  /**
   * List documents in a folder
   */
  async list(options: DocumentListOptions = {}): Promise<DocumentListResult> {
    this.ensureAvailable();

    const documents: DocumentInfo[] = [];
    let continuationToken: string | undefined;

    try {
      const containerClient = this.getContainerClient();
      const iterator = containerClient.listBlobsFlat({
        prefix: options.folder,
      }).byPage({
        maxPageSize: options.maxResults || 100,
        continuationToken: options.continuationToken,
      });

      const page = await iterator.next();

      if (!page.done && page.value.segment.blobItems) {
        for (const blob of page.value.segment.blobItems) {
          documents.push({
            name: blob.name.split('/').pop() || blob.name,
            blobPath: blob.name,
            size: blob.properties.contentLength || 0,
            contentType: blob.properties.contentType || 'application/octet-stream',
            lastModified: blob.properties.lastModified || new Date(),
            metadata: blob.metadata,
          });
        }
        continuationToken = page.value.continuationToken;
      }

      return { documents, continuationToken };
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to list documents', {
        message: err.message,
        folder: options.folder,
      });
      throw new InternalServerException(err, 'Failed to list documents');
    }
  }

  /**
   * Get document metadata
   */
  async getMetadata(blobPath: string): Promise<DocumentInfo | null> {
    this.ensureAvailable();

    const containerClient = this.getContainerClient();
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

    try {
      const exists = await blockBlobClient.exists();
      if (!exists) return null;

      const properties = await blockBlobClient.getProperties();

      return {
        name: blobPath.split('/').pop() || blobPath,
        blobPath,
        size: properties.contentLength || 0,
        contentType: properties.contentType || 'application/octet-stream',
        lastModified: properties.lastModified || new Date(),
        metadata: properties.metadata,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to get document metadata', {
        message: err.message,
        blobPath,
      });
      return null;
    }
  }

  /**
   * Copy a document to a new location
   */
  async copy(sourcePath: string, destinationPath: string): Promise<string> {
    this.ensureAvailable();

    const containerClient = this.getContainerClient();
    const sourceClient = containerClient.getBlockBlobClient(sourcePath);
    const destClient = containerClient.getBlockBlobClient(destinationPath);

    try {
      const sourceExists = await sourceClient.exists();
      if (!sourceExists) {
        throw new BadRequestException('Source document not found');
      }

      await destClient.beginCopyFromURL(sourceClient.url);

      this.logger.log('Document copied', {
        source: sourcePath,
        destination: destinationPath,
      });

      return destinationPath;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;

      const err = error as Error;
      this.logger.error('Failed to copy document', {
        message: err.message,
        sourcePath,
        destinationPath,
      });
      throw new InternalServerException(err, 'Failed to copy document');
    }
  }

  /**
   * Get the full blob URL for a given path (without SAS token)
   */
  getBlobUrl(blobPath: string): string {
    this.ensureAvailable();
    const containerClient = this.getContainerClient();
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    return blockBlobClient.url;
  }

  // ============ Private Methods ============

  private ensureAvailable(): void {
    if (!this.connectionService.isConnectedNow()) {
      throw new InternalServerException(undefined, 'Document service is not available');
    }
  }

  private validateFile(fileName: string, mimeType: string, size?: number): void {
    // Validate MIME type
    if (this.allowedMimeTypes.length > 0 && !this.allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(
        `File type '${mimeType}' is not allowed. Allowed types: ${this.allowedMimeTypes.join(', ')}`,
      );
    }

    // Validate file size
    if (size !== undefined && size > this.maxFileSizeBytes) {
      throw new BadRequestException(
        `File size ${Math.round(size / 1024 / 1024)}MB exceeds maximum ${Math.round(this.maxFileSizeBytes / 1024 / 1024)}MB`,
      );
    }

    // Validate filename
    if (!fileName || fileName.length === 0) {
      throw new BadRequestException('File name is required');
    }

    if (fileName.length > 255) {
      throw new BadRequestException('File name is too long (max 255 characters)');
    }
  }

  private sanitizeFileName(fileName: string): string {
    // Remove path separators and null bytes
    let sanitized = fileName.replace(/[/\\:\0]/g, '_');

    // Remove leading/trailing dots and spaces
    sanitized = sanitized.replace(/^[\s.]+|[\s.]+$/g, '');

    // Replace multiple consecutive underscores/spaces
    sanitized = sanitized.replace(/[_\s]+/g, '_');

    // Ensure filename is not empty after sanitization
    if (!sanitized || sanitized === '_') {
      sanitized = `file_${Date.now()}`;
    }

    return sanitized;
  }

  private sanitizePath(path: string): string {
    // Remove leading/trailing slashes
    let sanitized = path.replace(/^\/+|\/+$/g, '');

    // Remove null bytes and backslashes
    sanitized = sanitized.replace(/[\0\\]/g, '');

    // Replace multiple consecutive slashes
    sanitized = sanitized.replace(/\/+/g, '/');

    // Remove path traversal attempts
    sanitized = sanitized.replace(/\.\./g, '');

    return sanitized;
  }

  private calculateHash(buffer: Buffer): string {
    return createHash('md5').update(buffer).digest('hex');
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }
}
