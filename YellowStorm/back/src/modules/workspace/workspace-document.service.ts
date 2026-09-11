import { Injectable, Inject, Optional, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { IngestUrlDto } from './dto/ingest-url.dto';
import {
  WorkspaceDoc,
  WorkspaceDocumentDoc,
  DocumentStatus,
  DocumentType,
  IndexingStatus,
} from './schemas/workspace-document.schema';
import { escapeRegex, collapseCharSet, stripLeadingTrailingWhitespaceOrDot, redactUrlForLog, redactUrlsInMessage } from '../../common/utils';
import { IndexingService } from '../indexing/indexing.service';
import {
  UploadSession,
  UploadSessionDocument,
  UploadSessionStatus,
} from './schemas/upload-session.schema';
import {
  RequestUploadUrlData,
  UploadUrlResponse,
  DocumentQueryParams,
  DocumentResponse,
  PaginatedDocuments,
  DownloadUrlResponse,
  BulkDeleteResult,
} from './interfaces/workspace-document.interface';
import {
  InitiateBulkUploadData,
  BulkUploadInitResponse,
  ReportProgressData,
  UploadSessionResponse,
  BulkUploadCompleteResponse,
  UploadProgressNotification,
} from './interfaces/upload-session.interface';
import { WorkspaceService } from './workspace.service';
import { DocumentService } from '../document/document.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { LoggerService } from '../logger';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { WorkspaceUploadSettingsService } from '../system/workspace-upload-settings.service';
import { getUploadExtension } from '../system/constants/workspace-upload-settings.constants';
import { UrlToPdfClientService } from './services/url-to-pdf-client.service';
import { normalizeWorkspaceUrl } from './services/url-normalization';
import { GuardedUrlDownloaderService } from './services/guarded-url-downloader.service';
import { IntegrationEventOutboxService } from '../integration-events/services/integration-event-outbox.service';
import { WorkspaceIntegrationEvents } from '../integration-events/contracts';
import { WorkspaceArtifactCleanupService } from './services/workspace-artifact-cleanup.service';
import { FeatureVisibilityService } from '../system/feature-visibility.service';
import { WebsiteCrawlerService } from './services/website-crawler.service';

@Injectable()
export class WorkspaceDocumentService {
  private readonly maxFileSizeMb: number;
  private readonly maxFilesPerBulkUpload: number;
  private readonly smallFileThresholdMb: number;
  private readonly uploadSessionTtlMinutes: number;
  private readonly sasUrlExpiryMinutes: number;

  constructor(
    @InjectModel(WorkspaceDoc.name)
    private readonly documentModel: Model<WorkspaceDocumentDoc>,
    @InjectModel(UploadSession.name)
    private readonly uploadSessionModel: Model<UploadSessionDocument>,
    private readonly workspaceService: WorkspaceService,
    private readonly documentService: DocumentService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => IndexingService))
    private readonly indexingService: IndexingService,
    private readonly configService: ConfigService,
    private readonly uploadSettingsService: WorkspaceUploadSettingsService,
    private readonly urlToPdfClient: UrlToPdfClientService,
    private readonly logger: LoggerService,
    private readonly workspaceArtifacts: WorkspaceArtifactCleanupService,
    private readonly websiteCrawler: WebsiteCrawlerService,
    private readonly urlDownloader: GuardedUrlDownloaderService,
    @Optional() private readonly outbox?: IntegrationEventOutboxService,
    @Optional() private readonly featureVisibility?: FeatureVisibilityService,
  ) {
    this.logger.setContext('WorkspaceDocumentService');

    this.maxFileSizeMb = this.configService.get<number>('workspace.maxFileSizeMb', 500);
    this.maxFilesPerBulkUpload = this.configService.get<number>('workspace.maxFilesPerBulkUpload', 50);
    this.smallFileThresholdMb = this.configService.get<number>('workspace.smallFileThresholdMb', 10);
    this.uploadSessionTtlMinutes = this.configService.get<number>('workspace.uploadSessionTtlMinutes', 60);
    this.sasUrlExpiryMinutes = this.configService.get<number>('workspace.sasUrlExpiryMinutes', 60);
  }

  /**
   * Sanitize filename for storage
   */
  private sanitizeFilename(filename: string): string {
    const normalized = collapseCharSet(
      stripLeadingTrailingWhitespaceOrDot(filename.replace(/[/\\:\0]/g, '_')),
      '_ \t\n\r\f\v',
      '_',
    );
    return normalized.substring(0, 255);
  }

  /**
   * Generate object-key for a workspace upload. Layout:
   * `{ownerUserId}/{storagePrefix}/{filename}`.
   *
   * Collaborator uploads land under the workspace owner's userId, NOT the
   * uploader's — this keeps all of a workspace's files grouped together in
   * Ceph regardless of which collaborator pushed them. Filename uniqueness
   * within the workspace is enforced via resolveUniqueOriginalName() before
   * this is called.
   */
  private generateBlobPath(
    ownerUserId: string,
    storagePrefix: string,
    filename: string,
  ): string {
    const sanitizedName = this.sanitizeFilename(filename);
    return `${ownerUserId}/${storagePrefix}/${sanitizedName}`;
  }

  /**
   * Resolve a non-colliding originalName within a workspace, Windows-Explorer style.
   * If "report.pdf" exists, returns "report (1).pdf"; if that exists, "report (2).pdf", etc.
   * Probes the DB until a free slot is found. Returns the original name when no collision.
   * Folders are ignored (isFolder: false) — folders can share names with files freely.
   */
  private async resolveUniqueOriginalName(
    workspaceId: string,
    originalName: string,
  ): Promise<string> {
    const workspaceObjectId = new Types.ObjectId(workspaceId);
    const exists = await this.documentModel
      .exists({ workspaceId: workspaceObjectId, originalName, isFolder: false })
      .lean();
    if (!exists) return originalName;

    const dotIndex = originalName.lastIndexOf('.');
    const hasExt = dotIndex > 0 && dotIndex < originalName.length - 1;
    const base = hasExt ? originalName.slice(0, dotIndex) : originalName;
    const ext = hasExt ? originalName.slice(dotIndex) : '';

    // Probe ' (n)' suffix until a free slot is found. Cap to avoid runaway loops on
    // pathological cases — 9999 collisions in one workspace is already broken.
    for (let n = 1; n <= 9999; n++) {
      const candidate = `${base}_(${n})${ext}`;
      const taken = await this.documentModel
        .exists({ workspaceId: workspaceObjectId, originalName: candidate, isFolder: false })
        .lean();
      if (!taken) return candidate;
    }

    throw new BadRequestException(
      `Too many duplicates of '${originalName}' in this workspace`,
    );
  }

  /**
   * Validate file type and size. The source of truth is the
   * admin-managed `workspace_uploads` system setting; the env-var
   * fallback (`WORKSPACE_ALLOWED_MIME_TYPES`) is retained for
   * backwards compatibility but no longer consulted here.
   */
  private async validateFile(filename: string, mimeType: string, size: number): Promise<void> {
    const extension = getUploadExtension(filename);
    if (!extension) {
      throw new BadRequestException(
        ErrorCode.WORKSPACE_DOCUMENT_INVALID_TYPE,
        `File '${filename}' has no extension and cannot be uploaded`,
      );
    }

    const allowedExtensions = await this.uploadSettingsService.getAllowedExtensions();
    if (!allowedExtensions.includes(extension)) {
      throw new BadRequestException(
        ErrorCode.WORKSPACE_DOCUMENT_INVALID_TYPE,
        `File extension '${extension}' is not allowed`,
      );
    }

    const allowedMimeTypes = this.uploadSettingsService.getAllowedMimeTypesForExtension(extension);
    if (allowedMimeTypes.length === 0 || !allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(
        ErrorCode.WORKSPACE_DOCUMENT_INVALID_TYPE,
        `File type '${mimeType}' is not allowed for '${extension}' files`,
      );
    }

    const maxSizeBytes = this.maxFileSizeMb * 1024 * 1024;
    if (size > maxSizeBytes) {
      throw new BadRequestException(
        `File size ${Math.round(size / 1024 / 1024)}MB exceeds maximum ${this.maxFileSizeMb}MB`,
      );
    }
  }

  /**
   * Request a presigned URL for uploading a file with a custom blob path prefix.
   * Used for conversation-scoped uploads where the path is {userId}/{conversationId} instead of {userId}/{workspaceId}.
   */
  async requestUploadUrlWithPath(
    workspaceId: string,
    userId: string,
    data: RequestUploadUrlData,
    pathPrefix: string,
  ): Promise<UploadUrlResponse> {
    await this.validateFile(data.filename, data.mimeType, data.size);

    const quota = await this.workspaceService.checkStorageQuota(workspaceId, data.size);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB, Required: ${Math.round(data.size / 1024 / 1024)}MB`,
      );
    }

    const documentId = new Types.ObjectId();
    const effectiveName = await this.resolveUniqueOriginalName(workspaceId, data.filename);
    const sanitizedName = this.sanitizeFilename(effectiveName);
    const blobPath = `${pathPrefix}/${sanitizedName}`;

    const document = await this.documentModel.create({
      _id: documentId,
      filename: sanitizedName,
      originalName: effectiveName,
      mimeType: data.mimeType,
      size: data.size,
      path: blobPath,
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      status: DocumentStatus.PENDING,
      indexingStatus: IndexingStatus.READY, // Conversation files are not indexed
    });

    const uploadUrl = await this.documentService.generateSasUrl(blobPath, {
      permissions: 'cw',
      expiryMinutes: this.sasUrlExpiryMinutes,
    });

    const expiresAt = new Date(Date.now() + this.sasUrlExpiryMinutes * 60 * 1000);

    this.logger.debug('Upload URL generated (custom path)', {
      documentId: document._id,
      workspaceId,
      pathPrefix,
      filename: data.filename,
    });

    return {
      documentId: document._id.toString(),
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Upload a small file directly with a custom blob path prefix.
   * Used for conversation-scoped uploads.
   */
  async uploadSmallFileWithPath(
    workspaceId: string,
    userId: string,
    file: Buffer,
    originalName: string,
    mimeType: string,
    pathPrefix: string,
  ): Promise<DocumentResponse> {
    const size = file.length;

    await this.validateFile(originalName, mimeType, size);

    const thresholdBytes = this.smallFileThresholdMb * 1024 * 1024;
    if (size > thresholdBytes) {
      throw new BadRequestException(
        `File size exceeds small file threshold (${this.smallFileThresholdMb}MB). Use presigned URL upload instead.`,
      );
    }

    const quota = await this.workspaceService.checkStorageQuota(workspaceId, size);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB`,
      );
    }

    const documentId = new Types.ObjectId();
    const effectiveName = await this.resolveUniqueOriginalName(workspaceId, originalName);
    const sanitizedName = this.sanitizeFilename(effectiveName);

    const uploaded = await this.documentService.upload(file, effectiveName, mimeType, {
      folder: pathPrefix,
      generateUniqueName: false,
      customFileName: sanitizedName,
    });

    const document = await this.documentModel.create({
      _id: documentId,
      filename: uploaded.storedName,
      originalName: effectiveName,
      mimeType,
      size,
      path: uploaded.blobPath,
      url: uploaded.url,
      contentHash: uploaded.contentHash,
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      status: DocumentStatus.COMPLETED,
      uploadedAt: new Date(),
      indexingStatus: IndexingStatus.READY, // Conversation files are not indexed
    });

    await this.workspaceService.updateStorageUsage(workspaceId, size, 1);

    this.logger.debug('Small file uploaded (custom path)', {
      documentId: document._id,
      workspaceId,
      pathPrefix,
      size,
    });

    return this.mapToResponse(document);
  }

  /**
   * Find multiple documents by their IDs (across any workspace).
   * Returns documents in no particular order.
   */
  async findByIds(documentIds: string[]): Promise<DocumentResponse[]> {
    if (documentIds.length === 0) return [];

    const objectIds = documentIds.map((id) => new Types.ObjectId(id));
    const documents = await this.documentModel.find({ _id: { $in: objectIds } }).exec();

    return documents.map((d) => this.mapToResponse(d));
  }

  /**
   * Generate a presigned read URL for a document by its path.
   * Pass `allowExtensionless` for app-source objects like Dockerfile / LICENSE.
   */
  async generateReadUrl(
    path: string,
    options?: { allowExtensionless?: boolean },
  ): Promise<string> {
    return this.documentService.generateSasUrl(path, {
      permissions: 'r',
      expiryMinutes: this.sasUrlExpiryMinutes,
      allowExtensionless: options?.allowExtensionless,
    });
  }

  /**
   * Request a presigned URL for uploading a large file
   */
  async requestUploadUrl(
    workspaceId: string,
    userId: string,
    data: RequestUploadUrlData,
  ): Promise<UploadUrlResponse> {
    // Validate file
    await this.validateFile(data.filename, data.mimeType, data.size);

    // Check storage quota
    const quota = await this.workspaceService.checkStorageQuota(workspaceId, data.size);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB, Required: ${Math.round(data.size / 1024 / 1024)}MB`,
      );
    }

    // Create pending document record.
    // Path roots under the workspace OWNER (not the uploader) so a workspace's
    // files stay grouped under one Ceph prefix even when collaborators upload.
    const { ownerUserId, storagePrefix } = await this.workspaceService.getStorageContext(
      workspaceId,
    );
    const documentId = new Types.ObjectId();
    const effectiveName = await this.resolveUniqueOriginalName(workspaceId, data.filename);
    const blobPath = this.generateBlobPath(ownerUserId, storagePrefix, effectiveName);

    const document = await this.documentModel.create({
      _id: documentId,
      filename: this.sanitizeFilename(effectiveName),
      originalName: effectiveName,
      mimeType: data.mimeType,
      size: data.size,
      path: blobPath,
      // url is set after upload completes
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      status: DocumentStatus.PENDING,
    });

    // Generate presigned URL with write permission
    const uploadUrl = await this.documentService.generateSasUrl(blobPath, {
      permissions: 'cw', // Create and Write
      expiryMinutes: this.sasUrlExpiryMinutes,
    });

    const expiresAt = new Date(Date.now() + this.sasUrlExpiryMinutes * 60 * 1000);

    this.logger.debug('Upload URL generated', {
      documentId: document._id,
      workspaceId,
      filename: data.filename,
    });

    return {
      documentId: document._id.toString(),
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Confirm upload completion
   */
  async confirmUpload(
    workspaceId: string,
    userId: string,
    documentId: string,
    deepSearch?: boolean,
  ): Promise<DocumentResponse> {
    const document = await this.documentModel.findOne({
      _id: documentId,
      workspaceId: new Types.ObjectId(workspaceId),
    });

    if (!document) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    if (document.status !== DocumentStatus.PENDING) {
      throw new BadRequestException(
        'Document is not in pending state',
      );
    }

    // Verify object exists in Ceph S3 (skip for folders)
    if (!document.isFolder && document.path) {
      const exists = await this.documentService.exists(document.path);
      if (!exists) {
        throw new BadRequestException(
          'Document was not uploaded to storage',
        );
      }
    }

    // Update document status
    document.status = DocumentStatus.COMPLETED;
    document.uploadedAt = new Date();
    document.url = document.path; // Canonical object key (no presigned signature)
    document.metadata = {
      ...document.metadata,
      deepSearchRequested: String(Boolean(deepSearch)),
      autoIndexRequested: 'true',
    };
    await document.save();
    await this.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentRegisteredV1, document);
    await this.recordWorkspaceEvent(WorkspaceIntegrationEvents.ArtifactReadyV1, document);

    // Trigger indexing (non-blocking). Skip folders — they have no blob to index.
    if (!document.isFolder) {
      this.indexingService.queueDocument(document._id.toString(), deepSearch).catch((err) => {
        this.logger.warn('Failed to queue document for indexing', {
          documentId: document._id,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }

    // Update workspace storage usage
    await this.workspaceService.updateStorageUsage(workspaceId, document.size, 1);

    // Send notification
    await this.sendUploadNotification(userId, {
      eventType: 'upload_complete',
      sessionId: '',
      filename: document.originalName,
      document: this.mapToResponse(document),
    });

    this.logger.debug('Upload confirmed', {
      documentId: document._id,
      workspaceId,
    });

    return this.mapToResponse(document);
  }

  /**
   * Upload a small file directly
   */
  async uploadSmallFile(
    workspaceId: string,
    userId: string,
    file: Buffer,
    originalName: string,
    mimeType: string,
    folderId?: string,
    deepSearch?: boolean,
    autoIndex: boolean = true,
  ): Promise<DocumentResponse> {
    const size = file.length;

    // Validate file
    await this.validateFile(originalName, mimeType, size);

    // Check if file is truly "small"
    const thresholdBytes = this.smallFileThresholdMb * 1024 * 1024;
    if (size > thresholdBytes) {
      throw new BadRequestException(
        `File size exceeds small file threshold (${this.smallFileThresholdMb}MB). Use presigned URL upload instead.`,
      );
    }

    // Check storage quota
    const quota = await this.workspaceService.checkStorageQuota(workspaceId, size);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB`,
      );
    }

    // Validate folderId if provided
    let parentFolder = null;
    if (folderId) {
      parentFolder = await this.documentModel.findOne({
        _id: new Types.ObjectId(folderId),
        workspaceId: new Types.ObjectId(workspaceId),
        isFolder: true,
      });
      if (!parentFolder) {
        throw new BadRequestException('Folder not found');
      }
    }

    // Create document record. Path roots under the workspace OWNER so
    // collaborator uploads share the same Ceph prefix as the owner's files.
    const { ownerUserId, storagePrefix } = await this.workspaceService.getStorageContext(
      workspaceId,
    );
    const documentId = new Types.ObjectId();
    const effectiveName = await this.resolveUniqueOriginalName(workspaceId, originalName);
    const sanitizedName = this.sanitizeFilename(effectiveName);

    // Upload to Ceph S3
    const uploaded = await this.documentService.upload(file, effectiveName, mimeType, {
      folder: `${ownerUserId}/${storagePrefix}`,
      generateUniqueName: false,
      customFileName: sanitizedName,
    });

    // Create document record
    const document = await this.documentModel.create({
      _id: documentId,
      filename: uploaded.storedName,
      originalName: effectiveName,
      mimeType,
      size,
      path: uploaded.blobPath,
      url: uploaded.url,
      contentHash: uploaded.contentHash,
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      status: DocumentStatus.COMPLETED,
      uploadedAt: new Date(),
      parentId: folderId ? new Types.ObjectId(folderId) : undefined,
      metadata: {
        deepSearchRequested: String(Boolean(deepSearch)),
        autoIndexRequested: String(autoIndex),
      },
    });
    await this.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentRegisteredV1, document);
    await this.recordWorkspaceEvent(WorkspaceIntegrationEvents.ArtifactReadyV1, document);

    // Trigger indexing (non-blocking), unless auto-indexation is disabled.
    if (autoIndex) {
      this.indexingService.queueDocument(document._id.toString(), deepSearch).catch((err) => {
        this.logger.warn('Failed to queue document for indexing', {
          documentId: document._id,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }

    // Update workspace storage
    await this.workspaceService.updateStorageUsage(workspaceId, size, 1);

    this.logger.debug('Small file uploaded', {
      documentId: document._id,
      workspaceId,
      size,
      folderId,
    });

    return this.mapToResponse(document);
  }

  /**
   * Ingest a file from an external download URL into a workspace.
   * Downloads the file, then delegates to uploadSmallFile for storage.
   * Used by the brain/agent to save MCP-sourced files (e.g., SharePoint download URLs).
   *
   * SSRF: initial URL and every redirect hop are checked with assertUrlIsSafe;
   * auto-redirects are disabled. Only Authorization may be forwarded, and it is
   * stripped when a redirect changes origin (credential forwarding).
   *
   * Memory: response is streamed with a hard byte cap (small-file threshold),
   * assembled once — no arraybuffer + Buffer.from double copy. An AbortSignal
   * enforces an end-to-end deadline across redirect hops.
   */
  async ingestFromUrl(
    workspaceId: string,
    dto: IngestUrlDto,
  ): Promise<DocumentResponse> {
    this.logger.log('Ingesting file from URL', {
      workspaceId,
      userId: dto.userId,
      filename: dto.filename,
      hasAuthHeaders: !!dto.authHeaders,
    });

    let buffer: Buffer;
    let resolvedMimeType = dto.mimeType || 'application/octet-stream';

    try {
      // Fail closed before any network I/O so disallowed hosts never hit axios.
      await this.urlDownloader.assertUrlIsSafe(dto.downloadUrl);

      // Cap at small-file threshold: uploadSmallFile rejects larger bodies anyway,
      // and buffering hundreds of MB here is an OOM risk (YS-08).
      const maxBytes = this.smallFileThresholdMb * 1024 * 1024;
      const response = await this.urlDownloader.download(dto.downloadUrl, {
        maxBytes,
        authHeaders: dto.authHeaders,
        deadlineMs: 30_000,
      });

      buffer = response.data;

      if (!dto.mimeType && response.headers['content-type']) {
        resolvedMimeType = response.headers['content-type'].split(';')[0].trim();
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const err = error as { response?: { status?: number }; message?: string; name?: string; code?: string };
      if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
        throw new BadRequestException(
          ErrorCode.WORKSPACE_DOCUMENT_UPLOAD_FAILED,
          'Failed to download file: timed out',
        );
      }
      const status = err.response?.status;
      const message = status
        ? `Failed to download file: HTTP ${status}`
        : `Failed to download file: ${err.message}`;

      this.logger.error('File download failed during ingest', {
        workspaceId,
        ...redactUrlForLog(dto.downloadUrl),
        error: redactUrlsInMessage(message),
      });

      throw new BadRequestException(ErrorCode.WORKSPACE_DOCUMENT_UPLOAD_FAILED, message);
    }

    const doc = await this.uploadSmallFile(
      workspaceId,
      dto.userId,
      buffer,
      dto.filename,
      resolvedMimeType,
    );

    if (dto.sourceMeta) {
      await this.documentModel.findByIdAndUpdate(doc.id, {
        $set: { metadata: dto.sourceMeta },
      });
    }

    this.logger.debug('File ingested from URL', {
      documentId: doc.id,
      workspaceId,
      filename: doc.originalName,
      size: doc.size,
    });

    return doc;
  }

  /**
   * Add a website link as a workspace document. Creates the doc immediately in a
   * PROCESSING state and returns it; conversion to PDF + indexing runs in the
   * background (fire-and-forget). The stored artifact is a PDF.
   */
  async addLink(
    workspaceId: string,
    userId: string,
    url: string,
    options?: { deepSearch?: boolean; autoIndex?: boolean },
  ): Promise<DocumentResponse> {
    const [doc] = await this.addLinks(workspaceId, userId, [url], options);
    return doc;
  }

  /**
   * Add multiple website links as workspace documents. Creates each doc
   * immediately in a PROCESSING state and returns them all; conversion to
   * PDF + indexing runs in the background (fire-and-forget) with a bounded
   * concurrency so we don't hammer the conversion service.
   */
  async addLinks(
    workspaceId: string,
    userId: string,
    urls: string[],
    options?: { deepSearch?: boolean; autoIndex?: boolean; sourceRootUrl?: string; names?: Record<string, string>; roots?: Record<string, string>; sourceGroupId?: string },
  ): Promise<DocumentResponse[]> {
    // Nominal size of 0: the converted PDF's size is unknown until conversion
    // runs, but we can still reject early if the workspace is already over
    // quota, avoiding a wasted conversion-API call.
    const quota = await this.workspaceService.checkStorageQuota(workspaceId, 0);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB`,
      );
    }

    // One group per index batch: reuse the caller's id (continue mode) or mint a
    // fresh one, so two separate sessions on the same URL form two distinct groups.
    const groupId = options?.sourceGroupId ?? new Types.ObjectId().toString();

    // Create all docs first (fast; each PROCESSING with a unique placeholder path).
    const created: Array<{ response: DocumentResponse; id: string; url: string; name: string; nameFromUrl: boolean }> =
      [];
    for (const url of urls) {
      // Prefer the clicked link/button text (the same label shown in the browse
      // sidebar) as the document name; fall back to the URL-derived filename when
      // the page carried no link text. When we fall back, `nameFromUrl` lets the
      // background conversion try the real page <title> before settling for the URL.
      const providedName = options?.names?.[url]?.replace(/\s+/g, ' ').trim();
      const nameFromUrl = !providedName;
      const filename = this.ensurePdfExtension(
        providedName ? providedName.slice(0, 200) : this.deriveFilenameFromUrl(url),
      );
      const root = options?.roots?.[url] ?? options?.sourceRootUrl;
      const effectiveName = await this.resolveUniqueOriginalName(workspaceId, filename);
      const documentId = new Types.ObjectId();

      const document = await this.documentModel.create({
        _id: documentId,
        originalName: effectiveName,
        mimeType: 'application/pdf',
        size: 0,
        type: DocumentType.URL,
        sourceUrl: url,
        metadata: {
          deepSearchRequested: String(Boolean(options?.deepSearch)),
          autoIndexRequested: String(options?.autoIndex !== false),
          normalizedSourceUrl: normalizeWorkspaceUrl(url),
          sourceGroupId: groupId,
          ...(root
            ? {
                sourceRootUrl: root,
                normalizedSourceRootUrl: normalizeWorkspaceUrl(root),
              }
            : {}),
        },
        // The collection enforces a unique index on `path`. A link has no blob
        // yet at creation, so assign a unique placeholder (mirroring the folder
        // pattern above) to avoid an E11000 collision on { path: null } between
        // concurrent/successive link adds. convertAndStore overwrites this with
        // the real Ceph blob path once the PDF is uploaded. The `.pdf` suffix
        // keeps the placeholder past the "no extension ⇒ folder" heuristic in
        // DocumentService.generateSasUrl, so a stray read of a not-yet-converted
        // link fails with an accurate "file not found" rather than a misleading
        // "cannot download folders" error.
        path: `link-pending:${documentId}.pdf`,
        workspaceId: new Types.ObjectId(workspaceId),
        createdBy: new Types.ObjectId(userId),
        status: DocumentStatus.PROCESSING,
        indexingStatus: IndexingStatus.NONE,
      });

      this.logger.debug('Link document created', { documentId: document._id, workspaceId, url });
      await this.recordWorkspaceEvent(WorkspaceIntegrationEvents.WebPageRegisteredV1, document);
      created.push({
        response: this.mapToResponse(document),
        id: document._id.toString(),
        url,
        name: effectiveName,
        nameFromUrl,
      });
    }

    // Convert strictly one at a time, spaced by a delay, so a rate-limited target
    // (HTTP 429) gets its window to reset between pages instead of being hit in a
    // burst. Fire-and-forget the whole loop; respond as soon as the docs exist.
    const delayMs = this.configService.get<number>('indexing.sequentialDelayMs') ?? 2000;
    void (async () => {
      for (let idx = 0; idx < created.length; idx++) {
        const item = created[idx];
        await this.convertAndStore(item.id, workspaceId, item.url, item.name, item.nameFromUrl, options).catch((err) => {
          this.logger.error('convertAndStore failed', {
            documentId: item.id,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        });
        if (idx < created.length - 1 && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    })();

    return created.map((c) => c.response);
  }

  async checkUrls(workspaceId: string, urls: string[]): Promise<{ results: Array<Record<string, unknown>> }> {
    const normalized = urls.map((url) => ({ url, normalizedUrl: normalizeWorkspaceUrl(url) }));
    const documents = await this.documentModel.find({
      workspaceId: new Types.ObjectId(workspaceId),
      type: DocumentType.URL,
      sourceUrl: { $exists: true },
    }).select('_id sourceUrl status indexingStatus').lean().exec();
    const byNormalized = new Map(documents.map((doc) => [normalizeWorkspaceUrl(doc.sourceUrl ?? ''), doc]));
    return {
      results: normalized.map(({ url, normalizedUrl }) => {
        const document = byNormalized.get(normalizedUrl);
        return {
          url,
          normalizedUrl,
          exists: Boolean(document),
          documentId: document?._id?.toString(),
          status: document?.status,
          indexingStatus: document?.indexingStatus,
        };
      }),
    };
  }

  /**
   * Crawl a seed URL and return the discovered pages that live UNDER the seed's
   * path (so "Explore" on /docs yields /docs/*; a root seed yields the whole site).
   */
  async crawlSite(_workspaceId: string, url: string): Promise<{ pages: Array<{ url: string; title?: string }>; truncated: boolean }> {
    const { pages, truncated } = await this.websiteCrawler.crawl(url);
    let seedPath = '/';
    try { seedPath = new URL(url).pathname.replace(/\/+$/, '') || '/'; } catch { /* keep '/' */ }
    const underSeed = (candidate: string): boolean => {
      try {
        const p = new URL(candidate).pathname;
        if (seedPath === '/') return true;
        return p === seedPath || p.startsWith(`${seedPath}/`);
      } catch { return false; }
    };
    return { pages: pages.filter((p) => underSeed(p.url)), truncated };
  }

  private async recordWorkspaceEvent(eventType: string, document: WorkspaceDocumentDoc): Promise<void> {
    if (!this.outbox || this.featureVisibility?.isEnabled('dataRoomWorkspaceEvents') === false) return;
    await this.outbox.record({ eventId: uuidv4(), eventType, aggregateType: 'workspace_document', aggregateId: document._id.toString(), payload: { workspaceId: document.workspaceId.toString(), documentId: document._id.toString(), createdBy: document.createdBy.toString(), documentType: document.type, originalName: document.originalName, mimeType: document.mimeType, sourceUrl: document.sourceUrl, normalizedSourceUrl: document.sourceUrl ? normalizeWorkspaceUrl(document.sourceUrl) : undefined, contentHash: document.contentHash, documentStatus: document.status, indexingStatus: document.indexingStatus, indexingTaskId: document.indexingTaskId, deepSearchRequested: document.metadata?.deepSearchRequested === 'true', metadata: document.metadata }, occurredAt: new Date() });
  }

  /**
   * Background step: convert the website to PDF, store it, mark the doc COMPLETED,
   * and queue indexing. On failure, mark the doc FAILED and notify the owner.
   */
  private async convertAndStore(
    documentId: string,
    workspaceId: string,
    url: string,
    filename: string,
    nameFromUrl: boolean,
    options?: { deepSearch?: boolean; autoIndex?: boolean },
  ): Promise<void> {
    try {
      await this.urlDownloader.assertUrlIsSafe(url);

      // The name only came from the URL (no clicked link text / provided title).
      // Try the real page <title> so the doc is named after the page, falling
      // back to the URL-derived name when the page has no usable title.
      let effectiveName = filename;
      let renamedOriginal: string | undefined;
      if (nameFromUrl) {
        const title = (await this.websiteCrawler.fetchTitle(url).catch(() => undefined))
          ?.replace(/\s+/g, ' ')
          .trim();
        if (title) {
          const titleName = this.ensurePdfExtension(title.slice(0, 200));
          renamedOriginal = await this.resolveUniqueOriginalName(workspaceId, titleName);
          effectiveName = renamedOriginal;
        }
      }

      const pdf = await this.urlToPdfClient.convert(url, effectiveName);
      const size = pdf.length;

      const quota = await this.workspaceService.checkStorageQuota(workspaceId, size);
      if (!quota.allowed) {
        throw new Error('Insufficient storage for converted PDF');
      }

      const { ownerUserId, storagePrefix } = await this.workspaceService.getStorageContext(
        workspaceId,
      );
      const sanitizedName = this.sanitizeFilename(effectiveName);
      const uploaded = await this.documentService.upload(pdf, effectiveName, 'application/pdf', {
        folder: `${ownerUserId}/${storagePrefix}`,
        generateUniqueName: false,
        customFileName: sanitizedName,
      });

      const completed = await this.documentModel.findByIdAndUpdate(documentId, {
        $set: {
          filename: uploaded.storedName,
          path: uploaded.blobPath,
          url: uploaded.url,
          contentHash: uploaded.contentHash,
          size,
          status: DocumentStatus.COMPLETED,
          uploadedAt: new Date(),
          // Only when we resolved a real page title (else keep the URL-derived name).
          ...(renamedOriginal ? { originalName: renamedOriginal } : {}),
        },
      }, { new: true });

      if (completed) {
        await this.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentRegisteredV1, completed);
        await this.recordWorkspaceEvent(WorkspaceIntegrationEvents.ArtifactReadyV1, completed);
      }

      await this.workspaceService.updateStorageUsage(workspaceId, size, 1);
      if (options?.autoIndex !== false) {
        await this.indexingService.queueDocument(documentId, options?.deepSearch);
      }

      this.logger.debug('Link converted and stored', { documentId, workspaceId, size });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Link conversion failed';
      const failed = await this.documentModel.findByIdAndUpdate(
        documentId,
        {
          $set: {
            status: DocumentStatus.FAILED,
            indexingStatus: IndexingStatus.FAILED,
            errorMessage: message,
            indexingError: message,
          },
        },
        { new: true },
      );
      if (failed) {
        await this.indexingService.sendIndexingStatusNotification(failed).catch(() => undefined);
      }
      this.logger.error('Link conversion failed', { documentId, workspaceId, error: message });
    }
  }

  /**
   * Derive a filesystem-safe `.pdf` name from a URL: the page name (last path
   * segment), falling back to the host for the site root. Collisions are
   * resolved upstream by resolveUniqueOriginalName ("page (1).pdf").
   */
  /**
   * A link is always converted to a PDF, so its filename must carry a `.pdf`
   * extension. Without it the stored blob key has no dot, and DocumentService
   * .generateSasUrl rejects it as a "folder" — breaking view/download. The
   * URL-derived name already ends in `.pdf`; this guards the clicked-link-text
   * name (e.g. "Our Services" → "Our Services.pdf").
   */
  private ensurePdfExtension(name: string): string {
    return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
  }

  private deriveFilenameFromUrl(url: string): string {
    try {
      const u = new URL(url);
      const segments = u.pathname.split('/').filter(Boolean);
      const base = segments.length
        ? segments[segments.length - 1]
        : u.hostname.replace(/^www\./, '');
      const sanitized = base
        .replace(/[^a-zA-Z0-9-_.]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 200);
      return `${sanitized || 'page'}.pdf`;
    } catch {
      return 'website.pdf';
    }
  }

  /**
   * Check that a URL is reachable (HEAD, falling back to GET). Used by the
   * link modal before the user commits to adding the link.
   */
  async checkUrlReachable(
    url: string,
  ): Promise<{ reachable: boolean; status?: number; error?: string }> {
    return this.urlDownloader.checkUrlReachable(url);
  }

  /**
   * Register an AI-generated file as a WorkspaceDocument in the session's
   * system workspace. The file already exists at `fileInfo.path` in S3
   * (the AI service wrote it there); this just adds a metadata row so the
   * workspace UI can list it. Size defaults to 0 because the backend doesn't
   * HEAD the object — accurate sizes aren't needed for the listing UI.
   */
  async createFromAiArtifact(
    systemWorkspaceId: string,
    fileInfo: { id: string; name: string; content_type: string; path: string },
  ): Promise<void> {
    let workspace;
    try {
      workspace = await this.workspaceService.findById(systemWorkspaceId);
    } catch {
      this.logger.warn('createFromAiArtifact: workspace not found, skipping', {
        systemWorkspaceId,
        path: fileInfo.path,
      });
      return;
    }

    const createdByStr = workspace?.createdBy ? String(workspace.createdBy) : null;
    if (!createdByStr) {
      this.logger.warn('createFromAiArtifact: workspace has no createdBy, skipping', {
        systemWorkspaceId,
        path: fileInfo.path,
      });
      return;
    }

    await this.documentModel.create({
      workspaceId: new Types.ObjectId(systemWorkspaceId),
      createdBy: new Types.ObjectId(createdByStr),
      filename: fileInfo.name,
      originalName: fileInfo.name,
      mimeType: fileInfo.content_type || 'application/octet-stream',
      path: fileInfo.path,
      size: 0,
      status: DocumentStatus.COMPLETED,
      uploadedAt: new Date(),
    });

    await this.workspaceService.updateStorageUsage(systemWorkspaceId, 0, 1);

    this.logger.log('AI artifact registered as WorkspaceDocument', {
      systemWorkspaceId,
      path: fileInfo.path,
    });
  }

  /**
   * Initiate bulk upload session
   */
  async initiateBulkUpload(
    workspaceId: string,
    userId: string,
    data: InitiateBulkUploadData,
  ): Promise<BulkUploadInitResponse> {
    const files = data.files;

    // Validate file count
    if (files.length > this.maxFilesPerBulkUpload) {
      throw new BadRequestException(
        `Cannot upload more than ${this.maxFilesPerBulkUpload} files at once`,
      );
    }

    // Validate all files and calculate total size
    let totalSize = 0;
    for (const file of files) {
      await this.validateFile(file.filename, file.mimeType, file.size);
      totalSize += file.size;
    }

    // Check total storage quota
    const quota = await this.workspaceService.checkStorageQuota(workspaceId, totalSize);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB, Required: ${Math.round(totalSize / 1024 / 1024)}MB`,
      );
    }

    // Create upload session
    const expiresAt = new Date(Date.now() + this.uploadSessionTtlMinutes * 60 * 1000);
    const sessionFiles: Array<{
      index: number;
      filename: string;
      mimeType: string;
      size: number;
      documentId: Types.ObjectId;
      uploadUrl: string;
      status: string;
      progress: number;
    }> = [];

    const responseFiles: BulkUploadInitResponse['files'] = [];

    // Resolve the workspace's storage context once for the whole batch.
    const { ownerUserId, storagePrefix } = await this.workspaceService.getStorageContext(
      workspaceId,
    );

    // Create document records and generate URLs for each file.
    // Names resolve sequentially so duplicates within the same batch also get
    // auto-incremented suffixes (e.g., uploading two "report.pdf" yields
    // "report.pdf" + "report (1).pdf").
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const documentId = new Types.ObjectId();
      const effectiveName = await this.resolveUniqueOriginalName(workspaceId, file.filename);
      const blobPath = this.generateBlobPath(ownerUserId, storagePrefix, effectiveName);

      // Create pending document (url is set after upload completes)
      await this.documentModel.create({
        _id: documentId,
        filename: this.sanitizeFilename(effectiveName),
        originalName: effectiveName,
        mimeType: file.mimeType,
        size: file.size,
        path: blobPath,
        workspaceId: new Types.ObjectId(workspaceId),
        createdBy: new Types.ObjectId(userId),
        status: DocumentStatus.PENDING,
      });

      // Generate presigned URL
      const uploadUrl = await this.documentService.generateSasUrl(blobPath, {
        permissions: 'cw',
        expiryMinutes: this.sasUrlExpiryMinutes,
      });

      sessionFiles.push({
        index: i,
        filename: effectiveName,
        mimeType: file.mimeType,
        size: file.size,
        documentId,
        uploadUrl,
        status: 'pending',
        progress: 0,
      });

      responseFiles.push({
        index: i,
        filename: effectiveName,
        uploadUrl,
        documentId: documentId.toString(),
      });
    }

    // Create session record
    const session = await this.uploadSessionModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(userId),
      status: UploadSessionStatus.PENDING,
      files: sessionFiles,
      totalFiles: files.length,
      totalSize,
      completedFiles: 0,
      failedFiles: 0,
      expiresAt,
    });

    this.logger.debug('Bulk upload session created', {
      sessionId: session._id,
      workspaceId,
      fileCount: files.length,
      totalSize,
    });

    return {
      sessionId: session._id.toString(),
      files: responseFiles,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Report upload progress for a file in bulk upload
   * Note: This only updates the session state for tracking/debugging.
   * SSE notifications are NOT sent for progress updates since the frontend
   * already knows the progress (it's doing the upload directly to Azure).
   * SSE is only used for completion/failure notifications.
   */
  async reportProgress(
    workspaceId: string,
    userId: string,
    sessionId: string,
    data: ReportProgressData,
  ): Promise<void> {
    const session = await this.uploadSessionModel.findOne({
      _id: sessionId,
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(userId),
    });

    if (!session) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_UPLOAD_SESSION_NOT_FOUND,
        'Upload session not found',
      );
    }

    if (session.status === UploadSessionStatus.EXPIRED) {
      throw new BadRequestException(
        'Upload session has expired',
      );
    }

    // Update file progress
    const file = session.files[data.fileIndex];
    if (!file) {
      throw new BadRequestException(
        'File index not found in session',
      );
    }

    file.status = data.status;
    file.progress = data.progress;
    if (data.error) {
      file.error = data.error;
    }

    // Update session status
    if (session.status === UploadSessionStatus.PENDING) {
      session.status = UploadSessionStatus.IN_PROGRESS;
    }

    await session.save();

    // Note: No SSE notification for progress - frontend already has this data.
    // SSE notifications are only sent for upload_complete and upload_failed events.
  }

  /**
   * Complete bulk upload session
   */
  async completeBulkUpload(
    workspaceId: string,
    userId: string,
    sessionId: string,
    deepSearch?: boolean,
    autoIndex: boolean = true,
  ): Promise<BulkUploadCompleteResponse> {
    const startTime = Date.now();

    const session = await this.uploadSessionModel.findOne({
      _id: sessionId,
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(userId),
    });

    if (!session) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_UPLOAD_SESSION_NOT_FOUND,
        'Upload session not found',
      );
    }

    const successful: { count: number; documents: DocumentResponse[] } = {
      count: 0,
      documents: [],
    };
    const failed: { count: number; files: Array<{ index: number; filename: string; error: string }> } = {
      count: 0,
      files: [],
    };

    // Process each file
    for (const file of session.files) {
      const document = await this.documentModel.findById(file.documentId);

      if (!document) {
        failed.count++;
        failed.files.push({
          index: file.index,
          filename: file.filename,
          error: 'Document record not found',
        });
        continue;
      }

      // Check if blob exists (skip for folders). Ceph/S3 often returns a transient
      // 403 Unknown on HeadObject right after a browser presigned PUT; do not fail
      // the whole bulk complete (and skip auto-index) when that happens — the client
      // already reported a successful upload for this session file.
      let exists = false;
      if (document.isFolder) {
        exists = false;
      } else if (document.path) {
        try {
          exists = await this.documentService.exists(document.path);
        } catch (error) {
          const httpStatus = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
            ?.httpStatusCode;
          if (httpStatus === 403) {
            this.logger.warn(
              'HeadObject returned 403 during bulk complete; assuming object present after client PUT',
              {
                sessionId,
                documentId: document._id,
                path: document.path,
              },
            );
            exists = true;
          } else {
            throw error;
          }
        }
      }

      if (exists || document.isFolder) {
        // Mark as completed
        document.status = DocumentStatus.COMPLETED;
        document.uploadedAt = new Date();
        document.url = document.path;
        document.metadata = {
          ...document.metadata,
          deepSearchRequested: String(Boolean(deepSearch)),
          autoIndexRequested: String(autoIndex),
        };
        await document.save();
        await this.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentRegisteredV1, document);
        await this.recordWorkspaceEvent(WorkspaceIntegrationEvents.ArtifactReadyV1, document);

        // Trigger indexing (non-blocking). Skip folders — nothing to index —
        // and skip entirely when auto-indexation is disabled by the uploader.
        if (!document.isFolder && autoIndex) {
          this.indexingService.queueDocument(document._id.toString(), deepSearch).catch((err) => {
            this.logger.warn('Failed to queue document for indexing', {
              documentId: document._id,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          });
        }

        // Update workspace storage
        await this.workspaceService.updateStorageUsage(workspaceId, document.size, 1);

        successful.count++;
        successful.documents.push(this.mapToResponse(document));
      } else {
        // Clean up any partial blob that might exist (skip for folders)
        try {
          if (!document.isFolder && document.path) {
            await this.documentService.delete(document.path);
          }
        } catch (error) {
          this.logger.warn('Failed to delete orphaned blob during bulk upload completion', {
            sessionId,
            documentId: document._id,
            path: document.path,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        // Delete the failed document record from database
        await this.documentModel.deleteOne({ _id: document._id });

        failed.count++;
        failed.files.push({
          index: file.index,
          filename: file.filename,
          error: file.error || 'File not found in storage',
        });
      }
    }

    // Update session status
    if (failed.count === 0) {
      session.status = UploadSessionStatus.COMPLETED;
    } else if (successful.count === 0) {
      session.status = UploadSessionStatus.FAILED;
    } else {
      session.status = UploadSessionStatus.COMPLETED; // Partial success still marked completed
    }
    session.completedFiles = successful.count;
    session.failedFiles = failed.count;
    await session.save();

    const duration = Date.now() - startTime;

    // Determine overall status
    let status: 'success' | 'partial' | 'failed';
    if (failed.count === 0) {
      status = 'success';
    } else if (successful.count === 0) {
      status = 'failed';
    } else {
      status = 'partial';
    }

    // Send completion notification
    await this.sendUploadNotification(userId, {
      eventType: status === 'failed' ? 'upload_failed' : 'upload_complete',
      sessionId,
      summary: {
        total: session.totalFiles,
        successful: successful.count,
        failed: failed.count,
      },
    });

    this.logger.debug('Bulk upload completed', {
      sessionId,
      workspaceId,
      status,
      successful: successful.count,
      failed: failed.count,
      duration,
    });

    return {
      sessionId,
      status,
      totalFiles: session.totalFiles,
      successful,
      failed,
      duration,
    };
  }

  /**
   * Get upload session status
   */
  async getUploadSession(
    workspaceId: string,
    userId: string,
    sessionId: string,
  ): Promise<UploadSessionResponse> {
    const session = await this.uploadSessionModel.findOne({
      _id: sessionId,
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(userId),
    });

    if (!session) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_UPLOAD_SESSION_NOT_FOUND,
        'Upload session not found',
      );
    }

    return this.mapSessionToResponse(session);
  }

  /**
   * List documents in a workspace
   */
  async findAllByWorkspace(
    workspaceId: string,
    params: DocumentQueryParams,
  ): Promise<PaginatedDocuments> {
    const {
      page = 1,
      limit = 20,
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      parentId,
    } = params;

    const skip = (page - 1) * limit;

    // Build query — default to completed so pending/failed uploads are hidden
    const query: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      status: status || DocumentStatus.COMPLETED,
    };

    // Filter by parent folder ID
    if (parentId === null || parentId === undefined) {
      // Root level: show items with no parent
      query.parentId = { $in: [null, undefined] };
    } else if (parentId) {
      // Specific folder: show items in that folder
      query.parentId = new Types.ObjectId(parentId);
    }

    if (search) {
      query.$or = [
        { originalName: { $regex: escapeRegex(search), $options: 'i' } },
        { folderName: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    // Build sort - folders first
    const sort: Record<string, 1 | -1> = {
      isFolder: -1,
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    // Execute queries
    // Count includes both folders and documents for accurate pagination
    const [documents, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments(query),
    ]);

    return {
      documents: documents.map((d) => this.mapToResponse(d)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * List documents across multiple workspaces
   */
  async findByMultipleWorkspaces(
    workspaceIds: string[],
    params: DocumentQueryParams,
  ): Promise<PaginatedDocuments> {
    const {
      page = 1,
      limit = 20,
      status,
      search,
      searchFilename,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {
      workspaceId: { $in: workspaceIds.map((id) => new Types.ObjectId(id)) },
      status: status || DocumentStatus.COMPLETED,
    };

    if (search) {
      const namePattern = { $regex: escapeRegex(search), $options: 'i' };
      if (searchFilename) {
        query.$or = [{ originalName: namePattern }, { filename: namePattern }];
      } else {
        query.originalName = namePattern;
      }
    }

    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    const [documents, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments(query),
    ]);

    return {
      documents: documents.map((d) => this.mapToResponse(d)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get document by ID
   */
  async findById(
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentResponse> {
    const document = await this.documentModel.findOne({
      _id: documentId,
      workspaceId: new Types.ObjectId(workspaceId),
    });

    if (!document) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    return this.mapToResponse(document);
  }

  /**
   * Get download URL for a document
   */
  async getDownloadUrl(
    workspaceId: string,
    documentId: string,
  ): Promise<DownloadUrlResponse> {
    const document = await this.documentModel.findOne({
      _id: documentId,
      workspaceId: new Types.ObjectId(workspaceId),
    });

    if (!document) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    if (document.isFolder) {
      throw new BadRequestException(
        'Folders cannot be downloaded directly',
      );
    }

    if (document.status !== DocumentStatus.COMPLETED) {
      throw new BadRequestException(
        'Document is not available for download',
      );
    }

    const url = await this.documentService.generateSasUrl(document.path!, {
      permissions: 'r',
      expiryMinutes: this.sasUrlExpiryMinutes,
      contentDisposition: `attachment; filename="${document.originalName}"`,
      checkExists: true,
    });

    const expiresAt = new Date(Date.now() + this.sasUrlExpiryMinutes * 60 * 1000);

    return {
      url,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Delete a single document
   */
  async delete(
    workspaceId: string,
    userId: string,
    documentId: string,
    cascadeArtifacts = false,
  ): Promise<void> {
    const document = await this.documentModel.findOne({
      _id: documentId,
      workspaceId: new Types.ObjectId(workspaceId),
    });

    if (!document) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    const linkedArtifactCount = await this.workspaceArtifacts.countBySource(
      workspaceId,
      documentId,
    );
    if (linkedArtifactCount > 0 && !cascadeArtifacts) {
      throw new ConflictException(
        ErrorCode.WORKSPACE_DOCUMENT_HAS_DERIVED_ARTIFACTS,
        `This document has ${linkedArtifactCount} linked decision flow(s)`,
      );
    }
    if (linkedArtifactCount > 0) {
      await this.workspaceArtifacts.deleteBySource(workspaceId, documentId);
    }

    // Delete from blob storage (skip for folders)
    try {
      if (!document.isFolder && document.path) {
        await this.documentService.delete(document.path);
      }
    } catch (error) {
      this.logger.warn('Failed to delete blob', {
        documentId,
        path: document.path,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Delete from indexing vectorstore (non-blocking)
    // Only if document was indexed (ready status)
    if (document.indexingStatus === IndexingStatus.READY) {
      this.indexingService.deleteDocumentIndex(documentId, workspaceId).catch((err) => {
        this.logger.warn('Failed to delete document index', {
          documentId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }

    // Preserve the Governance source history before the document row disappears.
    await this.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentDeletedV1, document);

    // Delete document record
    await this.documentModel.deleteOne({ _id: documentId });

    // Update workspace storage (negative delta)
    if (document.status === DocumentStatus.COMPLETED) {
      await this.workspaceService.updateStorageUsage(workspaceId, -document.size, -1);
    }

    this.logger.debug('Document deleted', {
      documentId,
      workspaceId,
    });
  }

  /**
   * Bulk delete documents
   */
  async bulkDelete(
    workspaceId: string,
    userId: string,
    documentIds: string[],
  ): Promise<BulkDeleteResult> {
    let deleted = 0;
    const failed: string[] = [];

    for (const documentId of documentIds) {
      try {
        await this.delete(workspaceId, userId, documentId);
        deleted++;
      } catch (error) {
        failed.push(documentId);
        this.logger.warn('Failed to delete document in bulk', {
          documentId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { deleted, failed };
  }

  /**
   * Delete all documents in a workspace
   */
  async deleteAllByWorkspace(workspaceId: string): Promise<void> {
    const documents = await this.documentModel.find({
      workspaceId: new Types.ObjectId(workspaceId),
    });

    await this.workspaceArtifacts.deleteAllByWorkspace(workspaceId);

    // Delete indexes from vectorstore for indexed documents (non-blocking, parallel)
    const indexedDocuments = documents.filter(
      (doc) => doc.indexingStatus === IndexingStatus.READY,
    );
    if (indexedDocuments.length > 0) {
      const indexDeletions = indexedDocuments.map((doc) =>
        this.indexingService
          .deleteDocumentIndex(doc._id.toString(), workspaceId)
          .catch((err) => {
            this.logger.warn('Failed to delete document index during workspace cleanup', {
              documentId: doc._id,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }),
      );
      await Promise.all(indexDeletions);
    }

    // Delete all blobs (skip for folders)
    const blobDeletions = documents.map((doc) =>
      (!doc.isFolder && doc.path ? this.documentService.delete(doc.path) : Promise.resolve())
        .catch((err) => {
          this.logger.warn('Failed to delete blob during workspace cleanup', {
            path: doc.path,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }),
    );
    await Promise.all(blobDeletions);

    // Calculate storage to reclaim (only completed documents count towards usage)
    const completedDocuments = documents.filter(
      (doc) => doc.status === DocumentStatus.COMPLETED,
    );
    const totalSize = completedDocuments.reduce((sum, doc) => sum + doc.size, 0);

    // Preserve Governance source history before removing document rows.
    for (const document of documents) {
      if (!document.isFolder) await this.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentDeletedV1, document);
    }

    // Delete all document records
    await this.documentModel.deleteMany({
      workspaceId: new Types.ObjectId(workspaceId),
    });

    // Also delete upload sessions
    await this.uploadSessionModel.deleteMany({
      workspaceId: new Types.ObjectId(workspaceId),
    });

    // Update workspace storage usage
    if (completedDocuments.length > 0) {
      await this.workspaceService.updateStorageUsage(
        workspaceId,
        -totalSize,
        -completedDocuments.length,
      );
    }

    this.logger.debug('All documents deleted from workspace', {
      workspaceId,
      count: documents.length,
      indexedCount: indexedDocuments.length,
      storageReclaimed: totalSize,
    });
  }

  /**
   * Cleanup expired upload sessions
   * Runs every 15 minutes to clean up abandoned uploads
   *
   * This handles the case where a user:
   * - Initiates a bulk upload (creates pending documents and session)
   * - Closes the browser/tab before completing
   * - Never calls completeBulkUpload
   *
   * Without cleanup, document records and potentially orphaned blobs
   * would remain indefinitely.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupExpiredSessions(): Promise<void> {
    const startTime = Date.now();

    try {
      // Find expired sessions that are still pending or in progress
      const expiredSessions = await this.uploadSessionModel.find({
        expiresAt: { $lt: new Date() },
        status: { $in: [UploadSessionStatus.PENDING, UploadSessionStatus.IN_PROGRESS] },
      });

      if (expiredSessions.length === 0) {
        return;
      }

      this.logger.debug('Starting cleanup of expired upload sessions', {
        count: expiredSessions.length,
      });

      let totalDocumentsDeleted = 0;
      let totalBlobsDeleted = 0;
      let totalSessionsExpired = 0;

      for (const session of expiredSessions) {
        try {
          // Process each file in the session
          for (const file of session.files) {
            const document = await this.documentModel.findById(file.documentId);

            if (!document) {
              continue;
            }

            // Only clean up documents still in PENDING status
            // (documents that were never confirmed)
            if (document.status === DocumentStatus.PENDING && !document.isFolder) {
              // Try to delete the blob from Azure (it may or may not exist)
              try {
                const exists = document.path ? await this.documentService.exists(document.path) : false;
                if (exists) {
                  await this.documentService.delete(document.path!);
                  totalBlobsDeleted++;
                }
              } catch (error) {
                this.logger.warn('Failed to delete orphaned blob during cleanup', {
                  sessionId: session._id,
                  documentId: document._id,
                  path: document.path,
                  error: error instanceof Error ? error.message : 'Unknown error',
                });
              }

              // Delete the document record
              await this.documentModel.deleteOne({ _id: document._id });
              totalDocumentsDeleted++;
            }
          }

          // Mark session as expired
          session.status = UploadSessionStatus.EXPIRED;
          await session.save();
          totalSessionsExpired++;
        } catch (error) {
          this.logger.error('Error cleaning up expired session', {
            sessionId: session._id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const duration = Date.now() - startTime;

      this.logger.debug('Expired upload sessions cleanup completed', {
        sessionsExpired: totalSessionsExpired,
        documentsDeleted: totalDocumentsDeleted,
        blobsDeleted: totalBlobsDeleted,
        duration,
      });
    } catch (error) {
      this.logger.error('Failed to cleanup expired upload sessions', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send upload progress notification via SSE
   */
  private async sendUploadNotification(
    userId: string,
    data: UploadProgressNotification,
  ): Promise<void> {
    try {
      let title: string;
      let message: string;
      let type: NotificationType;

      switch (data.eventType) {
        case 'upload_progress':
          title = 'Upload Progress';
          message = `Uploading ${data.filename}: ${data.progress}%`;
          type = NotificationType.INFO;
          break;
        case 'upload_complete':
          if (data.summary) {
            title = 'Upload Complete';
            message = `${data.summary.successful} of ${data.summary.total} files uploaded successfully`;
          } else {
            title = 'Upload Complete';
            message = `${data.filename} uploaded successfully`;
          }
          type = NotificationType.SUCCESS;
          break;
        case 'upload_failed':
          title = 'Upload Failed';
          message = data.error || 'Upload failed';
          if (data.summary) {
            message = `${data.summary.failed} of ${data.summary.total} files failed to upload`;
          }
          type = NotificationType.ERROR;
          break;
        default:
          return;
      }

      await this.notificationsService.sendToUser(userId, {
        type,
        title,
        message,
        data: data as unknown as Record<string, unknown>,
        metadata: {
          sourceModule: 'workspace',
        },
      });
    } catch (error) {
      this.logger.warn('Failed to send upload notification', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Create a folder in a workspace
   */
  async createFolder(
    workspaceId: string,
    userId: string,
    name: string,
    parentId?: string,
  ): Promise<DocumentResponse> {
    // Validate folder name
    const sanitizedName = this.sanitizeFilename(name);
    if (!sanitizedName) {
      throw new BadRequestException('Folder name cannot be empty');
    }

    // Check for duplicate folder name in same parent
    const query: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      isFolder: true,
      folderName: sanitizedName,
    };

    if (parentId) {
      query.parentId = new Types.ObjectId(parentId);
    } else {
      query.parentId = null;
    }

    const existing = await this.documentModel.findOne(query);
    if (existing) {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'A folder with this name already exists in this location',
      );
    }

    // Create folder record
    const folderId = new Types.ObjectId();
    const folderPath = `folder:${folderId}`; // Unique path for folders

    const folder = await this.documentModel.create({
      _id: folderId,
      filename: '', // Folders don't have files
      originalName: sanitizedName,
      mimeType: 'folder',
      size: 0,
      path: folderPath, // Unique path for folders to avoid duplicate key error
      workspaceId: new Types.ObjectId(workspaceId),
      createdBy: new Types.ObjectId(userId),
      status: DocumentStatus.COMPLETED,
      isFolder: true,
      folderName: sanitizedName,
      parentId: parentId ? new Types.ObjectId(parentId) : null,
    });

    this.logger.log('Folder created', {
      folderId: folder._id,
      workspaceId,
      name: sanitizedName,
      parentId,
    });

    return this.mapToResponse(folder);
  }

  /**
   * Rename a folder
   */
  async renameFolder(
    folderId: string,
    newName: string,
    userId: string,
  ): Promise<DocumentResponse> {
    const folder = await this.documentModel.findById(folderId);

    if (!folder) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Folder not found',
      );
    }

    if (!folder.isFolder) {
      throw new BadRequestException('Document is not a folder');
    }

    // Check permission - only creator can rename
    if (folder.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have permission to rename this folder',
      );
    }

    // Validate new name
    const sanitizedName = this.sanitizeFilename(newName);
    if (!sanitizedName) {
      throw new BadRequestException('Folder name cannot be empty');
    }

    // Check for duplicate folder name in same parent
    const query: Record<string, unknown> = {
      workspaceId: folder.workspaceId,
      createdBy: folder.createdBy,
      isFolder: true,
      folderName: sanitizedName,
      parentId: folder.parentId,
      _id: { $ne: folderId },
    };

    const existing = await this.documentModel.findOne(query);
    if (existing) {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'A folder with this name already exists in this location',
      );
    }

    folder.folderName = sanitizedName;
    folder.originalName = sanitizedName;
    await folder.save();

    this.logger.log('Folder renamed', {
      folderId: folder._id,
      userId,
      oldName: folder.originalName,
      newName: sanitizedName,
    });

    return this.mapToResponse(folder);
  }

  /**
   * Rename a document (its display `originalName`), preserving the file
   * extension. Only the display name changes — the stored blob path is
   * untouched, so view/download keep working.
   */
  async renameDocument(
    workspaceId: string,
    documentId: string,
    newName: string,
  ): Promise<DocumentResponse> {
    if (!Types.ObjectId.isValid(documentId)) {
      throw new NotFoundException(ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND, 'Document not found');
    }
    const doc = await this.documentModel.findById(documentId);
    if (!doc || doc.workspaceId.toString() !== workspaceId || doc.isFolder) {
      throw new NotFoundException(ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND, 'Document not found');
    }

    const trimmed = newName.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      throw new BadRequestException('Document name cannot be empty');
    }

    // Preserve the current extension (e.g. links are `.pdf`) so the name stays
    // consistent and never trips the "no extension" heuristics elsewhere.
    const ext = doc.originalName?.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
    const base = trimmed.toLowerCase().endsWith(ext.toLowerCase()) && ext
      ? trimmed.slice(0, trimmed.length - ext.length)
      : trimmed;
    doc.originalName = `${base.slice(0, 200).trim()}${ext}`;
    await doc.save();

    this.logger.log('Document renamed', { documentId, workspaceId, newName: doc.originalName });
    return this.mapToResponse(doc);
  }

  /**
   * Delete a folder and all its contents recursively
   */
  async deleteFolder(
    workspaceId: string,
    userId: string,
    folderId: string,
  ): Promise<{ deletedFolders: number; deletedDocuments: number }> {
    const folder = await this.documentModel.findOne({
      _id: folderId,
      workspaceId: new Types.ObjectId(workspaceId),
    });

    if (!folder) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Folder not found',
      );
    }

    if (!folder.isFolder) {
      throw new BadRequestException('Document is not a folder');
    }

    if (folder.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have access to this folder',
      );
    }

    const descendantDocumentIds = await this.collectFolderDocumentIds(
      new Types.ObjectId(folderId),
      workspaceId,
    );
    for (const documentId of descendantDocumentIds) {
      const linkedArtifactCount = await this.workspaceArtifacts.countBySource(
        workspaceId,
        documentId,
      );
      if (linkedArtifactCount > 0) {
        throw new ConflictException(
          ErrorCode.WORKSPACE_DOCUMENT_HAS_DERIVED_ARTIFACTS,
          'Delete linked decision flows before deleting this folder',
        );
      }
    }

    // Recursively delete all contents
    const result = await this.deleteFolderRecursive(new Types.ObjectId(folderId), workspaceId, userId);

    // Delete the folder itself
    await this.documentModel.deleteOne({
      _id: folderId,
      workspaceId: new Types.ObjectId(workspaceId),
    });

    this.logger.log('Folder deleted', {
      folderId,
      workspaceId,
      deletedFolders: result.deletedFolders + 1,
      deletedDocuments: result.deletedDocuments,
    });

    return {
      deletedFolders: result.deletedFolders + 1,
      deletedDocuments: result.deletedDocuments,
    };
  }

  /**
   * Recursively delete folder contents
   */
  private async deleteFolderRecursive(
    folderId: Types.ObjectId,
    workspaceId: string,
    userId: string,
  ): Promise<{ deletedFolders: number; deletedDocuments: number }> {
    // Find all items in the folder
    const items = await this.documentModel.find({
      parentId: folderId,
      workspaceId: new Types.ObjectId(workspaceId),
    });

    let deletedFolders = 0;
    let deletedDocuments = 0;

    for (const item of items) {
      if (item.isFolder) {
        // Recursively delete subfolder
        const subResult = await this.deleteFolderRecursive(
          item._id,
          workspaceId,
          userId,
        );
        deletedFolders += subResult.deletedFolders + 1;
        deletedDocuments += subResult.deletedDocuments;
      } else {
        // Delete document file from storage (skip for folders)
        try {
          if (!item.isFolder && item.path) {
            await this.documentService.delete(item.path);
          }
        } catch (error) {
          this.logger.warn('Failed to delete blob', {
            documentId: item._id,
            path: item.path,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        // Delete document index
        if (item.indexingStatus === IndexingStatus.READY) {
          this.indexingService.deleteDocumentIndex(item._id.toString(), workspaceId).catch((err) => {
            this.logger.warn('Failed to delete document index', {
              documentId: item._id,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          });
        }

        await this.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentDeletedV1, item);

        deletedDocuments++;
      }

      // Delete item record
      await this.documentModel.deleteOne({ _id: item._id });
    }

    return { deletedFolders, deletedDocuments };
  }

  private async collectFolderDocumentIds(folderId: Types.ObjectId, workspaceId: string): Promise<string[]> {
    const items = await this.documentModel.find({ parentId: folderId, workspaceId: new Types.ObjectId(workspaceId) });
    const ids: string[] = [];
    for (const item of items) {
      if (item.isFolder) ids.push(...await this.collectFolderDocumentIds(item._id, workspaceId));
      else ids.push(item._id.toString());
    }
    return ids;
  }

  /**
   * Move documents/folders to a different folder
   */
  async moveDocuments(
    workspaceId: string,
    documentIds: string[],
    targetFolderId?: string,
    userId?: string,
  ): Promise<{ moved: number; failed: string[] }> {
    const moved: string[] = [];
    const failed: string[] = [];

    // Helper function to get all descendant folder IDs (to prevent circular moves)
    const getDescendantFolderIds = async (folderId: string): Promise<Set<string>> => {
      const descendants = new Set<string>();
      const queue = [folderId];

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const children = await this.documentModel.find({
          parentId: new Types.ObjectId(currentId),
          isFolder: true,
        }).select('_id').exec();

        for (const child of children) {
          descendants.add(child._id.toString());
          queue.push(child._id.toString());
        }
      }

      return descendants;
    };

    // If target folder is provided, verify it exists and user has access
    if (targetFolderId) {
      const targetFolder = await this.documentModel.findById(targetFolderId);
      if (!targetFolder || !targetFolder.isFolder) {
        throw new BadRequestException('Target folder not found');
      }
      if (userId && targetFolder.createdBy.toString() !== userId) {
        throw new ForbiddenException(
          ErrorCode.WORKSPACE_FORBIDDEN,
          'You do not have permission to move items into this folder',
        );
      }
    }

    for (const documentId of documentIds) {
      try {
        const document = await this.documentModel.findById(documentId);

        if (!document) {
          failed.push(documentId);
          continue;
        }

        if (document.workspaceId.toString() !== workspaceId) {
          failed.push(documentId);
          continue;
        }

        // Check permission - only creator can move
        if (userId && document.createdBy.toString() !== userId) {
          failed.push(documentId);
          continue;
        }

        // If moving a folder, check for circular references
        if (document.isFolder && targetFolderId) {
          const descendants = await getDescendantFolderIds(documentId);
          if (descendants.has(targetFolderId)) {
            failed.push(documentId);
            continue;
          }

          // Cannot move folder into itself
          if (documentId === targetFolderId) {
            failed.push(documentId);
            continue;
          }
        }

        // Update parent folder
        document.parentId = targetFolderId
          ? new Types.ObjectId(targetFolderId)
          : undefined;
        await document.save();

        moved.push(documentId);
      } catch (error) {
        this.logger.warn('Failed to move document/folder', {
          documentId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        failed.push(documentId);
      }
    }

    this.logger.log('Documents/folders moved', {
      workspaceId,
      targetFolderId,
      movedCount: moved.length,
      failedCount: failed.length,
    });

    return {
      moved: moved.length,
      failed,
    };
  }

  /**
   * Get all documents and folders in a hierarchical structure
   */
  async findAllSorted(
    workspaceId: string,
    params: DocumentQueryParams,
  ): Promise<PaginatedDocuments> {
    const {
      page = 1,
      limit = 100,
      status,
      includeAllStatuses = false,
      search,
      sortBy = 'originalName',
      sortOrder = 'asc',
    } = params;

    const skip = (page - 1) * limit;

    // Build query
    const query: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      ...(includeAllStatuses ? {} : { status: status || DocumentStatus.COMPLETED }),
    };

    if (search) {
      query.originalName = { $regex: escapeRegex(search), $options: 'i' };
    }

    // Build sort
    const sort: Record<string, 1 | -1> = {
      isFolder: -1, // Folders first
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    // Execute queries
    const [items, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments(query),
    ]);

    return {
      documents: items.map((d) => this.mapToResponse(d)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get all folders in a workspace (no pagination, for sidebar tree view)
   */
  async getAllFolders(workspaceId: string): Promise<DocumentResponse[]> {
    const query: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      isFolder: true,
      status: DocumentStatus.COMPLETED,
    };

    const folders = await this.documentModel
      .find(query)
      .sort({ originalName: 1 })
      .exec();

    return folders.map((d) => this.mapToResponse(d));
  }

  /**
   * Get contents of a specific folder
   */
  async getFolderContents(
    workspaceId: string,
    folderId: string,
    params: DocumentQueryParams,
  ): Promise<PaginatedDocuments> {
    const {
      page = 1,
      limit = 50,
      search,
      sortBy = 'originalName',
      sortOrder = 'asc',
    } = params;

    const skip = (page - 1) * limit;

    // Build query for folder contents
    const query: Record<string, unknown> = {
      workspaceId: new Types.ObjectId(workspaceId),
      parentId: new Types.ObjectId(folderId),
      status: DocumentStatus.COMPLETED,
    };

    if (search) {
      query.$or = [
        { originalName: { $regex: escapeRegex(search), $options: 'i' } },
        { folderName: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    // Build sort - folders first
    const sort: Record<string, 1 | -1> = {
      isFolder: -1,
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    // Execute queries
    // Count includes both folders and documents for accurate pagination
    const [items, total] = await Promise.all([
      this.documentModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.documentModel.countDocuments(query),
    ]);

    return {
      documents: items.map((d) => this.mapToResponse(d)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Map document to response
   */
  private mapToResponse(document: WorkspaceDocumentDoc): DocumentResponse {
    return {
      id: document._id.toString(),
      filename: document.filename,
      originalName: document.originalName,
      mimeType: document.mimeType,
      size: document.size,
      path: document.path,
      url: document.url,
      contentHash: document.contentHash,
      workspaceId: document.workspaceId.toString(),
      createdBy: document.createdBy.toString(),
      status: document.status,
      uploadedAt: document.uploadedAt?.toISOString(),
      errorMessage: document.errorMessage,
      metadata: document.metadata,
      indexingStatus: document.indexingStatus || IndexingStatus.PENDING,
      indexingError: document.indexingError,
      indexingTaskName: document.indexingTaskName,
      indexingTaskId: document.indexingTaskId,
      lastIndexedAt: document.lastIndexedAt?.toISOString(),
      detected_language: document.detected_language,
      chunk_size: document.chunk_size,
      parentId: document.parentId?.toString(),
      isFolder: document.isFolder || false,
      folderName: document.folderName,
      type: (document.type as DocumentType) || DocumentType.DOC,
      sourceUrl: document.sourceUrl,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  /**
   * Map upload session to response
   */
  private mapSessionToResponse(session: UploadSessionDocument): UploadSessionResponse {
    return {
      id: session._id.toString(),
      workspaceId: session.workspaceId.toString(),
      userId: session.userId.toString(),
      status: session.status,
      files: session.files.map((f) => ({
        index: f.index,
        filename: f.filename,
        mimeType: f.mimeType,
        size: f.size,
        documentId: f.documentId?.toString(),
        status: f.status,
        progress: f.progress,
        error: f.error,
      })),
      totalFiles: session.totalFiles,
      totalSize: session.totalSize,
      completedFiles: session.completedFiles,
      failedFiles: session.failedFiles,
      expiresAt: session.expiresAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
  }
}
