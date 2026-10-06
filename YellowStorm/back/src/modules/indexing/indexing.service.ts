import { Injectable, Inject, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DocumentStatus, IndexingStatus } from '../workspace/interfaces/document-status.enum';
import {      
  type IndexingStatePatch,        
  type WorkspaceDocumentRecord,        
} from '../workspace/ports';
import { IndexingClientService } from './indexing-client.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.types';
import { DocumentService } from '../document/document.service';
import { LoggerService } from '../logger';
import {
  NotFoundException,
  BadRequestException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { IntegrationEventOutboxService } from '../integration-events/services/integration-event-outbox.service';
import { FeatureVisibilityService } from '../system/feature-visibility.service';
import { WorkspaceIntegrationEvents } from '../integration-events/contracts';
import { randomUUID } from 'crypto';
import { PgWorkspaceSettingReadAdapter } from '../workspace/persistence/postgres/pg-workspace-setting-read.adapter';
import { PgWorkspaceReadAdapter } from '../workspace/persistence/postgres/pg-workspace-read.adapter';
import { PgWorkspaceDocumentWriteAdapter } from '../workspace/persistence/postgres/pg-workspace-document-write.adapter';
import { PgWorkspaceDocumentReadAdapter } from '../workspace/persistence/postgres/pg-workspace-document-read.adapter';

@Injectable()
export class IndexingService {
  private readonly batchSize: number;
  private readonly enabled: boolean;
  private readonly indexingTimeoutMs: number;
  private isProcessing = false;

  constructor(
    private readonly documentReadPort: PgWorkspaceDocumentReadAdapter,
    private readonly documentWritePort: PgWorkspaceDocumentWriteAdapter,
    private readonly workspaceReadPort: PgWorkspaceReadAdapter,
    private readonly workspaceSettingReadPort: PgWorkspaceSettingReadAdapter,
    @Inject(forwardRef(() => IndexingClientService))
    private readonly indexingClient: IndexingClientService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    private readonly documentService: DocumentService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    @Optional() private readonly outbox?: IntegrationEventOutboxService,
    @Optional() private readonly featureVisibility?: FeatureVisibilityService,
  ) {
    this.logger.setContext('IndexingService');
    this.batchSize = this.configService.get<number>('indexing.batchSize', 10);
    this.enabled = this.configService.get<boolean>('indexing.enabled', true);
    this.indexingTimeoutMs = this.configService.get<number>('indexing.timeoutMs', 3600000); // 1 hour
  }

  /**
   * Queue a document for indexing and process immediately
   * Called after document upload completes
   */
  async queueDocument(documentId: string, deepSearch?: boolean): Promise<void> {
    if (!this.enabled) {
      this.logger.debug('Indexing disabled, skipping queue', { documentId });
      return;
    }

    const document = await this.documentReadPort.findById(documentId);
    if (!document) {
      this.logger.warn('Cannot queue indexing: document not found', { documentId });
      return;
    }

    const workspaceId = document.workspaceId;

    // Only index completed documents
    if (document.status !== DocumentStatus.COMPLETED) {
      this.logger.debug('Document not completed, skipping indexing', {
        documentId,
        workspaceId,
        status: document.status,
      });
      return;
    }

    // Defense-in-depth: conversation attachments marked CODE_ONLY (heavy or
    // unprobed spreadsheets) must never reach the indexing pipeline, no
    // matter which caller queued them.
    if (document.metadata?.attachmentPolicy === 'CODE_ONLY') {
      this.logger.warn('Blocked indexing of CODE_ONLY conversation attachment', {
        documentId,
        workspaceId,
      });
      return;
    }

    // Reset to pending if needed
    if (document.indexingStatus !== IndexingStatus.PENDING) {
      await this.documentWritePort.updateIndexingState(documentId, {
        indexingStatus: IndexingStatus.PENDING,
        indexingError: undefined,
        indexingTaskName: undefined,
        indexingTaskId: undefined,
        indexingAttemptId: randomUUID(),
        indexingAttemptStartedAt: undefined,
        indexingAttemptCompletedAt: undefined,
      });
    }

    this.logger.debug('Document queued for indexing', {
      documentId,
      workspaceId,
      filename: document.originalName,
    });

    // Process immediately (non-blocking)
    // If it fails, the cron job will retry later
    this.processDocument(documentId, deepSearch).catch((err) => {
      this.logger.warn('Immediate indexing failed, will retry via cron', {
        documentId,
        workspaceId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    });
  }

  /**
   * Process a single document
   * Called by cron job or manually
   */
  async processDocument(documentId: string, deepSearch?: boolean): Promise<void> {
    const record = await this.documentReadPort.findById(documentId);
    if (!record) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    // Same invariant as queueDocument: CODE_ONLY conversation attachments
    // (heavy/unprobed spreadsheets) must never reach the indexing pipeline.
    if (record.metadata?.attachmentPolicy === 'CODE_ONLY') {
      this.logger.warn('Blocked processing of CODE_ONLY conversation attachment', {
        documentId,
        workspaceId: record.workspaceId,
      });
      return;
    }

    // Resolve deep search: explicit param wins, else persisted flag from reindex.
    // The cron does not pass deepSearch, so without this fallback any retry
    // would silently drop the user's deep-search intent.
    const effectiveDeepSearch = deepSearch ?? record.metadata?.deepSearchRequested === 'true';

    const workspaceId = record.workspaceId;

    if (record.indexingStatus === IndexingStatus.PROCESSING) {
      this.logger.debug('Document already processing, skipping', {
        documentId,
        workspaceId,
      });
      throw new BadRequestException(
        ErrorCode.INDEXING_IN_PROGRESS,
        'Document is already being indexed',
      );
    }

    // Mark as processing
    const indexingStartedAt = new Date();
    const processingPatch: IndexingStatePatch = {
      indexingStatus: IndexingStatus.PROCESSING,
      indexingError: undefined,
      indexingTaskName: undefined,
      indexingTaskId: undefined,
      indexingStartedAt,
      indexingAttemptId: record.indexingAttemptId ?? randomUUID(),
      indexingAttemptStartedAt: indexingStartedAt,
      indexingAttemptCompletedAt: undefined,
    };
    await this.documentWritePort.updateIndexingState(documentId, processingPatch);
    const document = { ...record, ...processingPatch };
    await this.recordIndexingEvent(WorkspaceIntegrationEvents.IndexingStartedV1, document);

    // Send notification so frontend sees pending → processing transition
    await this.sendIndexingStatusNotification(document);

    this.logger.debug('Starting document indexing', {
      documentId,
      workspaceId,
      filename: document.originalName,
      mimeType: document.mimeType,
      size: document.size,
    });

    const startTime = Date.now();

    try {
      // Load workspace and settings
      const workspace = await this.workspaceReadPort.findById(document.workspaceId);
      let settings = null;
      if (workspace?.settingsId) {
        settings = await this.workspaceSettingReadPort.findById(workspace.settingsId);
      }

      // Skip indexing for folders
      if (document.isFolder) {
        throw new BadRequestException('Folders cannot be indexed');
      }

      // Canonical S3 object URL (unsigned) — indexing service signs as needed.
      // Still valid after the Ceph migration: document.path was written in the
      // new `{ownerUserId}/{storagePrefix}/{filename}` layout at upload time,
      // and getBlobUrl just prepends the public URL + bucket.
      const blobUrl = this.documentService.getBlobUrl(document.path!);

      // Call indexing API
      const result = await this.indexingClient.indexDocument({
        documentId: document.id,
        workspaceId,
        filename: document.originalName,
        mimeType: document.mimeType,
        path: document.path,
        size: document.size,
        blobUrl,
        // storagePrefix is the immutable Ceph path segment — workspace.name
        // can drift on rename but the file's location can't, so we use the
        // prefix to keep workspace_name aligned with what's actually in Ceph.
        // Fallback for legacy workspaces predating the prefix backfill.
        workspaceName: workspace?.storagePrefix || workspace?.alias || workspaceId,
        // document.filename is the sanitised name actually stored in Ceph
        // (last segment of document.path).
        fileName: document.filename || document.originalName,
        chunkSize: settings?.chunks || 4000,
        enableSmartChunk: settings?.hybridSearch || false,
        oneshotPrompt: settings?.instruction,
        brainTag: settings?.tag,
        user_id: document.createdBy.toString(),
        deepSearch: effectiveDeepSearch,
      });

      // Store API response IDs in metadata, keep status as PROCESSING
      // The webhook callback will set the final status (READY or FAILED)
      await this.documentWritePort.updateIndexingState(documentId, {
        metadata: {
          ...document.metadata,
          download_id: result.download_id,
          indexing_id: result.indexing_id,
        },
        chunk_size: settings?.chunks || 4000,
      });

      this.logger.log('Indexing API call successful, waiting for webhook', {
        documentId,
        workspaceId,
        download_id: result.download_id,
        indexing_id: result.indexing_id,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      const rawError = error instanceof Error ? error.message : 'Unknown error';

      // Store a user-friendly error — never expose raw API details
      const failurePatch: IndexingStatePatch = {
        indexingStatus: IndexingStatus.FAILED,
        indexingError: 'Document indexing failed. Please try again later.',
        indexingAttemptCompletedAt: new Date(),
      };
      await this.documentWritePort.updateIndexingState(documentId, failurePatch);
      await this.recordIndexingEvent(WorkspaceIntegrationEvents.IndexingFailedV1, { ...document, ...failurePatch });

      // Log the full technical error for debugging
      this.logger.error('Document indexing failed', {
        documentId,
        workspaceId,
        error: rawError,
        durationMs: Date.now() - startTime,
      });

      // Send failure notification
      await this.sendIndexingStatusNotification(document);

      throw error;
    }
  }

  private async recordIndexingEvent(eventType: string, document: WorkspaceDocumentRecord): Promise<void> {
    if (!this.outbox || this.featureVisibility?.isEnabled('dataRoomWorkspaceEvents') === false) return;
    await this.outbox.record({ eventId: randomUUID(), eventType, aggregateType: 'workspace_document', aggregateId: document.id, payload: { workspaceId: document.workspaceId, documentId: document.id, createdBy: document.createdBy, documentType: document.type, originalName: document.originalName, mimeType: document.mimeType, sizeBytes: document.size, uploadedAt: document.uploadedAt, updatedAt: document.updatedAt, sourceUrl: document.sourceUrl, normalizedSourceUrl: document.metadata?.normalizedSourceUrl, contentHash: document.contentHash, documentStatus: document.status, indexingStatus: document.indexingStatus, indexingTaskId: document.indexingTaskId, indexingAttemptId: document.indexingAttemptId, deepSearchRequested: document.metadata?.deepSearchRequested === 'true', metadata: document.metadata }, occurredAt: new Date() });
  }

  /**
   * Trigger manual re-index for a document
   */
  async reindexDocument(
    workspaceId: string,
    documentId: string,
    deepSearch?: boolean,
    idempotencyKey?: string,
  ): Promise<WorkspaceDocumentRecord> {
    const record = await this.documentReadPort.findOne({ id: documentId, workspaceId });

    if (!record) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    if (idempotencyKey && record.metadata?.governanceReindexIdempotencyKey === idempotencyKey) {
      return record;
    }

    if (record.status !== DocumentStatus.COMPLETED) {
      throw new BadRequestException(
        ErrorCode.INDEXING_FAILED,
        'Only completed documents can be indexed',
      );
    }

    if (record.indexingStatus === IndexingStatus.PROCESSING) {
      throw new BadRequestException(
        ErrorCode.INDEXING_IN_PROGRESS,
        'Document is already being indexed',
      );
    }


    // Reset to pending for re-indexing
    const reindexPatch: IndexingStatePatch = {
      indexingStatus: IndexingStatus.PENDING,
      indexingError: undefined,
      indexingAttemptId: randomUUID(),
      indexingAttemptStartedAt: undefined,
      indexingAttemptCompletedAt: undefined,
    };
    const { download_id: _downloadId, indexing_id: _indexingId, ...restMetadata } = record.metadata || {};
    reindexPatch.metadata = {
      ...restMetadata,
      deepSearchRequested: deepSearch === true ? 'true' : 'false',
      ...(idempotencyKey ? { governanceReindexIdempotencyKey: idempotencyKey } : {}),
    };
    await this.documentWritePort.updateIndexingState(documentId, reindexPatch);
    const document = { ...record, ...reindexPatch };

    this.logger.debug('Document queued for re-indexing', {
      documentId,
      workspaceId,
    });

    // Optionally process immediately (non-blocking)
    this.processDocument(documentId, deepSearch).catch((err) => {
      this.logger.warn('Immediate re-indexing failed, will retry in cron', {
        documentId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    });

    return document;
  }

  /**
   * Get indexing status for a document
   */
  async getDocumentIndexStatus(
    workspaceId: string,
    documentId: string,
  ): Promise<{
    documentId: string;
    indexingStatus: string;
    indexingError?: string;
    indexingTaskName?: string;
    indexingTaskId?: string;
    lastIndexedAt?: Date;
  }> {
    const document = await this.documentReadPort.findOne({ id: documentId, workspaceId });

    if (!document) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    return {
      documentId: document.id,
      indexingStatus: document.indexingStatus,
      indexingError: document.indexingError,
      lastIndexedAt: document.lastIndexedAt,
    };
  }

  /**
   * Delete document index from vectorstore
   * Called when a document is deleted (non-blocking)
   */
  async deleteDocumentIndex(
    documentId: string,
    workspaceId: string,
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.debug('Indexing disabled, skipping delete', { documentId });
      return;
    }

    this.logger.debug('Deleting document index', {
      documentId,
      workspaceId,
    });

    try {
      // Look up the document + workspace to derive the (workspace_name,
      // file_path, file_name) triple the upstream endpoint needs. All callers
      // (single delete, bulk delete, reindex) invoke us BEFORE removing the
      // document row, so the lookup is guaranteed to find it.
      const document = await this.documentReadPort.findOne({ id: documentId, workspaceId });
      if (!document) {
        this.logger.warn('Document not found for index delete, skipping', {
          documentId,
          workspaceId,
        });
        return;
      }
      const workspace = await this.workspaceReadPort.findById(document.workspaceId);

      const result = await this.indexingClient.deleteIndex({
        documentId,
        workspaceId,
        // storagePrefix is the immutable Ceph segment — workspace.name can
        // drift on rename but the file's location can't. Same fallback chain
        // as indexDocument so identifiers stay aligned across index/delete.
        workspaceName: workspace?.storagePrefix || workspace?.alias || workspaceId,
        filePath: document.path ?? '',
        fileName: document.filename ?? document.originalName,
      });

      if (result.success) {
        this.logger.debug('Document index deleted successfully', {
          documentId,
          workspaceId,
        });
      } else {
        this.logger.warn('Failed to delete document index', {
          documentId,
          workspaceId,
          error: result.error,
        });
      }
    } catch (error) {
      // Log but don't throw - deletion should not block document deletion
      this.logger.error('Error deleting document index', {
        documentId,
        workspaceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Handle webhook callback from indexing API
   * Updates document status and notifies the user
   */
  async handleWebhook(
    documentId: string,
    status: string,
    detectedLanguage?: string,
    details: {
      processingStatus?: string;
      processingTaskName?: string;
      processingTaskId?: string;
      errorMessage?: string;
    } = {},
  ): Promise<void> {
    this.logger.debug('Webhook received', {
      documentId,
      status,
      processingStatus: details.processingStatus,
      processingTaskName: details.processingTaskName,
    });

    const document = await this.documentReadPort.findById(documentId);

    if (!document) {
      this.logger.warn('Webhook received for unknown document', { documentId });
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    const workspaceId = document.workspaceId;
    const previousStatus = document.indexingStatus;

    // Save detected language from webhook
    const patch: IndexingStatePatch = { detected_language: detectedLanguage || 'fr' };

    if (details.processingTaskName) {
      patch.indexingTaskName = details.processingTaskName;
    }
    if (details.processingTaskId) {
      patch.indexingTaskId = details.processingTaskId;
    }

    // Update document status based on webhook
 if (status === 'START' || status === 'PROCESSING' || details.processingStatus === 'PROCESSING') {
      patch.indexingStatus = IndexingStatus.PROCESSING;
      patch.indexingError = undefined;
    } else if (status === 'FINISH') {
      patch.indexingStatus = IndexingStatus.READY;
      patch.lastIndexedAt = new Date();
      patch.indexingAttemptCompletedAt = patch.lastIndexedAt;
      patch.indexingError = undefined;
      patch.indexingTaskName = undefined;
      patch.indexingTaskId = undefined;
    } else {
      patch.indexingStatus = IndexingStatus.FAILED;
      patch.indexingError = details.errorMessage || 'Document indexing failed. Please try again later.';
      patch.indexingAttemptCompletedAt = new Date();
      this.logger.warn('Webhook reported indexing failure', {
        documentId,
        workspaceId,
        rawStatus: status,
        error: patch.indexingError,
      });
    }

    await this.documentWritePort.updateIndexingState(documentId, patch);
    const updatedDocument = { ...document, ...patch };
    await this.recordIndexingEvent(
      updatedDocument.indexingStatus === IndexingStatus.READY
        ? WorkspaceIntegrationEvents.IndexingReadyV1
        : updatedDocument.indexingStatus === IndexingStatus.FAILED
          ? WorkspaceIntegrationEvents.IndexingFailedV1
          : WorkspaceIntegrationEvents.IndexingStartedV1,
      updatedDocument,
    );

    this.logger.log('Webhook processed successfully', {
      documentId,
      workspaceId,
      previousStatus,
      newStatus: updatedDocument.indexingStatus,
    });

    // Send notification to document owner
    await this.sendIndexingStatusNotification(updatedDocument);
  }

  /**
   * Send notification to user about indexing status change
   * Used by processDocument, handleWebhook, and can be called externally
   */
  async sendIndexingStatusNotification(
    document: WorkspaceDocumentRecord,
  ): Promise<void> {
    try {
      const userId = document.createdBy.toString();
      const status = document.indexingStatus;
      const isSuccess = status === IndexingStatus.READY;
      const isFailed = status === IndexingStatus.FAILED;
      const isProcessing = status === IndexingStatus.PROCESSING;

      let type: NotificationType;
      let title: string;
      let message: string;

      if (isSuccess) {
        type = NotificationType.SUCCESS;
        title = 'Document Indexed';
        message = `"${document.originalName}" has been indexed successfully.`;
      } else if (isFailed) {
        type = NotificationType.ERROR;
        title = 'Indexing Failed';
        message = `Failed to index "${document.originalName}". Please try again later.`;
      } else if (isProcessing) {
        type = NotificationType.INFO;
        title = 'Indexing Started';
        message = `"${document.originalName}" is being indexed.`;
      } else {
        // Pending - don't send notification
        return;
      }

      await this.notificationsService.sendToUser(userId, {
        type,
        title,
        message,
        data: {
          eventType: 'indexing_status_change',
          documentId: document.id,
          workspaceId: document.workspaceId,
          indexingStatus: status,
          indexingError: document.indexingError,
          indexingTaskName: document.indexingTaskName,
          indexingTaskId: document.indexingTaskId,
          lastIndexedAt: document.lastIndexedAt?.toISOString(),
          originalName: document.originalName,
          detected_language: document.detected_language,
          chunk_size: document.chunk_size,
        },
        metadata: {
          sourceModule: 'indexing',
        },
      });

      this.logger.debug('Indexing notification sent', {
        userId,
        documentId: document.id,
        status,
      });
    } catch (err) {
      this.logger.warn('Failed to send indexing notification', {
        documentId: document.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  async getCommunityGraphData(workspaceId: string): Promise<unknown> {
    const url = this.configService.get<string>('indexing.communityGraphUrl', 'http://localhost:8000');
    const apiKey = this.configService.get<string>('indexing.communityGraphApiKey', '');
    const params = new URLSearchParams({ workspace_id: workspaceId });
    const res = await fetch(`${url}/api/graph-data?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      throw new Error(`Community graph API returned HTTP ${res.status}`);
    }
    return await res.json() as unknown;
  }

  /**
   * Cron job to process pending documents
   * Runs every 30 seconds by default
   */
  @Cron('*/30 * * * * *')
  async processPendingDocuments(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    // Prevent concurrent processing
    if (this.isProcessing) {
      this.logger.debug('Cron skipped: previous batch still processing');
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;

    try {
      // Find pending documents
      const pendingDocuments = await this.documentReadPort.find(
        { status: DocumentStatus.COMPLETED, indexingStatus: IndexingStatus.PENDING },
        { sort: { field: 'createdAt', direction: 'asc' }, limit: this.batchSize },
      );

      if (pendingDocuments.length === 0) {
        return;
      }

      this.logger.debug('Cron: processing pending documents', {
        count: pendingDocuments.length,
        batchSize: this.batchSize,
      });

      // Process documents sequentially to avoid overwhelming the API
      for (const document of pendingDocuments) {
        try {
          await this.processDocument(document.id);
          successCount++;
        } catch (error) {
          // Error already logged in processDocument
          failCount++;
        }
      }

      this.logger.debug('Cron: finished processing pending documents', {
        total: pendingDocuments.length,
        success: successCount,
        failed: failCount,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error('Cron error: pending documents processing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Timeout stale indexing documents
   * Runs every 10 minutes — marks documents stuck in PROCESSING for over 1 hour as FAILED
   */
  @Cron('0 */10 * * * *')
  async timeoutStaleIndexing(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const cutoff = new Date(Date.now() - this.indexingTimeoutMs);

      const staleDocuments = await this.documentReadPort.find(
        {
          status: DocumentStatus.COMPLETED,
          indexingStatus: IndexingStatus.PROCESSING,
          indexingStartedBefore: cutoff,
        },
        { limit: this.batchSize },
      );

      if (staleDocuments.length === 0) {
        return;
      }

      this.logger.debug('Cron: found stale indexing documents', {
        count: staleDocuments.length,
        timeoutMs: this.indexingTimeoutMs,
      });

      for (const document of staleDocuments) {
        const documentId = document.id;
        const workspaceId = document.workspaceId;

        const timeoutPatch: IndexingStatePatch = {
          indexingStatus: IndexingStatus.FAILED,
          indexingError: 'Indexing timed out. Please try re-indexing the document.',
          indexingAttemptCompletedAt: new Date(),
        };
        await this.documentWritePort.updateIndexingState(documentId, timeoutPatch);
        await this.recordIndexingEvent(WorkspaceIntegrationEvents.IndexingFailedV1, { ...document, ...timeoutPatch });

        this.logger.warn('Document indexing timed out', {
          documentId,
          workspaceId,
          indexingStartedAt: document.indexingStartedAt,
        });

        await this.sendIndexingStatusNotification(document);
      }

      this.logger.debug('Cron: finished timeout check', {
        timedOut: staleDocuments.length,
      });
    } catch (error) {
      this.logger.error('Cron error: stale indexing timeout check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
