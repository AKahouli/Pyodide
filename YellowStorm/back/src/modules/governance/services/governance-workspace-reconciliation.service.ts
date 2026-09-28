import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {    
  type GovernanceBindingRecord,      
  type GovernanceReconciliationRunRecord,      
} from '../persistence';
import { GovernanceDocumentService } from './governance-document.service';
import { PgWorkspaceDocumentReadAdapter } from '../../workspace/persistence/postgres/pg-workspace-document-read.adapter';
import { PgReconciliationRunStore } from '../persistence/postgres/pg-reconciliation-run.store';
import { PgBindingStore } from '../persistence/postgres/pg-binding.store';
import { PgGovernanceDocumentStore } from '../persistence/postgres/pg-document.store';

export interface GovernanceDocumentReconciliationResult {
  bindingId: string;
  scannedDocuments: number;
  missingGovernanceDocuments: number;
  createdGovernanceDocuments: number;
  staleGovernanceDocuments: number;
  archivedMissingArtifacts: number;
  emittedEvents: number;
  errors: Array<{ documentId?: string; message: string }>;
}

export interface GovernanceReconciliationRunResponse extends Omit<GovernanceReconciliationRunRecord, 'leaseToken' | 'leaseExpiresAt'> {}

const BATCH_SIZE = 100;
const LEASE_MS = 5 * 60 * 1000;

@Injectable()
export class GovernanceWorkspaceReconciliationService {
  constructor(
    private readonly bindingStore: PgBindingStore,
    private readonly workspaceDocuments: PgWorkspaceDocumentReadAdapter,
    private readonly documentStore: PgGovernanceDocumentStore,
    private readonly runStore: PgReconciliationRunStore,
    private readonly documents: GovernanceDocumentService,
  ) {}

  async createRun(bindingId: string, dryRun = true): Promise<GovernanceReconciliationRunResponse> {
    const run = await this.runStore.create({ bindingId, dryRun });
    return this.processRun(run.id);
  }

  async getRun(bindingId: string, runId: string): Promise<GovernanceReconciliationRunResponse> {
    const run = await this.runStore.findByIdAndBinding(bindingId, runId);
    if (!run) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Reconciliation run not found');
    return this.toResponse(run);
  }

  async resumeRun(bindingId: string, runId: string): Promise<GovernanceReconciliationRunResponse> {
    const run = await this.getRun(bindingId, runId);
    return run.status === 'completed' ? run : this.processRun(runId);
  }

  async reconcileBinding(bindingId: string, dryRun = true): Promise<GovernanceDocumentReconciliationResult> {
    const binding = await this.getBinding(bindingId);
    const result = this.empty(bindingId);
    let cursor: string | undefined;
    do {
      const batch = await this.reconcileBatch(binding, dryRun, cursor);
      this.merge(result, batch.result);
      cursor = batch.nextCursor;
    } while (cursor);
    await this.archiveMissing(binding, dryRun, result);
    return result;
  }

  private async processRun(runId: string): Promise<GovernanceReconciliationRunResponse> {
    const now = new Date();
    const claim = await this.runStore.claim(runId, now, LEASE_MS);
    if (!claim) {
      const current = await this.runStore.findById(runId);
      if (!current) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Reconciliation run not found');
      return this.toResponse(current);
    }
    const { run, leaseToken } = claim;
    try {
      const binding = await this.getBinding(run.bindingId);
      const result = this.empty(run.bindingId);
      Object.assign(result, run.stats ?? {});
      result.errors = [...(run.errors ?? [])];
      const savedCursor = run.cursor ?? 'scan:';
      const heartbeat = () => this.renewLease(run.id, leaseToken);
      const checkpoint = (cursor: string) => this.checkpoint(run.id, leaseToken, cursor, result);
      if (savedCursor.startsWith('scan:')) {
        let cursor = savedCursor.slice('scan:'.length) || undefined;
        do {
          const batch = await this.reconcileBatch(binding, run.dryRun, cursor, heartbeat);
          this.merge(result, batch.result);
          cursor = batch.nextCursor;
          await checkpoint(cursor ? `scan:${cursor}` : 'archive:');
        } while (cursor);
      }
      const archiveCursor = savedCursor.startsWith('archive:') ? savedCursor.slice('archive:'.length) || undefined : undefined;
      await this.archiveMissing(binding, run.dryRun, result, archiveCursor, heartbeat, checkpoint);
      const stats = this.stats(result);
      const completed = await this.runStore.completeIfLeased(run.id, leaseToken, stats, result.errors);
      if (!completed) return this.toResponse((await this.runStore.findById(run.id)) ?? run);
      return this.toResponse(completed);
    } catch (error) {
      const errors = [{ message: error instanceof Error ? error.message : 'Reconciliation failed' }];
      const failed = await this.runStore.failIfLeased(run.id, leaseToken, errors);
      if (!failed) return this.toResponse((await this.runStore.findById(run.id)) ?? run);
      return this.toResponse(failed);
    }
  }

  private toResponse(run: GovernanceReconciliationRunRecord): GovernanceReconciliationRunResponse {
    // Lease internals were stripped by the Mongo toJSON transform; keep that contract.
    const { leaseToken, leaseExpiresAt, ...rest } = run;
    void leaseToken;
    void leaseExpiresAt;
    return rest;
  }

