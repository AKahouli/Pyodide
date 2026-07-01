import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import {
  WorkspaceDoc,
  WorkspaceDocumentDoc,
  DocumentStatus,
  IndexingStatus,
} from '../workspace/schemas/workspace-document.schema';
import { Workspace, WorkspaceDocument } from '../workspace/schemas/workspace.schema';
import { WorkspaceSetting, WorkspaceSettingDocument } from '../workspace/schemas/workspace-setting.schema';
import { IndexingClientService } from './indexing-client.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { DocumentService } from '../document/document.service';
import { LoggerService } from '../logger';
import {
  NotFoundException,
  BadRequestException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';

@Injectable()
export class IndexingService {
  private readonly batchSize: number;
  private readonly enabled: boolean;
  private readonly indexingTimeoutMs: number;
  private isProcessing = false;

  constructor(
    @InjectModel(WorkspaceDoc.name)
    private readonly documentModel: Model<WorkspaceDocumentDoc>,
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<WorkspaceDocument>,
    @InjectModel(WorkspaceSetting.name)
    private readonly workspaceSettingModel: Model<WorkspaceSettingDocument>,
    @Inject(forwardRef(() => IndexingClientService))
    private readonly indexingClient: IndexingClientService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    private readonly documentService: DocumentService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
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

    const document = await this.documentModel.findById(documentId);
    if (!document) {
      this.logger.warn('Cannot queue indexing: document not found', { documentId });
      return;
    }

    const workspaceId = document.workspaceId.toString();

    // Only index completed documents
    if (document.status !== DocumentStatus.COMPLETED) {
      this.logger.debug('Document not completed, skipping indexing', {
        documentId,
        workspaceId,
        status: document.status,
      });
      return;
    }

    // Reset to pending if needed
    if (document.indexingStatus !== IndexingStatus.PENDING) {
      document.indexingStatus = IndexingStatus.PENDING;
      document.indexingError = undefined;
      document.indexingTaskName = undefined;
      document.indexingTaskId = undefined;
      await document.save();
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
    const document = await this.documentModel.findById(documentId);
    if (!document) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    // Resolve deep search: explicit param wins, else persisted flag from reindex.
    // The cron does not pass deepSearch, so without this fallback any retry
    // would silently drop the user's deep-search intent.
    const effectiveDeepSearch = deepSearch ?? document.metadata?.deepSearchRequested === 'true';

    const workspaceId = document.workspaceId.toString();

    if (document.indexingStatus === IndexingStatus.PROCESSING) {
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
    document.indexingStatus = IndexingStatus.PROCESSING;
    document.indexingError = undefined;
    document.indexingTaskName = undefined;
    document.indexingTaskId = undefined;
    // Clear the persisted flag so a future plain reindex does not inherit it
    if (document.metadata?.deepSearchRequested !== undefined) {
      document.metadata = { ...document.metadata };
      delete document.metadata.deepSearchRequested;
    }
    document.indexingStartedAt = new Date();
    await document.save();

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
      const workspace = await this.workspaceModel.findById(document.workspaceId);
      let settings: WorkspaceSettingDocument | null = null;
      if (workspace?.settings) {
        settings = await this.workspaceSettingModel.findById(workspace.settings);
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
        documentId: document._id.toString(),
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
      document.metadata = {
        ...document.metadata,
        download_id: result.download_id,
        indexing_id: result.indexing_id,
      };
      document.chunk_size = settings?.chunks || 4000;
      await document.save();

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
      document.indexingStatus = IndexingStatus.FAILED;
      document.indexingError = 'Document indexing failed. Please try again later.';
      await document.save();

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

  /**
   * Trigger manual re-index for a document
   */
  async reindexDocument(
    workspaceId: string,
    documentId: string,
    deepSearch?: boolean,
  ): Promise<WorkspaceDocumentDoc> {
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

    if (document.status !== DocumentStatus.COMPLETED) {
      throw new BadRequestException(
        ErrorCode.INDEXING_FAILED,
        'Only completed documents can be indexed',
      );
    }

    if (document.indexingStatus === IndexingStatus.PROCESSING) {
      throw new BadRequestException(
        ErrorCode.INDEXING_IN_PROGRESS,
        'Document is already being indexed',
      );
    }


    // Reset to pending for re-indexing
    document.indexingStatus = IndexingStatus.PENDING;
    document.indexingError = undefined;
    const { download_id, indexing_id, ...restMetadata } = document.metadata || {};
    document.metadata = { ...restMetadata, deepSearchRequested: deepSearch === true ? 'true' : 'false' };
    await document.save();

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

    return {
      documentId: document._id.toString(),
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
      const document = await this.documentModel.findOne({
        _id: documentId,
        workspaceId: new Types.ObjectId(workspaceId),
      });
      if (!document) {
        this.logger.warn('Document not found for index delete, skipping', {
          documentId,
          workspaceId,
        });
        return;
      }
      const workspace = await this.workspaceModel.findById(document.workspaceId);

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

    const document = await this.documentModel.findById(documentId);

    if (!document) {
      this.logger.warn('Webhook received for unknown document', { documentId });
      throw new NotFoundException(
        ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND,
        'Document not found',
      );
    }

    const workspaceId = document.workspaceId.toString();
    const previousStatus = document.indexingStatus;

    // Save detected language from webhook
    document.detected_language = detectedLanguage || 'fr';

    if (details.processingTaskName) {
      document.indexingTaskName = details.processingTaskName;
    }
    if (details.processingTaskId) {
      document.indexingTaskId = details.processingTaskId;
    }

    // Update document status based on webhook
 if (status === 'START' || status === 'PROCESSING' || details.processingStatus === 'PROCESSING') {
      document.indexingStatus = IndexingStatus.PROCESSING;
      document.indexingError = undefined;
    } else if (status === 'FINISH') {
      document.indexingStatus = IndexingStatus.READY;
      document.lastIndexedAt = new Date();
      document.indexingError = undefined;
      document.indexingTaskName = undefined;
      document.indexingTaskId = undefined;
    } else {
      document.indexingStatus = IndexingStatus.FAILED;
      document.indexingError = details.errorMessage || 'Document indexing failed. Please try again later.';
      this.logger.warn('Webhook reported indexing failure', {
        documentId,
        workspaceId,
        rawStatus: status,
        error: document.indexingError,
      });
    }

    await document.save();

    this.logger.log('Webhook processed successfully', {
      documentId,
      workspaceId,
      previousStatus,
      newStatus: document.indexingStatus,
    });

    // Send notification to document owner
    await this.sendIndexingStatusNotification(document);
  }

  /**
   * Send notification to user about indexing status change
   * Used by processDocument, handleWebhook, and can be called externally
   */
  async sendIndexingStatusNotification(
    document: WorkspaceDocumentDoc,
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
          documentId: document._id.toString(),
          workspaceId: document.workspaceId.toString(),
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
        documentId: document._id,
        status,
      });
    } catch (err) {
      this.logger.warn('Failed to send indexing notification', {
        documentId: document._id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  async getCommunityGraphData(workspaceId: string): Promise<unknown> {
    const url = this.configService.get<string>('indexing.communityGraphUrl', 'http://localhost:8000');
    const response = await axios.get(`${url}/api/graph-data`, {
      params: { workspace_id: workspaceId },
      timeout: 30000,
    });
    return response.data;
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
      const pendingDocuments = await this.documentModel
        .find({
          status: DocumentStatus.COMPLETED,
          indexingStatus: IndexingStatus.PENDING,
        })
        .sort({ createdAt: 1 })
        .limit(this.batchSize)
        .exec();

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
          await this.processDocument(document._id.toString());
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

      const staleDocuments = await this.documentModel
        .find({
          status: DocumentStatus.COMPLETED,
          indexingStatus: IndexingStatus.PROCESSING,
          indexingStartedAt: { $lt: cutoff },
        })
        .limit(this.batchSize)
        .exec();

      if (staleDocuments.length === 0) {
        return;
      }

      this.logger.debug('Cron: found stale indexing documents', {
        count: staleDocuments.length,
        timeoutMs: this.indexingTimeoutMs,
      });

      for (const document of staleDocuments) {
        const documentId = document._id.toString();
        const workspaceId = document.workspaceId.toString();

        document.indexingStatus = IndexingStatus.FAILED;
        document.indexingError = 'Indexing timed out. Please try re-indexing the document.';
        await document.save();

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
