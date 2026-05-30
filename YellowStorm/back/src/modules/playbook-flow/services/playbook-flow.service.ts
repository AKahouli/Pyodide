import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Flow, FlowDocument } from '../schemas/playbook-flow.schema';
import { FlowExecution, FlowExecutionDocument } from '../schemas/playbook-flow-execution.schema';
import { CreatePlaybookFlowDto } from '../dto/create-playbook-flow.dto';
import { PatchPlaybookFlowDeltaDto } from '../dto/patch-playbook-flow-delta.dto';
import { UpdatePlaybookFlowDto } from '../dto/update-playbook-flow.dto';
import { PlaybookFlowValidatorService } from './playbook-flow-validator.service';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '../../exceptions/exceptions/http.exceptions';
import { PlaybookFlowQueryDto } from '../dto/playbook-flow-query.dto';
import { IFlowResponse, IFlowListResponse } from '../interfaces/playbook-flow.interface';
import { FlowAccessService } from '../domain/flow-access.service';
import { FlowResponseAssemblerService } from '../domain/flow-response-assembler.service';
import { FlowWorkspacePolicyService } from '../domain/flow-workspace-policy.service';
import { FlowGraphSanitizerService } from '../domain/flow-graph-sanitizer.service';
import { FlowDeltaPatchService } from '../domain/flow-delta-patch.service';

@Injectable()
export class PlaybookFlowService {
  private readonly logger = new Logger(PlaybookFlowService.name);

