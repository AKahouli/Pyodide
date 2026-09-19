import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  WorkspaceDoc,
  WorkspaceDocumentDoc,
  DocumentType,
  IndexingStatus,
} from '../schemas/workspace-document.schema';
import { collapseCharSet, stripLeadingTrailingWhitespaceOrDot } from '../../../common/utils';
import { normalizeWorkspaceUrl } from '../services/url-normalization';
import {
  UploadSessionDocument,
} from '../schemas/upload-session.schema';
import {
  DocumentResponse,
} from '../interfaces/workspace-document.interface';
import {
  UploadSessionResponse,
  UploadProgressNotification,
} from '../interfaces/upload-session.interface';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/schemas/notification.schema';
import { LoggerService } from '../../logger';
import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkspaceUploadSettingsService } from '../../system/workspace-upload-settings.service';
import { getUploadExtension } from '../../system/constants/workspace-upload-settings.constants';
import { IntegrationEventOutboxService } from '../../integration-events/services/integration-event-outbox.service';
import { FeatureVisibilityService } from '../../system/feature-visibility.service';

@Injectable()
export class WorkspaceDocumentSupport {
  private readonly maxFileSizeMb: number;

  constructor(
    @InjectModel(WorkspaceDoc.name)
    private readonly documentModel: Model<WorkspaceDocumentDoc>,
    private readonly uploadSettingsService: WorkspaceUploadSettingsService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    private readonly logger: LoggerService,
    @Optional() private readonly outbox?: IntegrationEventOutboxService,
    @Optional() private readonly featureVisibility?: FeatureVisibilityService,
  ) {
    this.logger.setContext('WorkspaceDocumentSupport');
    this.maxFileSizeMb = this.configService.get<number>('workspace.maxFileSizeMb', 500);
  }

  /**
   * Sanitize filename for storage
   */
  sanitizeFilename(filename: string): string {
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
  generateBlobPath(
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
  async resolveUniqueOriginalName(
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
  async validateFile(filename: string, mimeType: string, size: number): Promise<void> {
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
   * Map document to response
   */
  mapToResponse(document: WorkspaceDocumentDoc): DocumentResponse {
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
  mapSessionToResponse(session: UploadSessionDocument): UploadSessionResponse {
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

  /**
   * Send upload progress notification via SSE
   */
  async sendUploadNotification(
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

  async recordWorkspaceEvent(eventType: string, document: WorkspaceDocumentDoc): Promise<void> {
    if (!this.outbox || this.featureVisibility?.isEnabled('dataRoomWorkspaceEvents') === false) return;
    await this.outbox.record({ eventId: randomUUID(), eventType, aggregateType: 'workspace_document', aggregateId: document._id.toString(), payload: { workspaceId: document.workspaceId.toString(), documentId: document._id.toString(), createdBy: document.createdBy.toString(), documentType: document.type, originalName: document.originalName, mimeType: document.mimeType, sourceUrl: document.sourceUrl, normalizedSourceUrl: document.sourceUrl ? normalizeWorkspaceUrl(document.sourceUrl) : undefined, contentHash: document.contentHash, documentStatus: document.status, indexingStatus: document.indexingStatus, indexingTaskId: document.indexingTaskId, deepSearchRequested: document.metadata?.deepSearchRequested === 'true', metadata: document.metadata }, occurredAt: new Date() });
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
  ensurePdfExtension(name: string): string {
    return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
  }

  deriveFilenameFromUrl(url: string): string {
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
}
