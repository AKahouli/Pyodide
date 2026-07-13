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

export interface ReconciliationResult { bindingId: string; scannedDocuments: number; missingSources: number; missingVersions: number; repairedStatuses: number; missingArtifacts: number; emittedEvents: number; errors: Array<{ documentId?: string; sourceId?: string; message: string }>; }

@Injectable()
export class GovernanceWorkspaceReconciliationService {
  constructor(@InjectModel(GovernanceWorkspaceBinding.name) private readonly bindingModel: Model<GovernanceWorkspaceBindingDocument>, @InjectModel(WorkspaceDoc.name) private readonly documentModel: Model<WorkspaceDocumentDoc>, @InjectModel(GovernanceSource.name) private readonly sourceModel: Model<GovernanceSourceDocument>, @InjectModel(GovernanceSourceVersion.name) private readonly versionModel: Model<GovernanceSourceVersionDocument>, private readonly versions: GovernanceSourceVersionService, private readonly events: GovernanceSourceEventService) {}
  async reconcileBinding(bindingId: string, dryRun = true): Promise<ReconciliationResult> {
    const binding = await this.bindingModel.findById(bindingId).exec();
    if (!binding) throw new NotFoundException(ErrorCode.VALIDATION_ERROR, 'Workspace binding not found');
    const result: ReconciliationResult = { bindingId, scannedDocuments: 0, missingSources: 0, missingVersions: 0, repairedStatuses: 0, missingArtifacts: 0, emittedEvents: 0, errors: [] };
    const documents = await this.documentModel.find({ workspaceId: binding.workspaceId, isFolder: false }).lean().exec();
    const documentIds = new Set(documents.map((document) => document._id.toString()));
    for (const document of documents) {
      result.scannedDocuments += 1;
      const originKey = document.type === 'url' && document.sourceUrl ? `canonical-url:${normalizeWorkspaceUrl(document.sourceUrl)}` : `workspace-document:${binding.workspaceId}:${document._id}`;
      const source = await this.sourceModel.findOne({ programId: binding.programId, originKey }).exec();
      if (!source) { result.missingSources += 1; if (dryRun || binding.ingestionMode === 'manual') continue; try { const created = await this.sourceModel.create({ programId: binding.programId, scopeIds: binding.scopeIds, visibility: binding.visibility, title: document.originalName, sourceType: document.type === 'url' ? 'web_page' : 'pdf', url: document.sourceUrl, workspaceId: binding.workspaceId, documentId: document._id, originKey, createdBy: binding.createdBy }); await this.versions.create(binding.createdBy.toString(), binding.programId.toString(), created._id.toString(), { workspaceId: binding.workspaceId.toString(), documentId: document._id.toString(), canonicalUrl: document.sourceUrl, contentHash: document.contentHash }); result.missingVersions += 1; } catch (error) { result.errors.push({ documentId: document._id.toString(), message: error instanceof Error ? error.message : 'Source repair failed' }); } continue; }
      const version = await this.versionModel.findOne({ sourceId: source._id, documentId: document._id }).sort({ versionNumber: -1 }).exec();
      if (!version) { result.missingVersions += 1; if (!dryRun && binding.ingestionMode !== 'manual') await this.versions.create(binding.createdBy.toString(), binding.programId.toString(), source._id.toString(), { workspaceId: binding.workspaceId.toString(), documentId: document._id.toString(), canonicalUrl: document.sourceUrl, contentHash: document.contentHash }); continue; }
      const status = document.indexingStatus === 'ready' ? 'ready' : document.indexingStatus === 'failed' ? 'failed' : document.indexingStatus === 'processing' ? 'processing' : 'pending';
      if (version.technicalStatus !== status) { result.repairedStatuses += 1; if (!dryRun) await this.versions.updateTechnicalStatus(binding.programId.toString(), source._id.toString(), version._id.toString(), status); }
    }
    const versions = await this.versionModel.find({ programId: binding.programId, workspaceId: binding.workspaceId, documentId: { $exists: true } }).exec();
    for (const version of versions) {
      if (!version.documentId || documentIds.has(version.documentId.toString())) continue;
      result.missingArtifacts += 1;
      if (dryRun || version.extractedMetadata.artifactAvailable === false) continue;
      version.extractedMetadata = { ...version.extractedMetadata, artifactAvailable: false };
      await version.save();
      await this.events.append({ programId: binding.programId.toString(), sourceId: version.sourceId.toString(), versionId: version._id.toString(), eventType: 'artifact.unavailable', metadata: { reconciliation: true } });
    }
    return result;
  }
}
