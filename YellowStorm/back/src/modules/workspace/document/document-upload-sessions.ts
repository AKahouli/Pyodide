import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { newObjectId } from '@common/postgres';
import { DocumentStatus } from '../interfaces/document-status.enum';
import { IndexingService } from '../../indexing/indexing.service';
import { UploadSessionStatus } from '../interfaces/upload-session-status.enum';
import { DOCUMENT_STORE, type DocumentStore } from '../stores/document-store';
import { UPLOAD_SESSION_STORE, type UploadSessionStore } from '../stores/upload-session-store';
import {
  DocumentResponse,
} from '../interfaces/workspace-document.interface';
import {
  InitiateBulkUploadData,
  BulkUploadInitResponse,
  ReportProgressData,
  UploadSessionResponse,
  BulkUploadCompleteResponse,
} from '../interfaces/upload-session.interface';
import { WorkspaceService } from '../workspace.service';
import { DocumentService } from '../../document/document.service';
import { LoggerService } from '../../logger';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkspaceIntegrationEvents } from '../../integration-events/contracts';
import { WorkspaceDocumentSupport } from './document-support';

@Injectable()
export class WorkspaceDocumentUploadSessions {
  private readonly maxFilesPerBulkUpload: number;
  private readonly uploadSessionTtlMinutes: number;
  private readonly sasUrlExpiryMinutes: number;

  constructor(
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
    @Inject(UPLOAD_SESSION_STORE) private readonly uploadSessionStore: UploadSessionStore,
    private readonly workspaceService: WorkspaceService,
    private readonly documentService: DocumentService,
    @Inject(forwardRef(() => IndexingService))
    private readonly indexingService: IndexingService,
    private readonly configService: ConfigService,
    private readonly support: WorkspaceDocumentSupport,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkspaceDocumentUploadSessions');
    this.maxFilesPerBulkUpload = this.configService.get<number>('workspace.maxFilesPerBulkUpload', 50);
    this.uploadSessionTtlMinutes = this.configService.get<number>('workspace.uploadSessionTtlMinutes', 60);
    this.sasUrlExpiryMinutes = this.configService.get<number>('workspace.sasUrlExpiryMinutes', 60);
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
      await this.support.validateFile(file.filename, file.mimeType, file.size);
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
    const sessionFiles: {
      index: number;
      filename: string;
      mimeType: string;
      size: number;
      documentId: string;
      uploadUrl: string;
      status: string;
      progress: number;
    }[] = [];

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
      const documentId = newObjectId();
      let effectiveName = file.filename;
      let blobPath = '';

      // Create pending document (url is set after upload completes)
      await this.support.createWithUniqueName(workspaceId, file.filename, (resolvedName) => {
        effectiveName = resolvedName;
        blobPath = this.support.generateBlobPath(ownerUserId, storagePrefix, resolvedName);
        return {
          id: documentId,
          filename: this.support.sanitizeFilename(resolvedName),
          originalName: resolvedName,
          mimeType: file.mimeType,
          size: file.size,
          path: blobPath,
          workspaceId,
          createdBy: userId,
          status: DocumentStatus.PENDING,
        };
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
        documentId,
      });
    }

    // Create session record
    const session = await this.uploadSessionStore.create({
      workspaceId,
      userId,
      status: UploadSessionStatus.PENDING,
      files: sessionFiles.map((f) => ({
        index: f.index,
        filename: f.filename,
        mimeType: f.mimeType,
        size: f.size,
        documentId: f.documentId,
        uploadUrl: f.uploadUrl,
        status: f.status,
        progress: f.progress,
      })),
      totalFiles: files.length,
      totalSize,
      completedFiles: 0,
      failedFiles: 0,
      expiresAt,
    });

    this.logger.debug('Bulk upload session created', {
      sessionId: session.id,
      workspaceId,
      fileCount: files.length,
      totalSize,
    });

