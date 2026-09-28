import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import semanticModelConfig from '@config/semantic-model.config';
import { WorkspaceIntegrationEvents, type WorkspaceDocumentEventV1 } from '@modules/integration-events/contracts';
import { WorkspaceDocumentRead } from '@modules/workspace/document/document-read';
import { IndexingStatus, DocumentStatus } from '@modules/workspace/interfaces/document-status.enum';
import type { DocumentResponse } from '@modules/workspace/interfaces/workspace-document.interface';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelSourceEventHandler } from './semantic-model-source-event.handler';

interface ReconciliationTarget { workspaceId: string; documentId: string; headEventId: string | null }

@Injectable()
export class SemanticModelSourceReconciliationService {
  private running = false;

  constructor(
    @Inject(semanticModelConfig.KEY) private readonly config: ConfigType<typeof semanticModelConfig>,
    private readonly database: SemanticModelDatabaseService,
    private readonly documents: WorkspaceDocumentRead,
    private readonly relay: SemanticModelSourceEventHandler,
  ) {}

  @Interval(300_000)
  async reconcile(): Promise<void> {
    if (this.running || !this.config.runtimeEnabled || !this.config.runtimeWritesEnabled) return;
    this.running = true;
    try {
      const result = await this.database.query<ReconciliationTarget>(`
        SELECT sm.workspace_id AS "workspaceId", sm.document_id AS "documentId",
               head.event_id AS "headEventId"
        FROM semantic_model.source_mappings sm
        LEFT JOIN semantic_jobs.source_heads head
          ON head.workspace_id = sm.workspace_id AND head.asset_id = sm.document_id
        WHERE head.deleted IS DISTINCT FROM true
          -- A workspace mapping stands for many files, not one to reconcile.
          AND sm.scope = 'document'
        GROUP BY sm.workspace_id, sm.document_id, head.event_id, head.last_reconciled_at
        ORDER BY head.last_reconciled_at ASC NULLS FIRST, sm.workspace_id, sm.document_id
        LIMIT 100`);
      for (const target of result.rows) await this.reconcileTarget(target);
    } finally {
      this.running = false;
    }
  }

  private async reconcileTarget(target: ReconciliationTarget): Promise<void> {
    const matches = await this.documents.findByIdsInWorkspace(target.workspaceId, [target.documentId]);
    const document = matches[0];
    const eventType = document ? this.eventType(document) : WorkspaceIntegrationEvents.DocumentDeletedV1;
    const payload = document ? this.payload(document) : {
      workspaceId: target.workspaceId,
      documentId: target.documentId,
      documentType: 'doc' as const,
      originalName: target.documentId,
      mimeType: 'application/octet-stream',
      documentStatus: 'deleted',
      indexingStatus: 'none',
    };
    const occurredAt = new Date(document?.updatedAt ?? Date.now());
    const fingerprint = document
      ? JSON.stringify({ eventType, occurredAt: occurredAt.toISOString(), payload })
      : JSON.stringify({ eventType, workspaceId: target.workspaceId,
        documentId: target.documentId, previousEventId: target.headEventId });
    const eventId = `reconcile:${createHash('sha256').update(fingerprint).digest('hex')}`;
    await this.relay.handle({
      eventId, eventType, aggregateType: 'workspace_document', aggregateId: target.documentId,
      occurredAt, payload: payload as unknown as Record<string, unknown>,
    });
  }

  private eventType(document: DocumentResponse): string {
    if (document.indexingStatus === IndexingStatus.READY) return WorkspaceIntegrationEvents.IndexingReadyV1;
    if (document.indexingStatus === IndexingStatus.FAILED) return WorkspaceIntegrationEvents.IndexingFailedV1;
    if ([IndexingStatus.PENDING, IndexingStatus.PROCESSING].includes(document.indexingStatus)) {
      return WorkspaceIntegrationEvents.IndexingStartedV1;
    }
    return document.status === DocumentStatus.COMPLETED
      ? WorkspaceIntegrationEvents.ArtifactReadyV1
      : WorkspaceIntegrationEvents.DocumentRegisteredV1;
  }

  private payload(document: DocumentResponse): WorkspaceDocumentEventV1 {
    return {
      workspaceId: document.workspaceId, documentId: document.id, createdBy: document.createdBy,
      documentType: document.type, originalName: document.originalName, mimeType: document.mimeType,
      sizeBytes: document.size, uploadedAt: document.uploadedAt, updatedAt: document.updatedAt,
      sourceUrl: document.sourceUrl, contentHash: document.contentHash, storagePath: document.path,
      documentStatus: document.status, indexingStatus: document.indexingStatus,
      indexingTaskId: document.indexingTaskId, folderId: document.parentId, metadata: document.metadata,
    };
  }
}
