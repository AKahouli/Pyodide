import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WORKSPACE_DOCUMENT_READ_PORT, type WorkspaceDocumentReadPort } from '@modules/workspace/ports';
import { GovernanceWorkspaceBinding, GovernanceWorkspaceBindingDocument } from '../schemas/governance-workspace-binding.schema';
import { GovernanceDocument, GovernanceDocumentDocument } from '../schemas/governance-document.schema';
import { GovernanceReconciliationRun, GovernanceReconciliationRunDocument } from '../schemas/governance-reconciliation-run.schema';
import { GovernanceDocumentService } from './governance-document.service';

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

const BATCH_SIZE = 100;
const LEASE_MS = 5 * 60 * 1000;

@Injectable()
export class GovernanceWorkspaceReconciliationService {
  constructor(
    @InjectModel(GovernanceWorkspaceBinding.name) private readonly bindings: Model<GovernanceWorkspaceBindingDocument>,
    @Inject(WORKSPACE_DOCUMENT_READ_PORT) private readonly workspaceDocuments: WorkspaceDocumentReadPort,
    @InjectModel(GovernanceDocument.name) private readonly governanceDocuments: Model<GovernanceDocumentDocument>,
    @InjectModel(GovernanceReconciliationRun.name) private readonly runs: Model<GovernanceReconciliationRunDocument>,
    private readonly documents: GovernanceDocumentService,
  ) {}

  async createRun(bindingId: string, dryRun = true): Promise<GovernanceReconciliationRunDocument> {
    const run = await this.runs.create({ bindingId: new Types.ObjectId(bindingId), dryRun, status: 'pending', stats: {}, errors: [] });
    return this.processRun(run._id.toString());
  }

  async getRun(bindingId: string, runId: string): Promise<GovernanceReconciliationRunDocument> {
    const run = await this.runs.findOne({ _id: new Types.ObjectId(runId), bindingId: new Types.ObjectId(bindingId) }).exec();
    if (!run) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Reconciliation run not found');
    return run;
  }

  async resumeRun(bindingId: string, runId: string): Promise<GovernanceReconciliationRunDocument> {
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

  private async processRun(runId: string): Promise<GovernanceReconciliationRunDocument> {
    const now = new Date();
    const leaseToken = randomUUID();
    const run = await this.runs.findOneAndUpdate({ _id: new Types.ObjectId(runId), $or: [{ status: { $in: ['pending', 'failed'] } }, { status: 'running', leaseExpiresAt: { $lt: now } }] }, { $set: { status: 'running', startedAt: now, leaseToken, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) } }, { new: true }).exec();
    if (!run) {
      const current = await this.runs.findById(runId).exec();
      if (!current) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Reconciliation run not found');
      return current;
    }
    try {
      const binding = await this.getBinding(run.bindingId.toString());
      const result = this.empty(run.bindingId.toString());
      Object.assign(result, run.stats ?? {});
      result.errors = [...(run.errors ?? [])];
      const savedCursor = run.cursor ?? 'scan:';
      const heartbeat = () => this.renewLease(run._id, leaseToken);
      const checkpoint = (cursor: string) => this.checkpoint(run._id, leaseToken, cursor, result);
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
      const completion = await this.runs.updateOne({ _id: run._id, leaseToken, status: 'running' }, { $set: { status: 'completed', stats, errors: result.errors, completedAt: new Date() }, $unset: { cursor: '', leaseToken: '', leaseExpiresAt: '' } }).exec();
      if (completion.modifiedCount !== 1) return (await this.runs.findById(run._id).exec()) ?? run;
      run.status = 'completed';
      run.stats = stats;
      run.set('errors', result.errors);
      return run;
    } catch (error) {
      const errors = [{ message: error instanceof Error ? error.message : 'Reconciliation failed' }];
      const failure = await this.runs.updateOne({ _id: run._id, leaseToken }, { $set: { status: 'failed', errors }, $unset: { leaseToken: '', leaseExpiresAt: '' } }).exec();
      if (failure.modifiedCount !== 1) return (await this.runs.findById(run._id).exec()) ?? run;
      run.status = 'failed';
      run.set('errors', errors);
      return run;
    }
  }

