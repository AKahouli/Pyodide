import { Inject, BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  WORKSPACE_DOCUMENT_READ_PORT,
  type WorkspaceDocumentReadPort,
  type WorkspaceDocumentRecord,
} from '@modules/workspace/ports';
import {
  BINDING_STORE,
  GOVERNANCE_DOCUMENT_STORE,
  GOVERNANCE_TRANSACTION,
  type GovernanceTransactionRunner,
  type BindingStore,
  type GovernanceDocumentRecord,
  type GovernanceDocumentStore,
  type GovernanceDocumentUpdate,
  type GovernanceDocumentUpdateGuard,
} from '../persistence';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceDocumentEventService } from './governance-document-event.service';
import { DocumentValidityCalculatorService } from './document-validity-calculator.service';
import { DEFAULT_UNKNOWN_VALIDITY, type DocumentValidity } from '../domain/document-validity';
import type { UpdateGovernanceDocumentDto } from '../dto/update-governance-document.dto';

export interface GovernanceDocumentResponse {
  id: string;
  programId: string;
  documentId: string;
  workspaceId: string;
  document: { originalName: string; mimeType: string; type: string; sourceUrl?: string; contentHash?: string; status: string; indexingStatus: string; updatedAt: string };
  governance: { status: string; revision: number; validity: DocumentValidity; tags: string[]; metadata: Record<string, unknown>; ownerUserId?: string; ownerScopeId?: string; archivedAt?: string; archiveReason?: string; createdAt: string; updatedAt: string };
}

@Injectable()
export class GovernanceDocumentService {
  constructor(
    @Inject(GOVERNANCE_DOCUMENT_STORE) private readonly documentStore: GovernanceDocumentStore,
    @Inject(WORKSPACE_DOCUMENT_READ_PORT) private readonly workspaceDocuments: WorkspaceDocumentReadPort,
    @Inject(BINDING_STORE) private readonly bindingStore: BindingStore,
    private readonly programs: GovernanceProgramService,
    private readonly access: GovernanceAccessService,
    private readonly events: GovernanceDocumentEventService,
    private readonly validityCalculator: DocumentValidityCalculatorService,
    @Inject(GOVERNANCE_TRANSACTION) private readonly tx: GovernanceTransactionRunner,
  ) {}

  async upsertFromWorkspace(programId: string, documentId: string, actorId: string, integrationEvent?: { id: string; occurredAt: Date }): Promise<GovernanceDocumentRecord> {
    const document = await this.workspaceDocuments.findOne({ id: documentId, isFolder: false });
    if (!document) throw new NotFoundException(ErrorCode.GOVERNANCE_DOCUMENT_NOT_FOUND);
    const binding = await this.bindingStore.findByProgramAndWorkspace(programId, document.workspaceId);
    if (!binding || !binding.enabled) throw new BadRequestException(ErrorCode.GOVERNANCE_DOCUMENT_SCOPE_INVALID, 'No enabled workspace binding grants governance access to this document');
    const defaults = binding.defaults as { validityMode?: string; reviewFrequencyDays?: number; ownerUserId?: string; ownerScopeId?: string };
    const validity = { ...DEFAULT_UNKNOWN_VALIDITY, mode: defaults.validityMode ?? 'unknown', reviewFrequencyDays: defaults.reviewFrequencyDays };
    return this.tx.run(async () => {
      const governanceDocument = await this.documentStore.upsertFromWorkspace({
        programId,
        documentId: document.id,
        workspaceId: document.workspaceId,
        validity,
        ownerUserId: defaults.ownerUserId,
        ownerScopeId: defaults.ownerScopeId,
        integrationEvent,
      });
      await this.events.append({ programId, governanceDocumentId: governanceDocument.id, documentId, eventType: 'document.governance_created', actorId, actorType: integrationEvent ? 'integration' : 'user', occurredAt: integrationEvent?.occurredAt, deduplicationKey: `created:${governanceDocument.id}` });
      return governanceDocument;
    });
  }

  async list(actorId: string, programId: string, includeArchived = false): Promise<GovernanceDocumentResponse[]> {
    await this.programs.assertOwnedProgram(actorId, programId);
    const workspaceIds = await this.accessibleWorkspaceIds(actorId, programId);
    const records = await this.documentStore.listForProgramWorkspaces(programId, workspaceIds, includeArchived);
    if (records.length === 0) return [];
    // One batched artifact lookup instead of one findOne per governance record.
    const artifacts = await this.workspaceDocuments.find({ ids: [...new Set(records.map((record) => record.documentId))], isFolder: false });
    const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    return Promise.all(records.map((record) => {
      const artifact = byId.get(record.documentId);
      return this.toResponse(record, artifact && artifact.workspaceId === record.workspaceId ? artifact : null);
    }));
  }

