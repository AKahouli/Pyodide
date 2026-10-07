import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isObjectId, newObjectId } from '@common/postgres';
import { IngestUrlDto } from '../dto/ingest-url.dto';
import { DocumentStatus, DocumentType, IndexingStatus } from '../interfaces/document-status.enum';
import { DOCUMENT_STORE, type DocumentStore } from '../stores/document-store';
import { redactUrlForLog, redactUrlsInMessage } from '../../../common/utils';
import { IndexingService } from '../../indexing/indexing.service';
import {
  RequestUploadUrlData,
  UploadUrlResponse,
  DocumentResponse,
} from '../interfaces/workspace-document.interface';
import { WorkspaceService } from '../workspace.service';
import { DocumentService } from '../../document/document.service';
import { LoggerService } from '../../logger';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { GuardedUrlDownloaderService } from '../services/guarded-url-downloader.service';
import { WorkspaceIntegrationEvents } from '../../integration-events/contracts';
import { WorkspaceDocumentSupport, isUniqueDocumentNameViolation } from './document-support';

/** Visible root folder holding files derived from workspace sources (e-mail texts, attachments). */
export const DERIVED_FOLDER_NAME = 'derived';

@Injectable()
export class WorkspaceDocumentWrite {
  private readonly smallFileThresholdMb: number;
  private readonly sasUrlExpiryMinutes: number;