    return {
      sessionId: session.id,
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
    const session = await this.uploadSessionStore.findByIdWorkspaceUser(sessionId, workspaceId, userId);

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

    await this.uploadSessionStore.updateFileProgress(sessionId, data.fileIndex, {
      status: data.status,
      progress: data.progress,
      ...(data.error ? { error: data.error } : {}),
    });

    // Update session status
    if (session.status === UploadSessionStatus.PENDING) {
      await this.uploadSessionStore.setStatus(sessionId, UploadSessionStatus.IN_PROGRESS);
    }

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
    autoIndex = true,
  ): Promise<BulkUploadCompleteResponse> {
    const startTime = Date.now();

    const session = await this.uploadSessionStore.findByIdWorkspaceUser(sessionId, workspaceId, userId);

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
    const failed: { count: number; files: { index: number; filename: string; error: string }[] } = {
      count: 0,
      files: [],
    };

    // Process each file
    for (const file of session.files) {
      const document = await this.documentStore.findById(file.documentId!);

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
                documentId: document.id,
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
        const updated = await this.documentStore.markUploaded(document.id, {
          status: DocumentStatus.COMPLETED,
          uploadedAt: new Date(),
          url: document.path,
          metadata: {
            ...document.metadata,
            deepSearchRequested: String(Boolean(deepSearch)),
            autoIndexRequested: String(autoIndex),
          },
        });
        await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.DocumentRegisteredV1, updated!);
        await this.support.recordWorkspaceEvent(WorkspaceIntegrationEvents.ArtifactReadyV1, updated!);

        // Trigger indexing (non-blocking). Skip folders — nothing to index —
        // and skip entirely when auto-indexation is disabled by the uploader.
        if (!updated!.isFolder && autoIndex) {
          this.indexingService.queueDocument(updated!.id, deepSearch).catch((err) => {
            this.logger.warn('Failed to queue document for indexing', {
              documentId: updated!.id,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          });
        }

        // Update workspace storage
        await this.workspaceService.updateStorageUsage(workspaceId, updated!.size, 1);

        successful.count++;
        successful.documents.push(this.support.mapToResponse(updated!));
      } else {
        // Clean up any partial blob that might exist (skip for folders)
        try {
          if (!document.isFolder && document.path) {
            await this.documentService.delete(document.path);
          }
        } catch (error) {
          this.logger.warn('Failed to delete orphaned blob during bulk upload completion', {
            sessionId,
            documentId: document.id,
            path: document.path,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        // Delete the failed document record from database
        await this.documentStore.deleteById(document.id);

        failed.count++;
        failed.files.push({
          index: file.index,
          filename: file.filename,
          error: file.error || 'File not found in storage',
        });
      }
    }

    // Update session status
    const finalStatus = failed.count === 0
      ? UploadSessionStatus.COMPLETED
      : successful.count === 0
        ? UploadSessionStatus.FAILED
        : UploadSessionStatus.COMPLETED; // Partial success still marked completed
    await this.uploadSessionStore.setOutcome(sessionId, {
      status: finalStatus,
      completedFiles: successful.count,
      failedFiles: failed.count,
    });

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
    await this.support.sendUploadNotification(userId, {
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
    const session = await this.uploadSessionStore.findByIdWorkspaceUser(sessionId, workspaceId, userId);

    if (!session) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_UPLOAD_SESSION_NOT_FOUND,
        'Upload session not found',
      );
    }

    return this.support.mapSessionToResponse(session);
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
      const expiredSessions = await this.uploadSessionStore.findExpired(new Date());

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
            const document = await this.documentStore.findById(file.documentId!);

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
                  sessionId: session.id,
                  documentId: document.id,
                  path: document.path,
                  error: error instanceof Error ? error.message : 'Unknown error',
                });
              }

              // Delete the document record
              await this.documentStore.deleteById(document.id);
              totalDocumentsDeleted++;
            }
          }

          // Mark session as expired
          await this.uploadSessionStore.markExpired(session.id);
          totalSessionsExpired++;
        } catch (error) {
          this.logger.error('Error cleaning up expired session', {
            sessionId: session.id,
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
}
