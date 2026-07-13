import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceWorkspaceBinding, GovernanceWorkspaceBindingDocument } from '../schemas/governance-workspace-binding.schema';
import { GovernanceSource, GovernanceSourceDocument } from '../schemas/governance-source.schema';
import { GovernanceSourceVersion, GovernanceSourceVersionDocument } from '../schemas/governance-source-version.schema';
import { WorkspaceDoc, WorkspaceDocumentDoc } from '@modules/workspace/schemas/workspace-document.schema';
import { GovernanceSourceVersionService } from './governance-source-version.service';
import { GovernanceSourceEventService } from './governance-source-event.service';
import { normalizeWorkspaceUrl } from '@modules/workspace/services/url-normalization';
import { GovernanceSourceFromWorkspaceFactory } from '../factories/governance-source-from-workspace.factory';
import { GovernanceReconciliationRun, GovernanceReconciliationRunDocument } from '../schemas/governance-reconciliation-run.schema';
import { randomUUID } from 'crypto';

export interface ReconciliationResult { bindingId: string; scannedDocuments: number; missingSources: number; missingVersions: number; repairedStatuses: number; missingArtifacts: number; emittedEvents: number; errors: Array<{ documentId?: string; sourceId?: string; message: string }>; }
const RECONCILIATION_BATCH_SIZE = 100;
const RECONCILIATION_RUN_LEASE_MS = 5 * 60 * 1000;