  private async reconcileBatch(binding: GovernanceWorkspaceBindingDocument, dryRun: boolean, cursor?: string, heartbeat?: () => Promise<void>): Promise<{ result: GovernanceDocumentReconciliationResult; nextCursor?: string }> {
    const result = this.empty(binding._id.toString());
    const documents = await this.workspaceDocuments.find(
      { workspaceId: binding.workspaceId.toString(), isFolder: false, ...(cursor ? { afterId: cursor } : {}) },
      { sort: { field: 'id', direction: 'asc' }, limit: BATCH_SIZE },
    );
    for (let index = 0; index < documents.length; index += 1) {
      if (heartbeat && index % 10 === 0) await heartbeat();
      const document = documents[index];
      result.scannedDocuments += 1;
      const existing = await this.governanceDocuments.findOne({ programId: binding.programId, documentId: new Types.ObjectId(document.id) }).exec();
      if (!existing) {
        result.missingGovernanceDocuments += 1;
        if (!dryRun && binding.ingestionMode !== 'manual') {
          try {
            await this.documents.upsertFromWorkspace(binding.programId.toString(), document.id, binding.createdBy.toString());
            result.createdGovernanceDocuments += 1;
            result.emittedEvents += 1;
          } catch (error) {
            result.errors.push({ documentId: document.id, message: error instanceof Error ? error.message : 'Governance document repair failed' });
          }
        }
      } else if (!existing.workspaceId.equals(new Types.ObjectId(document.workspaceId))) {
        result.staleGovernanceDocuments += 1;
        if (!dryRun) await this.governanceDocuments.updateOne({ _id: existing._id }, { $set: { workspaceId: new Types.ObjectId(document.workspaceId) }, $inc: { governanceRevision: 1 } }).exec();
      }
    }
    return { result, nextCursor: documents.length === BATCH_SIZE ? documents[documents.length - 1].id : undefined };
  }

  private async archiveMissing(binding: GovernanceWorkspaceBindingDocument, dryRun: boolean, result: GovernanceDocumentReconciliationResult, startCursor?: string, heartbeat?: () => Promise<void>, checkpoint?: (cursor: string) => Promise<void>): Promise<void> {
    let cursor = startCursor ? new Types.ObjectId(startCursor) : undefined;
    while (true) {
      const query: Record<string, unknown> = { programId: binding.programId, workspaceId: binding.workspaceId };
      if (cursor) query._id = { $gt: cursor };
      const records = await this.governanceDocuments.find(query).sort({ _id: 1 }).limit(BATCH_SIZE).exec();
      for (let index = 0; index < records.length; index += 1) {
        if (heartbeat && index % 10 === 0) await heartbeat();
        const record = records[index];
        if (await this.workspaceDocuments.exists({ id: record.documentId.toString(), workspaceId: binding.workspaceId.toString(), isFolder: false })) continue;
        result.staleGovernanceDocuments += 1;
        if (!dryRun && record.status !== 'archived') {
          const archived = await this.governanceDocuments.updateOne({ _id: record._id, governanceRevision: record.governanceRevision, status: { $ne: 'archived' } }, { $set: { status: 'archived', archivedAt: new Date(), archiveReason: 'Workspace document no longer exists' }, $inc: { governanceRevision: 1 } }).exec();
          result.archivedMissingArtifacts += archived.modifiedCount;
        }
      }
      if (records.length < BATCH_SIZE) { if (checkpoint && records.length > 0) await checkpoint(`archive:${records[records.length - 1]._id.toString()}`); return; }
      cursor = records[records.length - 1]._id;
      if (checkpoint) await checkpoint(`archive:${cursor.toString()}`);
    }
  }

  private async getBinding(id: string): Promise<GovernanceWorkspaceBindingDocument> {
    const binding = await this.bindings.findById(id).exec();
    if (!binding) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Workspace binding not found');
    return binding;
  }

  private empty(bindingId: string): GovernanceDocumentReconciliationResult { return { bindingId, scannedDocuments: 0, missingGovernanceDocuments: 0, createdGovernanceDocuments: 0, staleGovernanceDocuments: 0, archivedMissingArtifacts: 0, emittedEvents: 0, errors: [] }; }
  private stats(result: GovernanceDocumentReconciliationResult): Record<string, number> { const { scannedDocuments, missingGovernanceDocuments, createdGovernanceDocuments, staleGovernanceDocuments, archivedMissingArtifacts, emittedEvents } = result; return { scannedDocuments, missingGovernanceDocuments, createdGovernanceDocuments, staleGovernanceDocuments, archivedMissingArtifacts, emittedEvents }; }
  private merge(target: GovernanceDocumentReconciliationResult, addition: GovernanceDocumentReconciliationResult): void { for (const key of ['scannedDocuments', 'missingGovernanceDocuments', 'createdGovernanceDocuments', 'staleGovernanceDocuments', 'archivedMissingArtifacts', 'emittedEvents'] as const) target[key] += addition[key]; target.errors.push(...addition.errors); }

  private async renewLease(runId: Types.ObjectId, leaseToken: string): Promise<void> {
    const result = await this.runs.updateOne({ _id: runId, leaseToken, status: 'running' }, { $set: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } }).exec();
    if (result.modifiedCount !== 1) throw new Error('Reconciliation lease lost');
  }

  private async checkpoint(runId: Types.ObjectId, leaseToken: string, cursor: string, result: GovernanceDocumentReconciliationResult): Promise<void> {
    const update = await this.runs.updateOne({ _id: runId, leaseToken, status: 'running' }, { $set: { cursor, stats: this.stats(result), errors: result.errors, leaseExpiresAt: new Date(Date.now() + LEASE_MS) } }).exec();
    if (update.modifiedCount !== 1) throw new Error('Reconciliation lease lost');
  }
}