  async findByDocumentId(actorId: string, programId: string, documentId: string): Promise<GovernanceDocumentResponse> {
    return this.toResponse(await this.findRecord(actorId, programId, documentId));
  }

  async findRecord(actorId: string, programId: string, documentId: string): Promise<GovernanceDocumentRecord> {
    const record = await this.documentStore.findByProgramAndDocumentId(programId, documentId);
    if (!record) throw new NotFoundException(ErrorCode.GOVERNANCE_DOCUMENT_NOT_FOUND);
    await this.assertBindingAccess(actorId, programId, record.workspaceId);
    return record;
  }

  async update(actorId: string, programId: string, documentId: string, dto: UpdateGovernanceDocumentDto): Promise<GovernanceDocumentResponse> {
    const record = await this.findRecord(actorId, programId, documentId);
    this.assertExpectedRevision(record, dto.expectedGovernanceRevision);
    const updated = await this.documentStore.updateGuarded(record.id, { governanceRevision: dto.expectedGovernanceRevision }, {
      set: {
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.metadata !== undefined ? { metadata: dto.metadata } : {}),
        ...(dto.ownerUserId !== undefined ? { ownerUserId: dto.ownerUserId } : {}),
        ...(dto.ownerScopeId !== undefined ? { ownerScopeId: dto.ownerScopeId } : {}),
      },
      bumpGovernanceRevision: true,
    });
    if (!updated) throw this.concurrentChange();
    return this.toResponse(updated);
  }

  async updateValidity(actorId: string, programId: string, documentId: string, expectedGovernanceRevision: number, patch: Partial<DocumentValidity>): Promise<GovernanceDocumentResponse> {
    const record = await this.findRecord(actorId, programId, documentId);
    this.assertExpectedRevision(record, expectedGovernanceRevision);
    const validity = { ...record.validity, ...patch, evidence: record.validity.evidence ?? [], manuallyOverridden: patch.manuallyOverridden ?? true } as DocumentValidity;
    this.validityCalculator.assertValid(validity);
    const before = record.validity;
    const updated = await this.tx.run(async () => {
      const result = await this.documentStore.updateGuarded(record.id, { governanceRevision: expectedGovernanceRevision }, { set: { validity: validity as unknown as Record<string, unknown> }, bumpGovernanceRevision: true });
      if (!result) throw this.concurrentChange();
      await this.events.append({ programId, governanceDocumentId: result.id, documentId, actorId, eventType: 'validity.updated', before: { validity: before }, after: { validity } });
      return result;
    });
    return this.toResponse(updated);
  }

  async archive(actorId: string, programId: string, documentId: string, expectedGovernanceRevision: number, reason?: string): Promise<GovernanceDocumentResponse> {
    const record = await this.findRecord(actorId, programId, documentId);
    this.assertExpectedRevision(record, expectedGovernanceRevision);
    if (record.status === 'archived') return this.toResponse(record);
    const updated = await this.tx.run(async () => {
      const result = await this.documentStore.updateGuarded(record.id, { governanceRevision: expectedGovernanceRevision, statusNotEquals: 'archived' }, {
        set: { status: 'archived', archivedAt: new Date(), archivedBy: actorId, archiveReason: reason ?? null },
        bumpGovernanceRevision: true,
      });
      if (!result) throw this.concurrentChange();
      await this.events.append({ programId, governanceDocumentId: result.id, documentId, actorId, eventType: 'document.archived', reason, before: { status: record.status }, after: { status: 'archived' } });
      return result;
    });
    return this.toResponse(updated);
  }

  async restore(actorId: string, programId: string, documentId: string, expectedGovernanceRevision: number): Promise<GovernanceDocumentResponse> {
    const record = await this.findRecord(actorId, programId, documentId);
    this.assertExpectedRevision(record, expectedGovernanceRevision);
    if (record.status !== 'archived') return this.toResponse(record);
    const updated = await this.tx.run(async () => {
      const result = await this.documentStore.updateGuarded(record.id, { governanceRevision: expectedGovernanceRevision, statusEquals: 'archived' }, {
        set: { status: 'captured' },
        unset: ['archivedAt', 'archivedBy', 'archiveReason'],
        bumpGovernanceRevision: true,
      });
      if (!result) throw this.concurrentChange();
      await this.events.append({ programId, governanceDocumentId: result.id, documentId, actorId, eventType: 'document.restored', before: { status: 'archived' }, after: { status: 'captured' } });
      return result;
    });
    return this.toResponse(updated);
  }

  async archiveFromWorkspaceDeletion(programId: string, documentId: string, actorId: string, integrationEvent: { id: string; occurredAt: Date }): Promise<void> {
    await this.tx.run(async () => {
      const record = await this.documentStore.archiveFromWorkspaceDeletion(programId, documentId, actorId, integrationEvent);
      if (!record) return;
      await this.events.append({ programId, governanceDocumentId: record.id, documentId, actorId, actorType: 'integration', eventType: 'document.archived', occurredAt: integrationEvent.occurredAt, reason: 'Workspace document deleted', after: { status: 'archived' }, deduplicationKey: `workspace-deleted:${integrationEvent.id}` });
    });
  }

  async deleteGovernance(actorId: string, programId: string, documentId: string, confirm: boolean, expectedGovernanceRevision: number): Promise<void> {
    if (!confirm) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Governance deletion requires explicit confirmation');
    const record = await this.findRecord(actorId, programId, documentId);
    this.assertExpectedRevision(record, expectedGovernanceRevision);
    if (record.status !== 'archived') throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Archive document governance before deletion');
    // Event first (it references the governance row), then the guarded delete, atomically:
    // a lost race rolls the event back.
    await this.tx.run(async () => {
      await this.events.append({ programId, governanceDocumentId: record.id, documentId, actorId, eventType: 'document.governance_deleted' });
      const deleted = await this.documentStore.deleteByIdGuarded(record.id, expectedGovernanceRevision);
      if (!deleted) throw this.concurrentChange();
    });
  }

  private async accessibleWorkspaceIds(actorId: string, programId: string): Promise<string[]> {
    const accessibleScopeIds = await this.access.getAccessibleScopeIds(actorId, programId);
    const bindings = await this.bindingStore.listEnabled(programId, accessibleScopeIds.includes('*') ? '*' : accessibleScopeIds);
    return bindings.map((binding) => binding.workspaceId);
  }

  private async assertBindingAccess(actorId: string, programId: string, workspaceId: string): Promise<void> {
    const allowed = await this.accessibleWorkspaceIds(actorId, programId);
    if (!allowed.includes(workspaceId)) throw new NotFoundException(ErrorCode.GOVERNANCE_DOCUMENT_NOT_FOUND);
  }

  /** `prefetched`: artifact already loaded by a batched lookup (null = known missing). */
  async toResponse(record: GovernanceDocumentRecord, prefetched?: WorkspaceDocumentRecord | null): Promise<GovernanceDocumentResponse> {
    const document = prefetched !== undefined ? prefetched : await this.workspaceDocuments.findOne({ id: record.documentId, workspaceId: record.workspaceId, isFolder: false });
    if (!document) throw new NotFoundException(ErrorCode.GOVERNANCE_DOCUMENT_NOT_FOUND);
    const iso = (value?: Date): string | undefined => value?.toISOString();
    return {
      id: record.id,
      programId: record.programId,
      documentId: record.documentId,
      workspaceId: record.workspaceId,
      document: { originalName: document.originalName, mimeType: document.mimeType, type: document.type, sourceUrl: document.sourceUrl, contentHash: document.contentHash, status: document.status, indexingStatus: document.indexingStatus, updatedAt: iso(document.updatedAt) ?? '' },
      governance: { status: record.status, revision: record.governanceRevision, validity: record.validity as unknown as DocumentValidity, tags: record.tags ?? [], metadata: record.metadata ?? {}, ownerUserId: record.ownerUserId, ownerScopeId: record.ownerScopeId, archivedAt: iso(record.archivedAt), archiveReason: record.archiveReason, createdAt: iso(record.createdAt) ?? '', updatedAt: iso(record.updatedAt) ?? '' },
    };
  }

  private assertExpectedRevision(record: GovernanceDocumentRecord, expected: number): void { if (record.governanceRevision !== expected) throw this.concurrentChange(); }
  private concurrentChange(): ConflictException { return new ConflictException(ErrorCode.VALIDATION_ERROR, 'Document governance changed concurrently; reload and retry'); }
}
