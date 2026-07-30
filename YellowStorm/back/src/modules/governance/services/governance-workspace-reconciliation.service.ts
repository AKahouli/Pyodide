import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WorkspaceDoc, WorkspaceDocumentDoc } from '@modules/workspace/schemas/workspace-document.schema';
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
    @InjectModel(WorkspaceDoc.name) private readonly workspaceDocuments: Model<WorkspaceDocumentDoc>,
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
      const result = await this.reconcileBinding(run.bindingId.toString(), run.dryRun);
      const stats = this.stats(result);
      await this.runs.updateOne({ _id: run._id, leaseToken }, { $set: { status: 'completed', stats, errors: result.errors, completedAt: new Date() }, $unset: { cursor: '', leaseToken: '', leaseExpiresAt: '' } }).exec();
      run.status = 'completed';
      run.stats = stats;
      run.set('errors', result.errors);
      return run;
    } catch (error) {
      const errors = [{ message: error instanceof Error ? error.message : 'Reconciliation failed' }];
      await this.runs.updateOne({ _id: run._id, leaseToken }, { $set: { status: 'failed', errors }, $unset: { leaseToken: '', leaseExpiresAt: '' } }).exec();
      run.status = 'failed';
      run.set('errors', errors);
      return run;
    }
  }

  private async reconcileBatch(binding: GovernanceWorkspaceBindingDocument, dryRun: boolean, cursor?: string): Promise<{ result: GovernanceDocumentReconciliationResult; nextCursor?: string }> {
    const result = this.empty(binding._id.toString());
    const query: Record<string, unknown> = { workspaceId: binding.workspaceId, isFolder: false };
    if (cursor) query._id = { $gt: new Types.ObjectId(cursor) };
    const documents = await this.workspaceDocuments.find(query).sort({ _id: 1 }).limit(BATCH_SIZE).lean().exec();
    for (const document of documents) {
      result.scannedDocuments += 1;
      const existing = await this.governanceDocuments.findOne({ programId: binding.programId, documentId: document._id }).exec();
      if (!existing) {
        result.missingGovernanceDocuments += 1;
        if (!dryRun && binding.ingestionMode !== 'manual') {
          try {
            await this.documents.upsertFromWorkspace(binding.programId.toString(), document._id.toString(), binding.createdBy.toString());
            result.createdGovernanceDocuments += 1;
            result.emittedEvents += 1;
          } catch (error) {
            result.errors.push({ documentId: document._id.toString(), message: error instanceof Error ? error.message : 'Governance document repair failed' });
          }
        }
      } else if (!existing.workspaceId.equals(document.workspaceId)) {
        result.staleGovernanceDocuments += 1;
        if (!dryRun) await this.governanceDocuments.updateOne({ _id: existing._id }, { $set: { workspaceId: document.workspaceId }, $inc: { governanceRevision: 1 } }).exec();
      }
    }
    return { result, nextCursor: documents.length === BATCH_SIZE ? documents[documents.length - 1]._id.toString() : undefined };
  }

  private async archiveMissing(binding: GovernanceWorkspaceBindingDocument, dryRun: boolean, result: GovernanceDocumentReconciliationResult): Promise<void> {
    let cursor: Types.ObjectId | undefined;
    while (true) {
      const query: Record<string, unknown> = { programId: binding.programId, workspaceId: binding.workspaceId };
      if (cursor) query._id = { $gt: cursor };
      const records = await this.governanceDocuments.find(query).sort({ _id: 1 }).limit(BATCH_SIZE).exec();
      for (const record of records) {
        if (await this.workspaceDocuments.exists({ _id: record.documentId, workspaceId: binding.workspaceId, isFolder: false })) continue;
        result.staleGovernanceDocuments += 1;
        if (!dryRun && record.status !== 'archived') {
          record.status = 'archived';
          record.archivedAt = new Date();
          record.archiveReason = 'Workspace document no longer exists';
          record.governanceRevision += 1;
          await record.save();
          result.archivedMissingArtifacts += 1;
        }
      }
      if (records.length < BATCH_SIZE) return;
      cursor = records[records.length - 1]._id;
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
}