  constructor(
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
    private readonly workspaceService: WorkspaceService,
    private readonly documentService: DocumentService,
    @Inject(forwardRef(() => IndexingService))
    private readonly indexingService: IndexingService,
    private readonly configService: ConfigService,
    private readonly urlDownloader: GuardedUrlDownloaderService,
    private readonly support: WorkspaceDocumentSupport,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkspaceDocumentWrite');
    this.smallFileThresholdMb = this.configService.get<number>('workspace.smallFileThresholdMb', 10);
    this.sasUrlExpiryMinutes = this.configService.get<number>('workspace.sasUrlExpiryMinutes', 60);
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
    await this.support.validateFile(data.filename, data.mimeType, data.size);

    const quota = await this.workspaceService.checkStorageQuota(workspaceId, data.size);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB, Required: ${Math.round(data.size / 1024 / 1024)}MB`,
      );
    }

    const documentId = newObjectId();
    let blobPath = '';
    const document = await this.support.createWithUniqueName(workspaceId, data.filename, (effectiveName) => {
      const sanitizedName = this.support.sanitizeFilename(effectiveName);
      blobPath = `${pathPrefix}/${sanitizedName}`;
      return {
        id: documentId,
        filename: sanitizedName,
        originalName: effectiveName,
        mimeType: data.mimeType,
        size: data.size,
        path: blobPath,
        workspaceId,
        createdBy: userId,
        status: DocumentStatus.PENDING,
        indexingStatus: IndexingStatus.READY, // Conversation files are not indexed
      };
    });

    const uploadUrl = await this.documentService.generateSasUrl(blobPath, {
      permissions: 'cw',
      expiryMinutes: this.sasUrlExpiryMinutes,
    });

    const expiresAt = new Date(Date.now() + this.sasUrlExpiryMinutes * 60 * 1000);

    this.logger.debug('Upload URL generated (custom path)', {
      documentId: document.id,
      workspaceId,
      pathPrefix,
      filename: data.filename,
    });

    return {
      documentId: document.id,
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

    await this.support.validateFile(originalName, mimeType, size);

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

    const documentId = newObjectId();
    const reserved = await this.support.createWithUniqueName(workspaceId, originalName, (effectiveName) => ({
      id: documentId,
      originalName: effectiveName,
      mimeType,
      size,
      workspaceId,
      createdBy: userId,
      status: DocumentStatus.UPLOADING,
      indexingStatus: IndexingStatus.READY, // Conversation files are not indexed
    }));
    const document = await this.completeDirectUpload(reserved, file, mimeType, pathPrefix);

    await this.workspaceService.updateStorageUsage(workspaceId, size, 1);

    this.logger.debug('Small file uploaded (custom path)', {
      documentId: document.id,
      workspaceId,
      pathPrefix,
      size,
    });

    return this.support.mapToResponse(document);
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
    await this.support.validateFile(data.filename, data.mimeType, data.size);

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
    const documentId = newObjectId();
    let blobPath = '';
    const document = await this.support.createWithUniqueName(workspaceId, data.filename, (effectiveName) => {
      blobPath = this.support.generateBlobPath(ownerUserId, storagePrefix, effectiveName);
      return {
        id: documentId,
        filename: this.support.sanitizeFilename(effectiveName),
        originalName: effectiveName,
        mimeType: data.mimeType,
        size: data.size,
        path: blobPath,
        // url is set after upload completes
        workspaceId,
        createdBy: userId,
        status: DocumentStatus.PENDING,
      };
    });

    // Generate presigned URL with write permission
    const uploadUrl = await this.documentService.generateSasUrl(blobPath, {
      permissions: 'cw', // Create and Write
      expiryMinutes: this.sasUrlExpiryMinutes,
    });

    const expiresAt = new Date(Date.now() + this.sasUrlExpiryMinutes * 60 * 1000);

    this.logger.debug('Upload URL generated', {
      documentId: document.id,
      workspaceId,
      filename: data.filename,
    });

    return {
      documentId: document.id,
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
    options?: { autoIndex?: boolean },
  ): Promise<DocumentResponse> {
    const document = await this.documentStore.findByIdAndWorkspace(documentId, workspaceId);

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
    const updated = await this.documentStore.markUploaded(document.id, {
      status: DocumentStatus.COMPLETED,
      uploadedAt: new Date(),
      url: document.path, // Canonical object key (no presigned signature)
      metadata: {
        ...document.metadata,
        deepSearchRequested: String(Boolean(deepSearch)),
        autoIndexRequested: String(options?.autoIndex !== false),
      },
    });
    await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentRegisteredV1, updated!);
    await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.ArtifactReadyV1, updated!);

    // Trigger indexing (non-blocking). Skip folders — they have no blob to index.
    // Conversation system-workspace files opt out here: their attachments are
    // indexed (or deliberately not) only after the attachment policy is known.
    if (!updated!.isFolder && options?.autoIndex !== false) {
      this.indexingService.queueDocument(updated!.id, deepSearch).catch((err) => {
        this.logger.warn('Failed to queue document for indexing', {
          documentId: updated!.id,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }

    // Update workspace storage usage
    await this.workspaceService.updateStorageUsage(workspaceId, updated!.size, 1);

    // Send notification
    await this.support.sendUploadNotification(userId, {
      eventType: 'upload_complete',
      sessionId: '',
      filename: updated!.originalName,
      document: this.support.mapToResponse(updated!),
    });

    this.logger.debug('Upload confirmed', {
      documentId: updated!.id,
      workspaceId,
    });

    return this.support.mapToResponse(updated!);
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
    autoIndex = true,
  ): Promise<DocumentResponse> {
    const size = file.length;

    // Validate file
    await this.support.validateFile(originalName, mimeType, size);

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
      parentFolder = await this.documentStore.findByIdAndWorkspace(folderId, workspaceId);
      if (!parentFolder?.isFolder) {
        throw new BadRequestException('Folder not found');
      }
    }

    // Create document record. Path roots under the workspace OWNER so
    // collaborator uploads share the same Ceph prefix as the owner's files.
    const { ownerUserId, storagePrefix } = await this.workspaceService.getStorageContext(
      workspaceId,
    );
    const documentId = newObjectId();
    // Reserve the name first (retried under the next free name if a concurrent
    // upload took it), then write the blob under the reserved name.
    const reserved = await this.support.createWithUniqueName(workspaceId, originalName, (effectiveName) => ({
      id: documentId,
      originalName: effectiveName,
      mimeType,
      size,
      workspaceId,
      createdBy: userId,
      status: DocumentStatus.UPLOADING,
      parentId: folderId ?? null,
      metadata: {
        deepSearchRequested: String(Boolean(deepSearch)),
        autoIndexRequested: String(autoIndex),
      },
    }));
    const document = await this.completeDirectUpload(reserved, file, mimeType, `${ownerUserId}/${storagePrefix}`);
    await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentRegisteredV1, document);
    await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.ArtifactReadyV1, document);

    // Trigger indexing (non-blocking), unless auto-indexation is disabled.
    if (autoIndex) {
      this.indexingService.queueDocument(document.id, deepSearch).catch((err) => {
        this.logger.warn('Failed to queue document for indexing', {
          documentId: document.id,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }

    // Update workspace storage
    await this.workspaceService.updateStorageUsage(workspaceId, size, 1);

    this.logger.debug('Small file uploaded', {
      documentId: document.id,
      workspaceId,
      size,
      folderId,
    });

    return this.support.mapToResponse(document);
  }

  /**
   * Store a file derived from a workspace source (an e-mail's text or one of its attachments)
   * in the visible folder `derived/<source name>`, then index it like an upload.
   *
   * Derived names carry content keys, so a file already stored under the same name in that
   * folder is returned as is: re-reading an archive does not duplicate or re-index anything.
   * The blobs live under `<owner>/<prefix>/derived/<source>/` in storage, mirroring the folder.
   */
  async storeDerivedFile(params: {
    workspaceId: string;
    userId: string;
    sourceDocumentId: string;
    sourceName: string;
    fileName: string;
    mimeType: string;
    file: Buffer;
  }): Promise<{ document: DocumentResponse; created: boolean }> {
    const { workspaceId, userId, sourceDocumentId, file, mimeType } = params;
    const fileName = this.support.sanitizeFilename(params.fileName);
    if (!fileName) throw new BadRequestException('A derived file needs a name');
    await this.support.validateFile(fileName, mimeType, file.length);

    const root = await this.ensureFolder(workspaceId, userId, DERIVED_FOLDER_NAME, null);
    const sourceFolderName = this.support.sanitizeFilename(params.sourceName) || sourceDocumentId;
    const folder = await this.ensureFolder(workspaceId, userId, sourceFolderName, root.id);

    // Names are unique in a workspace and carry the message key, so the same name and size is the
    // same message or attachment: an e-mail found in two archives is kept once, under the first.
    const existing = await this.documentStore.findFileByName(workspaceId, fileName);
    if (existing && existing.size === file.length && existing.status === DocumentStatus.COMPLETED) {
      return { document: this.support.mapToResponse(existing), created: false };
    }

    const quota = await this.workspaceService.checkStorageQuota(workspaceId, file.length);
    if (!quota.allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
        `Insufficient storage. Available: ${Math.round(quota.available / 1024 / 1024)}MB`,
      );
    }
    const { ownerUserId, storagePrefix } = await this.workspaceService.getStorageContext(workspaceId);
    const documentId = newObjectId();
    const reserved = await this.support.createWithUniqueName(workspaceId, fileName, (effectiveName) => ({
      id: documentId,
      originalName: effectiveName,
      mimeType,
      size: file.length,
      workspaceId,
      createdBy: userId,
      status: DocumentStatus.UPLOADING,
      parentId: folder.id,
      metadata: { autoIndexRequested: 'true', derivedFromDocumentId: sourceDocumentId },
    }));
    const storageFolder = `${ownerUserId}/${storagePrefix}/${DERIVED_FOLDER_NAME}/${this.support.sanitizeFilename(sourceFolderName)}`;
    const document = await this.completeDirectUpload(reserved, file, mimeType, storageFolder);
    await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentRegisteredV1, document);
    await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.ArtifactReadyV1, document);
    this.indexingService.queueDocument(document.id, false).catch((err) => {
      this.logger.warn('Failed to queue derived document for indexing', {
        documentId: document.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    });
    await this.workspaceService.updateStorageUsage(workspaceId, file.length, 1);
    return { document: this.support.mapToResponse(document), created: true };
  }

  /** The folder `name` under `parentId` (null: workspace root), created when missing. */
  private async ensureFolder(workspaceId: string, userId: string, name: string, parentId: string | null) {
    const probe = { workspaceId, createdBy: userId, folderName: name, parentId };
    const existing = await this.documentStore.findFolderDuplicate(probe);
    if (existing) return existing;
    const folderId = newObjectId();
    try {
      return await this.documentStore.create({
        id: folderId,
        filename: '',
        originalName: name,
        mimeType: 'folder',
        size: 0,
        path: `folder:${folderId}`,
        workspaceId,
        createdBy: userId,
        status: DocumentStatus.COMPLETED,
        isFolder: true,
        folderName: name,
        parentId,
      });
    } catch (error) {
      // A concurrent writer created it first.
      const created = await this.documentStore.findFolderDuplicate(probe);
      if (created) return created;
      throw error;
    }
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
      await this.documentStore.updateById(doc.id, { metadata: dto.sourceMeta });
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

    await this.documentStore.create({
      workspaceId: systemWorkspaceId,
      createdBy: createdByStr,
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
   * Rename a document (its display `originalName`), preserving the file
   * extension. Only the display name changes — the stored blob path is
   * untouched, so view/download keep working.
   */
  async renameDocument(
    workspaceId: string,
    documentId: string,
    newName: string,
  ): Promise<DocumentResponse> {
    documentId = documentId.toLowerCase();
    if (!isObjectId(documentId)) {
      throw new NotFoundException(ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND, 'Document not found');
    }
    const doc = await this.documentStore.findById(documentId);
    if (!doc || doc.workspaceId !== workspaceId || doc.isFolder) {
      throw new NotFoundException(ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND, 'Document not found');
    }

    const trimmed = newName.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      throw new BadRequestException('Document name cannot be empty');
    }

    // Preserve the current extension (e.g. links are `.pdf`) so the name stays
    // consistent and never trips the "no extension" heuristics elsewhere.
    const ext = (/\.[a-z0-9]+$/i.exec(doc.originalName))?.[0] ?? '';
    const base = trimmed.toLowerCase().endsWith(ext.toLowerCase()) && ext
      ? trimmed.slice(0, trimmed.length - ext.length)
      : trimmed;
    let renamed: Awaited<ReturnType<DocumentStore['renameOriginalName']>>;
    try {
      renamed = await this.documentStore.renameOriginalName(documentId, `${base.slice(0, 200).trim()}${ext}`);
    } catch (error) {
      if (isUniqueDocumentNameViolation(error)) {
        throw new ConflictException(
          ErrorCode.CONFLICT,
          'A document with this name already exists in this workspace',
        );
      }
      throw error;
    }

    this.logger.log('Document renamed', { documentId, workspaceId, newName: renamed!.originalName });
    return this.support.mapToResponse(renamed!);
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
    const target = targetFolderId?.toLowerCase();

    // All descendant folder IDs of `folderId` (to prevent circular moves).
    // `visited` bounds the walk even if the tree already contains a cycle.
    const getDescendantFolderIds = async (folderId: string): Promise<Set<string>> => {
      const descendants = new Set<string>();
      const queue = [folderId];

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const children = await this.documentStore.findChildFolderIds(currentId);

        for (const child of children) {
          if (descendants.has(child) || child === folderId) continue;
          descendants.add(child);
          queue.push(child);
        }
      }

      return descendants;
    };

    // If target folder is provided, verify it exists, lives in this workspace
    // and the user has access.
    if (target) {
      const targetFolder = await this.documentStore.findById(target);
      if (!targetFolder || !targetFolder.isFolder || targetFolder.workspaceId !== workspaceId) {
        throw new BadRequestException('Target folder not found');
      }
      if (userId && targetFolder.createdBy !== userId) {
        throw new ForbiddenException(
          ErrorCode.WORKSPACE_FORBIDDEN,
          'You do not have permission to move items into this folder',
        );
      }
    }

    for (const rawId of documentIds) {
      const documentId = rawId.toLowerCase();
      try {
        // Cycle check + move run atomically under a per-workspace tree lock so
        // two concurrent moves cannot each pass the check and form a cycle.
        const ok = await this.documentStore.withWorkspaceTreeLock(workspaceId, async () => {
          const document = await this.documentStore.findById(documentId);

          // Every moved item must belong to this workspace.
          if (!document || document.workspaceId !== workspaceId) return false;

          // Check permission - only creator can move
          if (userId && document.createdBy !== userId) return false;

          if (target) {
            // Re-check the target inside the lock (it may have moved/vanished).
            const targetFolder = await this.documentStore.findById(target);
            if (!targetFolder || !targetFolder.isFolder || targetFolder.workspaceId !== workspaceId) {
              return false;
            }
            // Cannot move a folder into itself or one of its descendants.
            if (document.isFolder) {
              if (documentId === target) return false;
              const descendants = await getDescendantFolderIds(documentId);
              if (descendants.has(target)) return false;
            }
          }

          await this.documentStore.setParent(documentId, target ?? null);
          return true;
        });

        if (ok) moved.push(rawId);
        else failed.push(rawId);
      } catch (error) {
        this.logger.warn('Failed to move document/folder', {
          documentId: rawId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        failed.push(rawId);
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
   * Second half of a direct upload: write the blob under the name reserved by an
   * UPLOADING row, then complete the row. Blob keys are name-based
   * (generateUniqueName: false), so uploading before the row existed let the loser
   * of a concurrent same-name upload overwrite the winner's object. On failure the
   * reservation is released so the name is free again.
   */
  private async completeDirectUpload(
    reserved: Awaited<ReturnType<DocumentStore['create']>>,
    file: Buffer,
    mimeType: string,
    folder: string,
  ): Promise<Awaited<ReturnType<DocumentStore['create']>>> {
    try {
      const uploaded = await this.documentService.upload(file, reserved.originalName, mimeType, {
        folder,
        generateUniqueName: false,
        customFileName: this.support.sanitizeFilename(reserved.originalName),
      });
      const completed = await this.documentStore.updateById(reserved.id, {
        filename: uploaded.storedName,
        path: uploaded.blobPath,
        url: uploaded.url,
        contentHash: uploaded.contentHash,
        status: DocumentStatus.COMPLETED,
        uploadedAt: new Date(),
      });
      if (!completed) throw new NotFoundException(ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND, 'Document removed during upload');
      return completed;
    } catch (error) {
      await this.documentStore.deleteById(reserved.id).catch((cleanupError: unknown) => {
        this.logger.warn('Failed to release document reservation after upload failure', {
          documentId: reserved.id,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      });
      throw error;
    }
  }
}
