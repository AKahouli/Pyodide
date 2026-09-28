import { Inject, Injectable } from '@nestjs/common';
import { AgentService } from '../../agent/agent.service';
import { NotFoundException, ConflictException, BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { DocumentStatus } from '../../workspace/interfaces/document-status.enum';
import { DECISION_FLOW_LIMITS, DECISION_FLOW_SCHEMA_VERSION } from '../constants/decision-flow.constants';
import { CreateDecisionFlowDto } from '../dto/create-decision-flow.dto';
import { UpdateDecisionFlowDto } from '../dto/update-decision-flow.dto';
import { WorkspaceArtifactQueryDto } from '../dto/workspace-artifact-query.dto';
import type { DecisionFlowPayload } from '../interfaces/decision-flow.interface';
import { DEFAULT_DECISION_FLOW_GENERATION_OPTIONS, DecisionFlowGenerationOptions, WorkspaceArtifactResponse, WorkspaceArtifactStatus, WorkspaceArtifactType } from '../interfaces/workspace-artifact.interface';
import { type WorkspaceArtifactRecord } from '../persistence/workspace-artifact-store';
import { PostgresWorkspaceArtifactStore } from '../persistence/postgres/postgres-workspace-artifact-store';
import { DecisionFlowValidatorService } from './decision-flow-validator.service';
import { WorkspaceTransformationSettingsService } from '../../system/workspace-transformation-settings.service';

@Injectable()
export class WorkspaceArtifactService {
  constructor(
    private readonly artifacts: PostgresWorkspaceArtifactStore,
    private readonly documents: WorkspaceDocumentService,
    private readonly transformations: WorkspaceTransformationSettingsService,
    private readonly agents: AgentService,
    private readonly validator: DecisionFlowValidatorService,
  ) {}

  async list(workspaceId: string, query: WorkspaceArtifactQueryDto): Promise<WorkspaceArtifactResponse[]> {
    const rows = await this.artifacts.list(workspaceId, {
      type: query.type,
      status: query.status,
      sourceDocumentId: query.sourceDocumentId,
      search: query.search,
    });
    return rows.map((artifact) => this.toResponse(artifact));
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
    const artifact = await this.artifacts.create({
      workspaceId,
      type: WorkspaceArtifactType.DECISION_FLOW,
      name,
      status: WorkspaceArtifactStatus.QUEUED,
      schemaVersion: DECISION_FLOW_SCHEMA_VERSION,
      primarySource: { documentId: source.id, documentName: source.originalName, contentHash: source.contentHash, selection },
      generationOptions: this.normalizeGenerationOptions(dto.generationOptions),
      generation: { agentId: settings.decisionFlowAgentId, requestedBy: userId, attempts: 0, nextAttemptAt: new Date() },
      createdBy: userId,
      updatedBy: userId,
    });
    return this.toResponse(artifact);
  }

  async update(workspaceId: string, artifactId: string, userId: string, dto: UpdateDecisionFlowDto): Promise<WorkspaceArtifactResponse> {
    const artifact = await this.find(workspaceId, artifactId);
    if (artifact.revision !== dto.expectedRevision) throw new ConflictException(ErrorCode.WORKSPACE_ARTIFACT_REVISION_CONFLICT, 'This decision flow was modified elsewhere');
    const name = dto.name !== undefined ? await this.uniqueName(workspaceId, dto.name, artifactId) : undefined;
    let payload: DecisionFlowPayload | undefined;
    if (dto.payload !== undefined) {
      if (artifact.status !== WorkspaceArtifactStatus.READY) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_GENERATION_FAILED, 'Only ready decision flows can be edited');
      payload = this.validator.validate(dto.payload);
    }
    const updated = await this.artifacts.updateWithRevision(workspaceId, artifactId, dto.expectedRevision, {
      ...(name !== undefined ? { name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(payload !== undefined ? { payload } : {}),
    }, userId);
    if (!updated) throw new ConflictException(ErrorCode.WORKSPACE_ARTIFACT_REVISION_CONFLICT, 'This decision flow was modified elsewhere');
    return this.toResponse(updated);
  }

  async clone(workspaceId: string, artifactId: string, userId: string): Promise<WorkspaceArtifactResponse> {
    const artifact = await this.find(workspaceId, artifactId);
    if (artifact.status === WorkspaceArtifactStatus.QUEUED || artifact.status === WorkspaceArtifactStatus.GENERATING || !artifact.payload) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_GENERATION_FAILED, 'Only completed decision flows can be cloned');
    const payload = this.validator.validate(artifact.payload);
    const clone = await this.artifacts.create({
      workspaceId: artifact.workspaceId,
      type: artifact.type,
      name: await this.uniqueName(workspaceId, `${artifact.name} copy`),
      description: artifact.description,
      status: WorkspaceArtifactStatus.READY,
      schemaVersion: artifact.schemaVersion,
      primarySource: artifact.primarySource,
      generationOptions: artifact.generationOptions ?? DEFAULT_DECISION_FLOW_GENERATION_OPTIONS,
      payload,
      generation: { agentId: artifact.generation.agentId, requestedBy: userId, attempts: 0, completedAt: new Date() },
      clonedFromArtifactId: artifact.id,
      createdBy: userId,
      updatedBy: userId,
    });
    return this.toResponse(clone);
  }

  async retry(workspaceId: string, artifactId: string, userId: string): Promise<WorkspaceArtifactResponse> {
    const artifact = await this.find(workspaceId, artifactId);
    if (artifact.status !== WorkspaceArtifactStatus.FAILED) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_GENERATION_FAILED, 'Only failed decision flows can be retried');
    const settings = await this.transformations.getSettings();
    if (!settings.decisionFlowAgentId) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_GENERATION_NOT_CONFIGURED, 'Decision-flow generation is not configured');
    await this.agents.assertActiveDefaultAgent(settings.decisionFlowAgentId);
    const reset = await this.artifacts.resetForGeneration(artifact.id, { agentId: settings.decisionFlowAgentId, requestedBy: userId }, userId);
    if (!reset) throw new NotFoundException(ErrorCode.WORKSPACE_ARTIFACT_NOT_FOUND, 'Workspace artifact not found');
    return this.toResponse(reset);
  }

  async delete(workspaceId: string, artifactId: string): Promise<void> {
    const artifact = await this.find(workspaceId, artifactId);
    if (artifact.status === WorkspaceArtifactStatus.QUEUED || artifact.status === WorkspaceArtifactStatus.GENERATING) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_GENERATION_FAILED, 'A queued or generating decision flow cannot be deleted');
    await this.artifacts.deleteById(artifact.id);
  }

  private async find(workspaceId: string, artifactId: string): Promise<WorkspaceArtifactRecord> {
    const artifact = await this.artifacts.findByIdAndWorkspace(workspaceId, artifactId);
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
    while (await this.artifacts.existsName(workspaceId, candidate, exceptId)) { candidate = `${base.slice(0, 140)} _(${index++})`; }
    return candidate;
  }

  private toResponse(artifact: WorkspaceArtifactRecord): WorkspaceArtifactResponse {
    return {
      id: artifact.id,
      workspaceId: artifact.workspaceId,
      type: artifact.type as WorkspaceArtifactType,
      name: artifact.name,
      description: artifact.description,
      status: artifact.status as WorkspaceArtifactStatus,
      schemaVersion: artifact.schemaVersion,
      revision: artifact.revision,
      primarySource: artifact.primarySource,
      generationOptions: artifact.generationOptions ?? this.normalizeGenerationOptions(undefined),
      payload: artifact.payload,
      generation: {
        agentId: artifact.generation.agentId,
        requestedBy: artifact.generation.requestedBy,
        attempts: artifact.generation.attempts,
        startedAt: artifact.generation.startedAt?.toISOString(),
        completedAt: artifact.generation.completedAt?.toISOString(),
        error: artifact.generation.error,
      },
      clonedFromArtifactId: artifact.clonedFromArtifactId,
      createdBy: artifact.createdBy,
      updatedBy: artifact.updatedBy,
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString(),
    };
  }
}