  private async reconcileBatch(binding: GovernanceBindingRecord, dryRun: boolean, cursor?: string, heartbeat?: () => Promise<void>): Promise<{ result: GovernanceDocumentReconciliationResult; nextCursor?: string }> {
    const result = this.empty(binding.id);
    const documents = await this.workspaceDocuments.find(
      { workspaceId: binding.workspaceId, isFolder: false, ...(cursor ? { afterId: cursor } : {}) },
      { sort: { field: 'id', direction: 'asc' }, limit: BATCH_SIZE },
    );
    for (let index = 0; index < documents.length; index += 1) {
      if (heartbeat && index % 10 === 0) await heartbeat();
      const document = documents[index];
      result.scannedDocuments += 1;
      const existing = await this.documentStore.findByProgramAndDocumentId(binding.programId, document.id);
      if (!existing) {
        result.missingGovernanceDocuments += 1;
        if (!dryRun && binding.ingestionMode !== 'manual') {
          try {
            await this.documents.upsertFromWorkspace(binding.programId, document.id, binding.createdBy);
            result.createdGovernanceDocuments += 1;
            result.emittedEvents += 1;
          } catch (error) {
            result.errors.push({ documentId: document.id, message: error instanceof Error ? error.message : 'Governance document repair failed' });
          }
        }
      } else if (existing.workspaceId !== document.workspaceId) {
        result.staleGovernanceDocuments += 1;
        if (!dryRun) await this.documentStore.updateGuarded(existing.id, {}, { set: { workspaceId: document.workspaceId }, bumpGovernanceRevision: true });
      }
    }
    return { result, nextCursor: documents.length === BATCH_SIZE ? documents[documents.length - 1].id : undefined };
  }

  private async archiveMissing(binding: GovernanceBindingRecord, dryRun: boolean, result: GovernanceDocumentReconciliationResult, startCursor?: string, heartbeat?: () => Promise<void>, checkpoint?: (cursor: string) => Promise<void>): Promise<void> {
    let cursor = startCursor;
    while (true) {
      const records = await this.documentStore.listByIdCursor(binding.programId, binding.workspaceId, cursor, BATCH_SIZE);
      for (let index = 0; index < records.length; index += 1) {
        if (heartbeat && index % 10 === 0) await heartbeat();
        const record = records[index];
        if (await this.workspaceDocuments.exists({ id: record.documentId, workspaceId: binding.workspaceId, isFolder: false })) continue;
        result.staleGovernanceDocuments += 1;
        if (!dryRun && record.status !== 'archived') {
          const archived = await this.documentStore.updateGuarded(record.id, { governanceRevision: record.governanceRevision, statusNotEquals: 'archived' }, {
            set: { status: 'archived', archivedAt: new Date(), archiveReason: 'Workspace document no longer exists' },
            bumpGovernanceRevision: true,
          });
          result.archivedMissingArtifacts += archived ? 1 : 0;
        }
      }
      if (records.length < BATCH_SIZE) { if (checkpoint && records.length > 0) await checkpoint(`archive:${records[records.length - 1].id}`); return; }
      cursor = records[records.length - 1].id;
      if (checkpoint) await checkpoint(`archive:${cursor}`);
    }
  }

  private async getBinding(id: string): Promise<GovernanceBindingRecord> {
    const binding = await this.bindingStore.findById(id);
    if (!binding) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Workspace binding not found');
    return binding;
  }

  private empty(bindingId: string): GovernanceDocumentReconciliationResult { return { bindingId, scannedDocuments: 0, missingGovernanceDocuments: 0, createdGovernanceDocuments: 0, staleGovernanceDocuments: 0, archivedMissingArtifacts: 0, emittedEvents: 0, errors: [] }; }
  private stats(result: GovernanceDocumentReconciliationResult): Record<string, number> { const { scannedDocuments, missingGovernanceDocuments, createdGovernanceDocuments, staleGovernanceDocuments, archivedMissingArtifacts, emittedEvents } = result; return { scannedDocuments, missingGovernanceDocuments, createdGovernanceDocuments, staleGovernanceDocuments, archivedMissingArtifacts, emittedEvents }; }
  private merge(target: GovernanceDocumentReconciliationResult, addition: GovernanceDocumentReconciliationResult): void { for (const key of ['scannedDocuments', 'missingGovernanceDocuments', 'createdGovernanceDocuments', 'staleGovernanceDocuments', 'archivedMissingArtifacts', 'emittedEvents'] as const) target[key] += addition[key]; target.errors.push(...addition.errors); }

  private async renewLease(runId: string, leaseToken: string): Promise<void> {
    const renewed = await this.runStore.renewLease(runId, leaseToken, LEASE_MS);
    if (!renewed) throw new Error('Reconciliation lease lost');
  }

  private async checkpoint(runId: string, leaseToken: string, cursor: string, result: GovernanceDocumentReconciliationResult): Promise<void> {
    const saved = await this.runStore.checkpoint(runId, leaseToken, cursor, this.stats(result), result.errors, LEASE_MS);
    if (!saved) throw new Error('Reconciliation lease lost');
  }
}