@Injectable()
export class GovernanceWorkspaceReconciliationService {
  constructor(@InjectModel(GovernanceWorkspaceBinding.name) private readonly bindingModel: Model<GovernanceWorkspaceBindingDocument>, @InjectModel(WorkspaceDoc.name) private readonly documentModel: Model<WorkspaceDocumentDoc>, @InjectModel(GovernanceSource.name) private readonly sourceModel: Model<GovernanceSourceDocument>, @InjectModel(GovernanceSourceVersion.name) private readonly versionModel: Model<GovernanceSourceVersionDocument>, @InjectModel(GovernanceReconciliationRun.name) private readonly runModel: Model<GovernanceReconciliationRunDocument>, private readonly versions: GovernanceSourceVersionService, private readonly events: GovernanceSourceEventService, private readonly sourceFactory: GovernanceSourceFromWorkspaceFactory) {}
  async createRun(bindingId: string, dryRun = true): Promise<GovernanceReconciliationRunDocument> { const run = await this.runModel.create({ bindingId: new Types.ObjectId(bindingId), dryRun, status: 'pending', stats: {}, errors: [] }); return this.processRun(run._id.toString()); }
  async getRun(bindingId: string, runId: string): Promise<GovernanceReconciliationRunDocument> { const run = await this.runModel.findOne({ _id: new Types.ObjectId(runId), bindingId: new Types.ObjectId(bindingId) }).exec(); if (!run) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Reconciliation run not found'); return run; }
  async resumeRun(bindingId: string, runId: string): Promise<GovernanceReconciliationRunDocument> { const run = await this.getRun(bindingId, runId); if (run.status === 'completed') return run; return this.processRun(runId); }
  private async processRun(runId: string): Promise<GovernanceReconciliationRunDocument> { const now = new Date(); const leaseToken = randomUUID(); const run = await this.runModel.findOneAndUpdate({ _id: new Types.ObjectId(runId), $or: [{ status: { $in: ['pending', 'failed'] } }, { status: 'running', leaseExpiresAt: { $lt: now } }, { status: 'running', leaseExpiresAt: { $exists: false }, updatedAt: { $lt: new Date(now.getTime() - RECONCILIATION_RUN_LEASE_MS) } }] }, { $set: { status: 'running', startedAt: now, leaseToken, leaseExpiresAt: new Date(now.getTime() + RECONCILIATION_RUN_LEASE_MS) } }, { new: true }).exec(); if (!run) return this.runModel.findById(runId).exec().then((current) => { if (!current) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Reconciliation run not found'); return current; }); const binding = await this.getBinding(run.bindingId.toString()); const heartbeat = () => this.renewLease(run._id, leaseToken); try { const total = this.result(run.bindingId.toString(), run.stats); let cursor = run.cursor; while (true) { const batch = await this.reconcileDocuments(binding, run.dryRun, cursor, true, heartbeat); this.merge(total, batch.result); cursor = batch.nextCursor; await this.persistProgress(run, leaseToken, total, cursor); if (!cursor) break; } await this.reconcileMissingArtifacts(binding, run.dryRun, total, heartbeat); await this.completeRun(run, leaseToken, total); return run; } catch (error) { return this.failRun(run, leaseToken, error); } }
  private async renewLease(runId: Types.ObjectId, leaseToken: string): Promise<void> { const result = await this.runModel.updateOne({ _id: runId, status: 'running', leaseToken }, { $set: { leaseExpiresAt: new Date(Date.now() + RECONCILIATION_RUN_LEASE_MS) } }).exec(); if (result.modifiedCount !== 1) throw new Error('Reconciliation run lease was lost'); }
  private async persistProgress(run: GovernanceReconciliationRunDocument, leaseToken: string, total: ReconciliationResult, cursor?: string): Promise<void> { const stats = this.stats(total); const result = await this.runModel.updateOne({ _id: run._id, status: 'running', leaseToken }, { $set: { stats, cursor, errors: total.errors } }).exec(); if (result.modifiedCount !== 1) throw new Error('Reconciliation run lease was lost'); run.stats = stats; run.cursor = cursor; run.set('errors', total.errors); }
  private async completeRun(run: GovernanceReconciliationRunDocument, leaseToken: string, total: ReconciliationResult): Promise<void> { const stats = this.stats(total); const completedAt = new Date(); const result = await this.runModel.updateOne({ _id: run._id, status: 'running', leaseToken }, { $set: { status: 'completed', stats, errors: total.errors, completedAt }, $unset: { cursor: '', leaseToken: '', leaseExpiresAt: '' } }).exec(); if (result.modifiedCount !== 1) throw new Error('Reconciliation run lease was lost'); run.status = 'completed'; run.stats = stats; run.completedAt = completedAt; run.cursor = undefined; run.set('errors', total.errors); }
  private async failRun(run: GovernanceReconciliationRunDocument, leaseToken: string, error: unknown): Promise<GovernanceReconciliationRunDocument> { const errors = [{ message: error instanceof Error ? error.message : 'Reconciliation failed' }]; const result = await this.runModel.updateOne({ _id: run._id, status: 'running', leaseToken }, { $set: { status: 'failed', errors }, $unset: { leaseToken: '', leaseExpiresAt: '' } }).exec(); if (result.modifiedCount === 1) { run.status = 'failed'; run.set('errors', errors); return run; } return this.runModel.findById(run._id).exec().then((current) => { if (!current) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Reconciliation run not found'); return current; }); }
  async reconcileBinding(bindingId: string, dryRun = true): Promise<ReconciliationResult> {
    const binding = await this.getBinding(bindingId);
    const result = this.result(bindingId);
    let cursor: string | undefined;
    while (true) { const batch = await this.reconcileDocuments(binding, dryRun, cursor); this.merge(result, batch.result); cursor = batch.nextCursor; if (!cursor) break; }
    await this.reconcileMissingArtifacts(binding, dryRun, result);
    return result;
  }
  private async getBinding(bindingId: string): Promise<GovernanceWorkspaceBindingDocument> { const binding = await this.bindingModel.findById(bindingId).exec(); if (!binding) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Workspace binding not found'); return binding; }
  private result(bindingId: string, stats: Record<string, number> = {}): ReconciliationResult { return { bindingId, scannedDocuments: stats.scannedDocuments ?? 0, missingSources: stats.missingSources ?? 0, missingVersions: stats.missingVersions ?? 0, repairedStatuses: stats.repairedStatuses ?? 0, missingArtifacts: stats.missingArtifacts ?? 0, emittedEvents: stats.emittedEvents ?? 0, errors: [] }; }
  private stats(result: ReconciliationResult): Record<string, number> { const { scannedDocuments, missingSources, missingVersions, repairedStatuses, missingArtifacts, emittedEvents } = result; return { scannedDocuments, missingSources, missingVersions, repairedStatuses, missingArtifacts, emittedEvents }; }
  private merge(target: ReconciliationResult, addition: ReconciliationResult): void { for (const key of ['scannedDocuments', 'missingSources', 'missingVersions', 'repairedStatuses', 'missingArtifacts', 'emittedEvents'] as const) target[key] += addition[key]; target.errors.push(...addition.errors); }
  private async reconcileDocuments(binding: GovernanceWorkspaceBindingDocument, dryRun: boolean, cursor?: string, paginated = true, heartbeat?: () => Promise<unknown>): Promise<{ result: ReconciliationResult; nextCursor?: string }> {
    const result = this.result(binding._id.toString());
    const query: Record<string, unknown> = { workspaceId: binding.workspaceId, isFolder: false };
    if (cursor) query._id = { $gt: new Types.ObjectId(cursor) };
    let documentsQuery = this.documentModel.find(query).sort({ _id: 1 });
    if (paginated) documentsQuery = documentsQuery.limit(RECONCILIATION_BATCH_SIZE);
    const documents = await documentsQuery.lean().exec();
    for (const document of documents) {
      await heartbeat?.();
      result.scannedDocuments += 1;
      const sourceCommand = this.sourceFactory.build(binding, { workspaceId: binding.workspaceId.toString(), documentId: document._id.toString(), documentType: document.type, originalName: document.originalName, sourceUrl: document.sourceUrl, normalizedSourceUrl: document.sourceUrl ? normalizeWorkspaceUrl(document.sourceUrl) : undefined, contentHash: document.contentHash });
      const source = await this.sourceModel.findOne({ programId: binding.programId, originKey: sourceCommand.originKey }).exec();
      if (!source) { result.missingSources += 1; if (dryRun || binding.ingestionMode === 'manual') continue; try { const created = await this.sourceModel.create(sourceCommand.source); await this.versions.create(binding.createdBy.toString(), binding.programId.toString(), created._id.toString(), sourceCommand.version); result.missingVersions += 1; } catch (error) { result.errors.push({ documentId: document._id.toString(), message: error instanceof Error ? error.message : 'Source repair failed' }); } continue; }
      if (source.isArchived) continue;
      const version = await this.versionModel.findOne({ sourceId: source._id, documentId: document._id }).sort({ versionNumber: -1 }).exec();
      if (!version) { result.missingVersions += 1; if (!dryRun && binding.ingestionMode !== 'manual') await this.versions.create(binding.createdBy.toString(), binding.programId.toString(), source._id.toString(), sourceCommand.version); continue; }
      const status = document.indexingStatus === 'ready' ? 'ready' : document.indexingStatus === 'failed' ? 'failed' : document.indexingStatus === 'processing' ? 'processing' : 'pending';
      if (version.technicalStatus !== status) { result.repairedStatuses += 1; if (!dryRun) await this.versions.updateTechnicalStatus(binding.programId.toString(), source._id.toString(), version._id.toString(), status, undefined, new Date(), document.indexingAttemptId); }
    }
    return { result, nextCursor: paginated && documents.length === RECONCILIATION_BATCH_SIZE ? documents[documents.length - 1]._id.toString() : undefined };
  }
  private async reconcileMissingArtifacts(binding: GovernanceWorkspaceBindingDocument, dryRun: boolean, result: ReconciliationResult, heartbeat?: () => Promise<unknown>): Promise<void> {
    let cursor: Types.ObjectId | undefined;
    while (true) {
      const query: Record<string, unknown> = { programId: binding.programId, workspaceId: binding.workspaceId, documentId: { $exists: true } };
      if (cursor) query._id = { $gt: cursor };
      const versions = await this.versionModel.find(query).sort({ _id: 1 }).limit(RECONCILIATION_BATCH_SIZE).exec();
      for (const version of versions) {
      await heartbeat?.();
      if (!version.documentId || await this.documentModel.exists({ _id: version.documentId, workspaceId: binding.workspaceId, isFolder: false }).exec()) continue;
      result.missingArtifacts += 1;
      if (dryRun || version.extractedMetadata.artifactAvailable === false) continue;
      version.extractedMetadata = { ...version.extractedMetadata, artifactAvailable: false };
      await version.save();
      await this.events.append({ programId: binding.programId.toString(), sourceId: version.sourceId.toString(), versionId: version._id.toString(), eventType: 'artifact.unavailable', metadata: { reconciliation: true } });
    }
      if (versions.length < RECONCILIATION_BATCH_SIZE) return;
      cursor = versions[versions.length - 1]._id;
    }
  }
}