  private async resolveUniqueName(ownerId: string, baseName: string): Promise<string> {
    const existing = await this.flowModel.exists({ ownerId, name: baseName });
    if (!existing) return baseName;

    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapeRegex(baseName)} \\((\\d+)\\)$`);

    const duplicates = await this.flowModel
      .find({ ownerId, name: pattern })
      .select('name')
      .lean();

    let maxSeq = 1;
    for (const doc of duplicates) {
      const match = doc.name.match(pattern);
      if (match?.[1]) {
        maxSeq = Math.max(maxSeq, parseInt(match[1], 10));
      }
    }

    const suffix = ` (${maxSeq + 1})`;
    const truncatedBase = baseName.length > 100 - suffix.length
      ? baseName.slice(0, 100 - suffix.length)
      : baseName;
    return `${truncatedBase}${suffix}`;
  }

  constructor(
    @InjectModel(Flow.name) private readonly flowModel: Model<FlowDocument>,
    @InjectModel(FlowExecution.name) private readonly executionModel: Model<FlowExecutionDocument>,
    private readonly validatorService: PlaybookFlowValidatorService,
    private readonly accessService: FlowAccessService,
    private readonly responseAssembler: FlowResponseAssemblerService,
    private readonly workspacePolicy: FlowWorkspacePolicyService,
    private readonly graphSanitizer: FlowGraphSanitizerService,
    private readonly deltaPatchService: FlowDeltaPatchService,
  ) {}

  async create(ownerId: string, dto: CreatePlaybookFlowDto): Promise<IFlowResponse> {
    const nodes = dto.nodes || [];
    const controlEdges = dto.controlEdges || [];
    const dataBindings = dto.dataBindings || [];
    const workspaces = this.workspacePolicy.normalizeWorkspaces(dto.workspaces);

    this.workspacePolicy.ensureWorkspaceSelection(workspaces);

    this.validatorService.validate(nodes as any, controlEdges as any, dataBindings as any, { allowDraftRouters: true });

    const resolvedName = await this.resolveUniqueName(ownerId, dto.name);

    const flow = new this.flowModel({
      ownerId,
      schemaVersion: 1,
      name: resolvedName,
      description: dto.description,
      triggerConfig: dto.triggerConfig,
      settings: dto.settings || { recursionLimit: 25, maxParallelism: 5 },
      nodes,
      controlEdges,
      dataBindings,
      workspaces,
      reflectionEnabled: dto.reflectionEnabled ?? false,
      advisorScoringMode: dto.advisorScoringMode ?? 'llm',
      advisorAutopilotEnabled: dto.advisorAutopilotEnabled ?? false,
      advisorAutopilotTargetScore: dto.advisorAutopilotTargetScore,
      advisorAutopilotMaxTurns: dto.advisorAutopilotMaxTurns,
    });

    try {
      const saved = await flow.save();
        const raw = saved.toJSON() as unknown as IFlowResponse;
        raw.activeReplays = {};
        return raw;
    } catch (err: any) {
      if (err.code === 11000) {
        throw new ConflictException(
          ErrorCode.PLAYBOOK_FLOW_DUPLICATE_NAME,
          `A playbook named "${dto.name}" already exists.`,
        );
      }
      throw err;
    }
  }

  async findAll(ownerId: string, query: PlaybookFlowQueryDto): Promise<IFlowListResponse> {
    const { page = 1, limit = 10, sortBy = 'updatedAt', sortOrder = 'desc', search } = query;

    const filter: Record<string, unknown> = { ownerId };
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    const sortDir = sortOrder === 'asc' ? 1 : -1;
    const total = await this.flowModel.countDocuments(filter);
    const items = await this.flowModel
      .find(filter)
      .sort({ [sortBy]: sortDir })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const flowIds = items.map((item) => String((item as unknown as Record<string, unknown>)._id));
    const latestExecutions = flowIds.length === 0
      ? []
      : await this.executionModel.aggregate<{
        flowId: string;
        status: 'queued' | 'running' | 'pending_approval' | 'completed' | 'failed' | 'cancelled';
        createdAt?: Date;
        startedAt?: Date;
        endedAt?: Date;
      }>([
        { $match: { ownerId, flowId: { $in: flowIds } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$flowId',
            status: { $first: '$status' },
            createdAt: { $first: '$createdAt' },
            startedAt: { $first: '$startedAt' },
            endedAt: { $first: '$endedAt' },
          },
        },
        {
          $project: {
            _id: 0,
            flowId: '$_id',
            status: 1,
            createdAt: 1,
            startedAt: 1,
            endedAt: 1,
          },
        },
      ]);

    const latestExecutionByFlowId = new Map(
      latestExecutions.map((execution) => [execution.flowId, execution]),
    );

    return {
      items: items.map((item) => ({
        ...item,
        id: (item as unknown as Record<string, unknown>)._id as string,
        executionStatus: latestExecutionByFlowId.get(String((item as unknown as Record<string, unknown>)._id))?.status ?? null,
        lastExecutionAt:
          latestExecutionByFlowId.get(String((item as unknown as Record<string, unknown>)._id))?.endedAt
          ?? latestExecutionByFlowId.get(String((item as unknown as Record<string, unknown>)._id))?.startedAt
          ?? latestExecutionByFlowId.get(String((item as unknown as Record<string, unknown>)._id))?.createdAt
          ?? null,
        activeReplays: {},
      })) as unknown as IFlowResponse[],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOneBase(flowId: string, ownerId: string): Promise<IFlowResponse> {
    const startedAt = Date.now();
    const flow = await this.accessService.findOwnedFlow(flowId, ownerId);
    const raw = this.responseAssembler.toBaseFlowResponse(flow);
    const durationMs = Date.now() - startedAt;
    this.logger.log(`playbook_find_one_duration_ms view=base flowId=${flowId} durationMs=${durationMs}`);
    return raw;
  }

  async findOneEnriched(flowId: string, ownerId: string): Promise<IFlowResponse> {
    const startedAt = Date.now();
    const flow = await this.accessService.findOwnedFlow(flowId, ownerId);
    const raw = await this.responseAssembler.toEnrichedFlowResponse(flowId, flow);

    const durationMs = Date.now() - startedAt;
    this.logger.log(`playbook_find_one_duration_ms view=enriched flowId=${flowId} durationMs=${durationMs}`);

    return raw;
  }

  async findOne(flowId: string, ownerId: string): Promise<IFlowResponse> {
    return this.findOneEnriched(flowId, ownerId);
  }

  async findOneForExecutionStart(flowId: string, ownerId: string): Promise<IFlowResponse> {
    return this.findOneBase(flowId, ownerId);
  }

  async update(flowId: string, ownerId: string, dto: UpdatePlaybookFlowDto): Promise<IFlowResponse> {
    const startedAt = Date.now();
    const existing = await this.accessService.findOwnedFlow(flowId, ownerId);

    if (dto.expectedUpdatedAt !== undefined) {
      this.accessService.ensureExpectedUpdatedAt(
        (existing as { updatedAt?: Date }).updatedAt,
        dto.expectedUpdatedAt,
        'Playbook changed since this suggestion was generated. Refresh and retry the suggestion.',
      );
    }

    if (dto.clientMutationId) {
      this.logger.debug(`Saving playbook mutation ${dto.clientMutationId} for flow ${flowId}`);
    }

    if (dto.name !== undefined) existing.name = dto.name;
    if (dto.description !== undefined) existing.description = dto.description;
    if (dto.triggerConfig !== undefined) existing.triggerConfig = dto.triggerConfig as any;
    if (dto.settings !== undefined) existing.settings = dto.settings as any;
    if (dto.nodes !== undefined) existing.nodes = dto.nodes as any[];
    if (dto.controlEdges !== undefined) existing.controlEdges = dto.controlEdges as any[];
    if (dto.dataBindings !== undefined) existing.dataBindings = dto.dataBindings as any[];
    if (dto.reflectionEnabled !== undefined) existing.reflectionEnabled = dto.reflectionEnabled;
    if (dto.advisorScoringMode !== undefined) existing.advisorScoringMode = dto.advisorScoringMode;
    if (dto.advisorAutopilotEnabled !== undefined) existing.advisorAutopilotEnabled = dto.advisorAutopilotEnabled;
    if (dto.advisorAutopilotTargetScore !== undefined) existing.advisorAutopilotTargetScore = dto.advisorAutopilotTargetScore;
    if (dto.advisorAutopilotMaxTurns !== undefined) existing.advisorAutopilotMaxTurns = dto.advisorAutopilotMaxTurns;
    const normalizedWorkspaces = this.workspacePolicy.normalizeWorkspaces(dto.workspaces ?? existing.workspaces);
    if (dto.workspaces !== undefined || existing.workspaces.length > 1) {
      this.workspacePolicy.ensureWorkspaceSelection(normalizedWorkspaces);
    }
    existing.workspaces = normalizedWorkspaces;

    const sanitizedGraph = this.graphSanitizer.sanitize({
      nodes: existing.nodes as any,
      controlEdges: existing.controlEdges as any,
      dataBindings: existing.dataBindings as any,
    });
    existing.controlEdges = sanitizedGraph.controlEdges as any;
    existing.dataBindings = sanitizedGraph.dataBindings as any;

    this.validatorService.validate(
      existing.nodes as any,
      existing.controlEdges as any,
      existing.dataBindings as any,
      { allowDraftRouters: true },
    );

    const saved = await existing.save().catch((err: any) => {
      if (err.code === 11000) {
        throw new ConflictException(
          ErrorCode.PLAYBOOK_FLOW_DUPLICATE_NAME,
          `A playbook named "${existing.name}" already exists.`,
        );
      }
      throw err;
    });
    const raw = saved.toJSON() as unknown as IFlowResponse;
    raw.activeReplays = {};
    const durationMs = Date.now() - startedAt;
    this.logger.log(`playbook_save_duration_ms mode=full flowId=${flowId} durationMs=${durationMs}`);
    return raw;
  }

  async applyDeltaPatch(flowId: string, ownerId: string, dto: PatchPlaybookFlowDeltaDto): Promise<{
    id: string;
    updatedAt: string;
    payloadHash?: string;
    applied: true;
    patchSummary: {
      scalarFields: number;
      nodesUpserted: number;
      nodesDeleted: number;
      edgeChanges: number;
      dataBindingChanges: number;
      positionUpdates: number;
    };
  }> {
    const startedAt = Date.now();
    const existing = await this.accessService.findOwnedFlow(flowId, ownerId);

    this.accessService.ensureExpectedUpdatedAt(
      (existing as { updatedAt?: Date }).updatedAt,
      dto.expectedUpdatedAt,
      'Playbook changed since this autosave started.',
    );

    if (dto.clientMutationId) {
      this.logger.debug(`Saving playbook delta mutation ${dto.clientMutationId} for flow ${flowId}`);
    }

    const patchedGraph = this.deltaPatchService.buildPatchedGraph(existing, dto);

    this.validatorService.validate(
      patchedGraph.nodes as any,
      patchedGraph.controlEdges as any,
      patchedGraph.dataBindings as any,
      { allowDraftRouters: true },
    );

    const fields = dto.patch.fields;
    if (fields) {
      if (fields.name !== undefined) existing.name = fields.name;
      if (fields.description !== undefined) existing.description = fields.description;
      if (fields.designSettings !== undefined) existing.designSettings = fields.designSettings as any;
      if (fields.settings !== undefined) existing.settings = fields.settings as any;
      if (fields.reflectionEnabled !== undefined) existing.reflectionEnabled = fields.reflectionEnabled;
      if (fields.advisorScoringMode !== undefined) existing.advisorScoringMode = fields.advisorScoringMode;
      if (fields.advisorAutopilotEnabled !== undefined) existing.advisorAutopilotEnabled = fields.advisorAutopilotEnabled;
      if (fields.advisorAutopilotTargetScore !== undefined) existing.advisorAutopilotTargetScore = fields.advisorAutopilotTargetScore ?? undefined;
      if (fields.advisorAutopilotMaxTurns !== undefined) existing.advisorAutopilotMaxTurns = fields.advisorAutopilotMaxTurns ?? undefined;
      if (fields.workspaces !== undefined) existing.workspaces = patchedGraph.normalizedWorkspaces;
    }

    const nodeUpserts = dto.patch.nodes?.upserts ?? [];
    const nodeDeleteIds = dto.patch.nodes?.deleteIds ?? [];
    const positionUpdates = dto.patch.nodes?.positionUpdates ?? [];
    if (nodeUpserts.length > 0 || nodeDeleteIds.length > 0 || positionUpdates.length > 0) {
      existing.nodes = patchedGraph.nodes as any;
    }
    if (dto.patch.controlEdges !== undefined || nodeUpserts.length > 0 || nodeDeleteIds.length > 0) {
      existing.controlEdges = patchedGraph.controlEdges as any;
    }
    if (dto.patch.dataBindings !== undefined || nodeUpserts.length > 0 || nodeDeleteIds.length > 0) {
      existing.dataBindings = patchedGraph.dataBindings as any;
    }

    const saved = await existing.save().catch((err: any) => {
      if (err.code === 11000) {
        throw new ConflictException(
          ErrorCode.PLAYBOOK_FLOW_DUPLICATE_NAME,
          `A playbook named "${existing.name}" already exists.`,
        );
      }
      throw err;
    });

    const durationMs = Date.now() - startedAt;
    this.logger.log(`playbook_save_duration_ms mode=delta flowId=${flowId} durationMs=${durationMs}`);

    return {
      id: String(saved._id),
      updatedAt: ((saved as { updatedAt?: Date }).updatedAt ?? new Date()).toISOString(),
      ...(dto.payloadHash ? { payloadHash: dto.payloadHash } : {}),
      applied: true,
      patchSummary: {
        scalarFields: patchedGraph.scalarFieldCount,
        nodesUpserted: patchedGraph.nodesUpserted,
        nodesDeleted: patchedGraph.nodesDeleted,
        edgeChanges: patchedGraph.edgeChanges,
        dataBindingChanges: patchedGraph.dataBindingChanges,
        positionUpdates: patchedGraph.positionUpdates,
      },
    };
  }

  async findById(flowId: string): Promise<FlowDocument> {
    return this.accessService.findById(flowId);
  }

  async createWithNodesAndEdges(
    ownerId: string, name: string, description: string,
    nodes: any[], controlEdges: any[], dataBindings: any[],
    workspaces: string[] = [],
  ): Promise<IFlowResponse> {
    const normalizedWorkspaces = this.workspacePolicy.normalizeWorkspaces(workspaces);

    this.workspacePolicy.ensureWorkspaceSelection(normalizedWorkspaces);

    this.validatorService.validate(nodes as any, controlEdges as any, dataBindings as any, { allowDraftRouters: true });

    const flow = new this.flowModel({
      ownerId, schemaVersion: 1, name, description,
      nodes, controlEdges, dataBindings, workspaces: normalizedWorkspaces,
      settings: { recursionLimit: 25, maxParallelism: 5 },
    });
    try {
      const saved = await flow.save();
        const raw = saved.toJSON() as unknown as IFlowResponse;
        raw.activeReplays = {};
        return raw;
    } catch (err: any) {
      if (err.code === 11000) {
        throw new ConflictException(
          ErrorCode.PLAYBOOK_FLOW_DUPLICATE_NAME,
          `A playbook named "${name}" already exists.`,
        );
      }
      throw err;
    }
  }

  async updateNodesAndEdges(
    flowId: string, update: { nodes?: any[]; controlEdges?: any[]; dataBindings?: any[] },
  ): Promise<IFlowResponse> {
    if (update.nodes || update.controlEdges || update.dataBindings) {
      const existing = await this.flowModel.findById(flowId);
      if (!existing) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND);
      if (update.nodes) existing.nodes = update.nodes;
      if (update.controlEdges) existing.controlEdges = update.controlEdges;
      if (update.dataBindings) existing.dataBindings = update.dataBindings;
      existing.workspaces = this.workspacePolicy.normalizeWorkspaces(existing.workspaces);
      this.workspacePolicy.ensureWorkspaceSelection(existing.workspaces);

      const sanitizedGraph = this.graphSanitizer.sanitize({
        nodes: existing.nodes as any,
        controlEdges: existing.controlEdges as any,
        dataBindings: existing.dataBindings as any,
      });
      existing.controlEdges = sanitizedGraph.controlEdges as any;
      existing.dataBindings = sanitizedGraph.dataBindings as any;

      this.validatorService.validate(
        existing.nodes as any,
        existing.controlEdges as any,
        existing.dataBindings as any,
        { allowDraftRouters: true },
      );
      const saved = await existing.save();
        const raw = saved.toJSON() as unknown as IFlowResponse;
        raw.activeReplays = {};
        return raw;
    }
    return this.findOne(flowId, '');
  }

  async remove(flowId: string, ownerId: string): Promise<void> {
    await this.accessService.findOwnedFlow(flowId, ownerId);
    await this.flowModel.findByIdAndDelete(flowId);
  }

  async clone(flowId: string, ownerId: string, nameSuffix?: string): Promise<IFlowResponse> {
    const existing = await this.accessService.findOwnedFlow(flowId, ownerId);

    const cloneName = nameSuffix ? `${existing.name} ${nameSuffix}` : `${existing.name} (copy)`;
    const normalizedWorkspaces = this.workspacePolicy.normalizeWorkspaces(existing.workspaces);

    const flow = new this.flowModel({
      ownerId,
      schemaVersion: existing.schemaVersion,
      name: cloneName,
      description: existing.description,
      triggerConfig: existing.triggerConfig,
      settings: existing.settings,
      nodes: existing.nodes,
      controlEdges: existing.controlEdges,
      dataBindings: existing.dataBindings,
      workspaces: normalizedWorkspaces,
      designSettings: existing.designSettings,
      isFavorite: existing.isFavorite,
      reflectionEnabled: existing.reflectionEnabled,
      advisorScoringMode: existing.advisorScoringMode ?? 'llm',
      advisorAutopilotEnabled: existing.advisorAutopilotEnabled,
      advisorAutopilotTargetScore: existing.advisorAutopilotTargetScore,
      advisorAutopilotMaxTurns: existing.advisorAutopilotMaxTurns,
    });

    try {
      const saved = await flow.save();
        const raw = saved.toJSON() as unknown as IFlowResponse;
        raw.activeReplays = {};
        return raw;
    } catch (err: any) {
      if (err.code === 11000) {
        throw new ConflictException(
          ErrorCode.PLAYBOOK_FLOW_DUPLICATE_NAME,
          `A playbook named "${cloneName}" already exists.`,
        );
      }
      throw err;
    }
  }

  async findAllWithTriggerKind(kind: string): Promise<Array<{ id: string; ownerId: string; triggerConfig: any }>> {
    const flows = await this.flowModel
      .find({ 'triggerConfig.kind': kind })
      .select('ownerId triggerConfig')
      .lean()
      .exec();
    return flows.map((f) => ({
      id: (f as any)._id.toString(),
      ownerId: f.ownerId,
      triggerConfig: f.triggerConfig,
    }));
  }

  async toggleFavorite(flowId: string, ownerId: string): Promise<{ isFavorite: boolean }> {
    const flow = await this.flowModel.findById(flowId);
    if (!flow) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND);
    if (String(flow.ownerId) !== String(ownerId)) throw new ForbiddenException(ErrorCode.FORBIDDEN);
    const current = flow.get('isFavorite') === true;
    flow.set('isFavorite', !current);
    await flow.save();
    return { isFavorite: !current };
  }

  async bulkDelete(ids: string[], ownerId: string): Promise<{ deleted: number }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'No IDs provided');
    }
    const validIds = ids.filter((id) => Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'No valid IDs provided');
    }
    const result = await this.flowModel.deleteMany({
      _id: { $in: validIds.map((id) => new Types.ObjectId(id)) },
      ownerId,
    });
    return { deleted: result.deletedCount ?? 0 };
  }

  async getActiveExecutions(ownerId: string): Promise<any[]> {
    return this.executionModel
      .find({ ownerId, status: { $in: ['queued', 'running', 'pending_approval'] } })
      .sort({ createdAt: -1 })
      .lean();
  }

  async cloneShare(flowId: string, ownerId: string, emails: string[]): Promise<{ clone?: IFlowResponse; shared: string[] }> {
    const clone = await this.clone(flowId, ownerId, ' (shared)');
    return { clone, shared: emails };
  }
}
