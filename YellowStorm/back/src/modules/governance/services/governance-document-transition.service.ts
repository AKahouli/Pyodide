import { Inject, BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { DocumentStatus, IndexingStatus } from '@modules/workspace/interfaces/document-status.enum';
import { WORKSPACE_DOCUMENT_READ_PORT, type WorkspaceDocumentReadPort } from '@modules/workspace/ports';
import { GOVERNANCE_DOCUMENT_STORE, type GovernanceDocumentRecord, type GovernanceDocumentStore, type GovernanceDocumentUpdateSet, GOVERNANCE_TRANSACTION, PASSTHROUGH_TRANSACTION, type GovernanceTransactionRunner } from '../persistence';
import type { GovernanceDocumentLifecycleStatus } from '../domain/governance-types';
import { GovernanceDocumentService } from './governance-document.service';
import { GovernanceDocumentEventService } from './governance-document-event.service';

const transitions: Record<GovernanceDocumentLifecycleStatus, GovernanceDocumentLifecycleStatus[]> = {
  captured: ['to_review', 'rejected'],
  to_review: ['approved', 'rejected', 'captured'],
  approved: ['published', 'rejected'],
  published: [],
  rejected: [],
  archived: [],
};

export interface GovernanceDocumentTransitionCommand { commandId: string; expectedGovernanceRevision: number; actorId: string; actorEmail?: string; programId: string; documentId: string; target: GovernanceDocumentLifecycleStatus; comment?: string; correlationId?: string }

@Injectable()
export class GovernanceDocumentTransitionService {
  constructor(
    @Inject(GOVERNANCE_DOCUMENT_STORE) private readonly documentStore: GovernanceDocumentStore,
    @Inject(WORKSPACE_DOCUMENT_READ_PORT) private readonly workspaceDocuments: WorkspaceDocumentReadPort,
    private readonly documents: GovernanceDocumentService,
    private readonly events: GovernanceDocumentEventService,
    @Inject(GOVERNANCE_TRANSACTION) private readonly tx: GovernanceTransactionRunner = PASSTHROUGH_TRANSACTION,
  ) {}

  async transition(command: GovernanceDocumentTransitionCommand): Promise<GovernanceDocumentRecord> {
    const record = await this.documents.findRecord(command.actorId, command.programId, command.documentId);
    const key = `transition:${command.commandId}`;
    if (await this.events.findByDeduplicationKey(record.id, key)) return record;
    if (record.governanceRevision !== command.expectedGovernanceRevision) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Document governance changed concurrently; reload and retry');
    if (!transitions[record.status].includes(command.target)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid document governance lifecycle transition');
    if (command.target === 'published') await this.assertPublishable(record);
    const before = record.status;
    const now = new Date();
    const set: GovernanceDocumentUpdateSet = { status: command.target, ...(command.comment !== undefined ? { reviewComment: command.comment } : {}) };
    if (command.target === 'to_review') Object.assign(set, { submittedForReviewBy: command.actorId, submittedForReviewAt: now });
    if (command.target === 'approved') Object.assign(set, { reviewedBy: command.actorId, reviewedAt: now, approvedBy: command.actorId, approvedAt: now });
    if (command.target === 'published') Object.assign(set, { publishedBy: command.actorId, publishedAt: now });
    // Status change and its lifecycle event commit atomically.
    const updatedRecord = await this.tx.run(async () => {
      const result = await this.documentStore.updateGuarded(record.id, { governanceRevision: command.expectedGovernanceRevision, statusEquals: before }, { set, bumpGovernanceRevision: true });
      if (!result) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Document governance changed concurrently; reload and retry');
      const eventType = ({ to_review: 'document.submitted_for_review', captured: 'document.returned_to_editing', approved: 'document.approved', rejected: 'document.rejected', published: 'document.published' } as const)[command.target as Exclude<GovernanceDocumentLifecycleStatus, 'archived'>];
      if (!eventType) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Unsupported document governance lifecycle transition');
      await this.events.append({ programId: command.programId, governanceDocumentId: result.id, documentId: command.documentId, actorId: command.actorId, actorEmail: command.actorEmail, actorType: 'user', eventType, before: { status: before }, after: { status: command.target }, reason: command.comment, correlationId: command.correlationId, deduplicationKey: key });
      return result;
    });
    return updatedRecord;
  }

  private async assertPublishable(record: GovernanceDocumentRecord): Promise<void> {
    const document = await this.workspaceDocuments.findOne({ id: record.documentId, workspaceId: record.workspaceId, isFolder: false });
    if (!document || document.status !== DocumentStatus.COMPLETED || document.indexingStatus !== IndexingStatus.READY) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Document must be completed and indexed before publication');
    const businessStatus = (record.validity as { businessStatus?: string }).businessStatus;
    if (['expired', 'conflicting', 'suspended'].includes(businessStatus ?? '')) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Document validity blocks publication');
  }
}
