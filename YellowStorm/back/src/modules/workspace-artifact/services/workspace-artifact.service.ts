import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AgentService } from '../../agent/agent.service';
import { NotFoundException, ConflictException, BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { DocumentStatus } from '../../workspace/schemas/workspace-document.schema';
import { DECISION_FLOW_LIMITS, DECISION_FLOW_SCHEMA_VERSION } from '../constants/decision-flow.constants';
import { CreateDecisionFlowDto } from '../dto/create-decision-flow.dto';
import { UpdateDecisionFlowDto } from '../dto/update-decision-flow.dto';
import { WorkspaceArtifactQueryDto } from '../dto/workspace-artifact-query.dto';
import type { DecisionFlowPayload } from '../interfaces/decision-flow.interface';
import { DEFAULT_DECISION_FLOW_GENERATION_OPTIONS, DecisionFlowGenerationOptions, WorkspaceArtifactResponse, WorkspaceArtifactStatus, WorkspaceArtifactType } from '../interfaces/workspace-artifact.interface';
import { WorkspaceArtifact, WorkspaceArtifactDocument } from '../schemas/workspace-artifact.schema';
import { DecisionFlowValidatorService } from './decision-flow-validator.service';
import { WorkspaceTransformationSettingsService } from '../../system/workspace-transformation-settings.service';

@Injectable()
export class WorkspaceArtifactService {
  constructor(
    @InjectModel(WorkspaceArtifact.name) private readonly artifacts: Model<WorkspaceArtifactDocument>,
    private readonly documents: WorkspaceDocumentService,
    private readonly transformations: WorkspaceTransformationSettingsService,
    private readonly agents: AgentService,
    private readonly validator: DecisionFlowValidatorService,
  ) {}

  async list(workspaceId: string, query: WorkspaceArtifactQueryDto): Promise<WorkspaceArtifactResponse[]> {
    const filter: Record<string, unknown> = { workspaceId: new Types.ObjectId(workspaceId) };
    if (query.type) filter.type = query.type;
    if (query.status) filter.status = query.status;
    if (query.sourceDocumentId) filter['primarySource.documentId'] = new Types.ObjectId(query.sourceDocumentId);
    if (query.search) filter.name = { $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    return (await this.artifacts.find(filter).sort({ updatedAt: -1 }).lean().exec()).map((artifact) => this.toResponse(artifact));
  }

  async get(workspaceId: string, artifactId: string): Promise<WorkspaceArtifactResponse> {
    return this.toResponse(await this.find(workspaceId, artifactId));
  }

  async getGenerationConfiguration(): Promise<{ configured: boolean }> {
    const settings = await this.transformations.getSettings();
    if (!settings.decisionFlowAgentId) return { configured: false };
    const activeAgents = await this.agents.listActiveDefaultAgentOptions();
    return { configured: activeAgents.some((agent) => agent.id === settings.decisionFlowAgentId) };
  }

  async createDecisionFlow(workspaceId: string, userId: string, dto: CreateDecisionFlowDto): Promise<WorkspaceArtifactResponse> {
    const source = await this.documents.findById(workspaceId, dto.sourceDocumentId);
    if (source.isFolder || source.mimeType !== 'application/pdf') throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_SOURCE_NOT_PDF, 'Decision flows can only be generated from PDF documents');
    if (source.status !== DocumentStatus.COMPLETED || !source.path) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_SOURCE_UNAVAILABLE, 'The source PDF is not available');
    const selection = this.validateSelection(dto.selectionMode, dto.pages);
    const settings = await this.transformations.getSettings();
    if (!settings.decisionFlowAgentId) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_GENERATION_NOT_CONFIGURED, 'Decision-flow generation is not configured');
    await this.agents.assertActiveDefaultAgent(settings.decisionFlowAgentId);
    const name = await this.uniqueName(workspaceId, dto.name?.trim() || `${source.originalName.replace(/\.pdf$/i, '')} decision flow`);
    const artifact = await this.artifacts.create({ workspaceId: new Types.ObjectId(workspaceId), type: WorkspaceArtifactType.DECISION_FLOW, name, status: WorkspaceArtifactStatus.QUEUED, schemaVersion: DECISION_FLOW_SCHEMA_VERSION, revision: 0, primarySource: { documentId: new Types.ObjectId(source.id), documentName: source.originalName, contentHash: source.contentHash, selection }, generationOptions: this.normalizeGenerationOptions(dto.generationOptions), generation: { agentId: new Types.ObjectId(settings.decisionFlowAgentId), requestedBy: new Types.ObjectId(userId), attempts: 0, nextAttemptAt: new Date() }, createdBy: new Types.ObjectId(userId), updatedBy: new Types.ObjectId(userId) });
    return this.toResponse(artifact);
  }

  async update(workspaceId: string, artifactId: string, userId: string, dto: UpdateDecisionFlowDto): Promise<WorkspaceArtifactResponse> {
    const artifact = await this.find(workspaceId, artifactId);
    if (artifact.revision !== dto.expectedRevision) throw new ConflictException(ErrorCode.WORKSPACE_ARTIFACT_REVISION_CONFLICT, 'This decision flow was modified elsewhere');
    const update: Record<string, unknown> = { updatedBy: new Types.ObjectId(userId), $inc: { revision: 1 } };
    if (dto.name !== undefined) update.name = await this.uniqueName(workspaceId, dto.name, artifactId);
    if (dto.description !== undefined) update.description = dto.description;
    if (dto.payload !== undefined) {
      if (artifact.status !== WorkspaceArtifactStatus.READY) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_GENERATION_FAILED, 'Only ready decision flows can be edited');
      update.payload = this.validator.validate(dto.payload);
    }
    const updated = await this.artifacts.findOneAndUpdate({ _id: artifactId, workspaceId: new Types.ObjectId(workspaceId), revision: dto.expectedRevision }, update, { new: true }).exec();
    if (!updated) throw new ConflictException(ErrorCode.WORKSPACE_ARTIFACT_REVISION_CONFLICT, 'This decision flow was modified elsewhere');
    return this.toResponse(updated);
  }

  async clone(workspaceId: string, artifactId: string, userId: string): Promise<WorkspaceArtifactResponse> {
    const artifact = await this.find(workspaceId, artifactId);
    if (artifact.status === WorkspaceArtifactStatus.QUEUED || artifact.status === WorkspaceArtifactStatus.GENERATING || !artifact.payload) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_GENERATION_FAILED, 'Only completed decision flows can be cloned');
    const payload = this.validator.validate(artifact.payload);
    const clone = await this.artifacts.create({ workspaceId: artifact.workspaceId, type: artifact.type, name: await this.uniqueName(workspaceId, `${artifact.name} copy`), description: artifact.description, status: WorkspaceArtifactStatus.READY, schemaVersion: artifact.schemaVersion, revision: 0, primarySource: artifact.primarySource, generationOptions: artifact.generationOptions ?? DEFAULT_DECISION_FLOW_GENERATION_OPTIONS, payload, generation: { agentId: artifact.generation.agentId, requestedBy: new Types.ObjectId(userId), attempts: 0, completedAt: new Date() }, clonedFromArtifactId: artifact._id, createdBy: new Types.ObjectId(userId), updatedBy: new Types.ObjectId(userId) });
    return this.toResponse(clone);
  }

  async retry(workspaceId: string, artifactId: string, userId: string): Promise<WorkspaceArtifactResponse> {
    const artifact = await this.find(workspaceId, artifactId);
    if (artifact.status !== WorkspaceArtifactStatus.FAILED) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_GENERATION_FAILED, 'Only failed decision flows can be retried');
    const settings = await this.transformations.getSettings();
    if (!settings.decisionFlowAgentId) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_GENERATION_NOT_CONFIGURED, 'Decision-flow generation is not configured');
    await this.agents.assertActiveDefaultAgent(settings.decisionFlowAgentId);
    artifact.status = WorkspaceArtifactStatus.QUEUED; artifact.payload = undefined; artifact.generationOptions ??= DEFAULT_DECISION_FLOW_GENERATION_OPTIONS; artifact.generation = { agentId: new Types.ObjectId(settings.decisionFlowAgentId), requestedBy: new Types.ObjectId(userId), attempts: 0, nextAttemptAt: new Date() }; artifact.updatedBy = new Types.ObjectId(userId); await artifact.save();
    return this.toResponse(artifact);
  }

  async delete(workspaceId: string, artifactId: string): Promise<void> {
    const artifact = await this.find(workspaceId, artifactId);
    if (artifact.status === WorkspaceArtifactStatus.QUEUED || artifact.status === WorkspaceArtifactStatus.GENERATING) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_GENERATION_FAILED, 'A queued or generating decision flow cannot be deleted');
    await this.artifacts.deleteOne({ _id: artifact._id }).exec();
  }

  async countBySource(workspaceId: string, documentId: string): Promise<number> { return this.artifacts.countDocuments({ workspaceId: new Types.ObjectId(workspaceId), 'primarySource.documentId': new Types.ObjectId(documentId) }).exec(); }
  async deleteBySource(workspaceId: string, documentId: string): Promise<void> { await this.artifacts.deleteMany({ workspaceId: new Types.ObjectId(workspaceId), 'primarySource.documentId': new Types.ObjectId(documentId) }).exec(); }
  async deleteAllByWorkspace(workspaceId: string): Promise<void> { await this.artifacts.deleteMany({ workspaceId: new Types.ObjectId(workspaceId) }).exec(); }

  private async find(workspaceId: string, artifactId: string): Promise<WorkspaceArtifactDocument> {
    const artifact = await this.artifacts.findOne({ _id: artifactId, workspaceId: new Types.ObjectId(workspaceId) }).exec();
    if (!artifact) throw new NotFoundException(ErrorCode.WORKSPACE_ARTIFACT_NOT_FOUND, 'Workspace artifact not found');
    return artifact;
  }
  private validateSelection(mode: 'all' | 'pages', pages?: number[]): { mode: 'all' } | { mode: 'pages'; pages: number[] } {
    if (mode === 'all') return { mode: 'all' };
    if (!pages?.length || pages.length > DECISION_FLOW_LIMITS.selectedPages || pages.some((page) => !Number.isInteger(page) || page < 1)) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_INVALID_PAGE_SELECTION, 'The selected pages are invalid');
    return { mode: 'pages', pages: [...new Set(pages)].sort((a, b) => a - b) };
  }
  private normalizeGenerationOptions(options: CreateDecisionFlowDto['generationOptions']): DecisionFlowGenerationOptions {
    const defaults: DecisionFlowGenerationOptions = DEFAULT_DECISION_FLOW_GENERATION_OPTIONS;
    if (!options) return defaults;
    const targetAudiences = [...new Set(options.targetAudiences)];
    if (targetAudiences.includes('infer_from_document') && targetAudiences.length > 1) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_INVALID_OUTPUT, 'The inferred audience cannot be combined with explicit audiences');
    if (options.flowType === 'other' && !options.customFlowType?.trim()) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_INVALID_OUTPUT, 'A custom flow type is required');
    return { flowType: options.flowType, customFlowType: options.flowType === 'other' ? options.customFlowType!.trim() : undefined, targetAudiences, detailLevel: options.detailLevel, ambiguityPolicy: options.ambiguityPolicy };
  }
  private async uniqueName(workspaceId: string, requested: string, exceptId?: string): Promise<string> {
    const base = requested.trim().slice(0, 150) || 'Decision flow'; let candidate = base; let index = 1;
    while (await this.artifacts.exists({ workspaceId: new Types.ObjectId(workspaceId), name: candidate, ...(exceptId ? { _id: { $ne: new Types.ObjectId(exceptId) } } : {}) })) { candidate = `${base.slice(0, 140)} _(${index++})`; }
    return candidate;
  }
  private toResponse(artifact: WorkspaceArtifactDocument | Record<string, unknown>): WorkspaceArtifactResponse {
    const item = ('toObject' in artifact ? (artifact as WorkspaceArtifactDocument).toObject() : artifact) as unknown as Record<string, unknown>;
    const source = item.primarySource as { documentId: Types.ObjectId; documentName: string; contentHash?: string; selection: { mode: 'all' } | { mode: 'pages'; pages: number[] } }; const generation = item.generation as { agentId: Types.ObjectId; requestedBy: Types.ObjectId; attempts: number; startedAt?: Date; completedAt?: Date; error?: string };
    return { id: String(item._id), workspaceId: String(item.workspaceId), type: item.type as WorkspaceArtifactType, name: item.name as string, description: item.description as string | undefined, status: item.status as WorkspaceArtifactStatus, schemaVersion: item.schemaVersion as number, revision: item.revision as number, primarySource: { documentId: String(source.documentId), documentName: source.documentName, contentHash: source.contentHash, selection: source.selection }, generationOptions: (item.generationOptions as DecisionFlowGenerationOptions | undefined) ?? this.normalizeGenerationOptions(undefined), payload: item.payload as DecisionFlowPayload | undefined, generation: { agentId: String(generation.agentId), requestedBy: String(generation.requestedBy), attempts: generation.attempts, startedAt: generation.startedAt?.toISOString(), completedAt: generation.completedAt?.toISOString(), error: generation.error }, clonedFromArtifactId: item.clonedFromArtifactId ? String(item.clonedFromArtifactId) : undefined, createdBy: String(item.createdBy), updatedBy: String(item.updatedBy), createdAt: (item.createdAt as Date).toISOString(), updatedAt: (item.updatedAt as Date).toISOString() };
  }
}
