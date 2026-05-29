import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Flow, FlowDocument } from '../schemas/playbook-flow.schema';
import { FlowExecution, FlowExecutionDocument } from '../schemas/playbook-flow-execution.schema';
import { CreatePlaybookFlowDto } from '../dto/create-playbook-flow.dto';
import { PatchPlaybookFlowDeltaDto } from '../dto/patch-playbook-flow-delta.dto';
import { UpdatePlaybookFlowDto } from '../dto/update-playbook-flow.dto';
import { PlaybookFlowValidatorService } from './playbook-flow-validator.service';
import { PlaybookFlowReplayService } from './playbook-flow-replay.service';
import { PlaybookFlowReplayReportService } from './playbook-flow-replay-report.service';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '../../exceptions/exceptions/http.exceptions';
import { PlaybookFlowQueryDto } from '../dto/playbook-flow-query.dto';
import { IFlowResponse, IFlowListResponse } from '../interfaces/playbook-flow.interface';

@Injectable()
export class PlaybookFlowService {
  private readonly logger = new Logger(PlaybookFlowService.name);

  private async findOwnedFlowDocument(flowId: string, ownerId: string): Promise<FlowDocument> {
    if (!Types.ObjectId.isValid(flowId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    const flow = await this.flowModel.findById(flowId);
    if (!flow) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    if (String(flow.ownerId) !== String(ownerId)) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow');
    }
    return flow;
  }

  private toBaseFlowResponse(flow: FlowDocument): IFlowResponse {
    const raw = flow.toJSON() as unknown as IFlowResponse;
    raw.activeReplays = {};
    return raw;
  }

  private ensureExpectedUpdatedAt(existingUpdatedAt: Date | undefined, expectedUpdatedAtRaw: string, message: string): void {
    const expectedUpdatedAt = Date.parse(expectedUpdatedAtRaw);
    if (Number.isNaN(expectedUpdatedAt)) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Invalid expectedUpdatedAt');
    }
    if (existingUpdatedAt instanceof Date && existingUpdatedAt.getTime() !== expectedUpdatedAt) {
      throw new ConflictException(ErrorCode.CONFLICT, message);
    }
  }

  private normalizeWorkspaces(workspaces?: string[]): string[] {
    return workspaces
      ?.map((workspaceId) => workspaceId.trim())
      .filter((workspaceId) => workspaceId.length > 0)
      .slice(0, 1)
      ?? [];
  }

  private ensureWorkspaceSelection(workspaces: string[]): void {
    if (workspaces.length === 0) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Select a default playbook workspace before saving this playbook.',
      );
    }
  }

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
    private readonly replayService: PlaybookFlowReplayService,
    private readonly replayReportService: PlaybookFlowReplayReportService,
  ) {}

  async create(ownerId: string, dto: CreatePlaybookFlowDto): Promise<IFlowResponse> {
    const nodes = dto.nodes || [];
    const controlEdges = dto.controlEdges || [];
    const dataBindings = dto.dataBindings || [];
    const workspaces = this.normalizeWorkspaces(dto.workspaces);

    this.ensureWorkspaceSelection(workspaces);

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
    const flow = await this.findOwnedFlowDocument(flowId, ownerId);
    const raw = this.toBaseFlowResponse(flow);
    const durationMs = Date.now() - startedAt;
    this.logger.log(`playbook_find_one_duration_ms view=base flowId=${flowId} durationMs=${durationMs}`);
    return raw;
  }

  async findOneEnriched(flowId: string, ownerId: string): Promise<IFlowResponse> {
    const startedAt = Date.now();
    const flow = await this.findOwnedFlowDocument(flowId, ownerId);
    const raw = this.toBaseFlowResponse(flow);

    const taskIds = (raw.nodes ?? []).map((node) => node.id);
    const activeReplays = await this.replayService.getActiveReplays(flowId, taskIds);

    raw.activeReplays = {};
    for (const replay of activeReplays) {
      raw.activeReplays[replay.taskId] = {
        id: String(replay._id),
        validationVersion: replay.validationVersion,
        isStale: replay.isStale ?? false,
        staleReasons: replay.staleReasons ?? [],
        preserveOutputFormat: replay.preserveOutputFormat ?? false,
        outputFormatGuide: replay.outputFormatGuide ?? null,
        formatGuideStatus: replay.formatGuideStatus ?? null,
        label: replay.label ?? null,
        latestOverallScore: null,
      };
    }

    const replayIds = activeReplays.map((r) => String(r._id));
    const scoreMap = await this.replayReportService.findLatestScoresForReplays(replayIds);
    for (const replay of activeReplays) {
      const entry = raw.activeReplays[replay.taskId];
      if (entry) {
        entry.latestOverallScore = scoreMap.get(String(replay._id)) ?? null;
      }
    }

    const durationMs = Date.now() - startedAt;
    this.logger.log(`playbook_find_one_replay_enrichment_duration_ms flowId=${flowId} taskCount=${taskIds.length} durationMs=${durationMs}`);
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
    if (!Types.ObjectId.isValid(flowId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    const existing = await this.flowModel.findById(flowId);
    if (!existing) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    if (String(existing.ownerId) !== String(ownerId)) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow');
    }

    if (dto.expectedUpdatedAt !== undefined) {
      this.ensureExpectedUpdatedAt(
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
    const normalizedWorkspaces = this.normalizeWorkspaces(dto.workspaces ?? existing.workspaces);
    if (dto.workspaces !== undefined || existing.workspaces.length > 1) {
      this.ensureWorkspaceSelection(normalizedWorkspaces);
    }
    existing.workspaces = normalizedWorkspaces;

    const effectiveNodeIds = new Set(existing.nodes.map((n: any) => n.id));

    const edgeCountBefore = existing.controlEdges.length;
    existing.controlEdges = existing.controlEdges.filter((e: any) => {
      const valid = effectiveNodeIds.has(e.source) && effectiveNodeIds.has(e.target);
      if (!valid) {
        this.logger.warn(`Removing orphaned edge ${e.id}: source=${e.source} target=${e.target}`);
      }
      return valid;
    });
    if (existing.controlEdges.length < edgeCountBefore) {
      this.logger.warn(`Removed ${edgeCountBefore - existing.controlEdges.length} orphaned edge(s)`);
    }

    const bindingCountBefore = existing.dataBindings.length;
    existing.dataBindings = existing.dataBindings.filter((b: any) => {
      const valid = effectiveNodeIds.has(b.targetNode)
        && (b.sourceNode ? effectiveNodeIds.has(b.sourceNode) : true);
      if (!valid) {
        this.logger.warn(`Removing orphaned data binding ${b.id}: targetNode=${b.targetNode} sourceNode=${b.sourceNode}`);
      }
      return valid;
    });
    if (existing.dataBindings.length < bindingCountBefore) {
      this.logger.warn(`Removed ${bindingCountBefore - existing.dataBindings.length} orphaned data binding(s)`);
    }

    const nodesById = new Map((existing.nodes as any[]).map((n: any) => [n.id, n]));
    const portCountBefore = existing.dataBindings.length;
    existing.dataBindings = existing.dataBindings.filter((b: any) => {
      const targetNode = nodesById.get(b.targetNode);
      if (!targetNode) return true;
      const targetPortExists = targetNode.input?.ports?.some((p: any) => p.id === b.targetPort);
      if (!targetPortExists) {
        this.logger.warn(`Removing stale data binding ${b.id}: target port ${b.targetNode}.${b.targetPort} no longer exists`);
        return false;
      }
      if (b.sourceKind === 'node-output' && b.sourceNode) {
        const sourceNode = nodesById.get(b.sourceNode);
        if (sourceNode) {
          const sourcePortExists = sourceNode.output?.ports?.some((p: any) => p.id === b.sourcePort);
          if (!sourcePortExists) {
            this.logger.warn(`Removing stale data binding ${b.id}: source port ${b.sourceNode}.${b.sourcePort} no longer exists`);
            return false;
          }
        }
      }
      return true;
    });
    if (existing.dataBindings.length < portCountBefore) {
      this.logger.warn(`Removed ${portCountBefore - existing.dataBindings.length} stale port binding(s)`);
    }

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
    if (!Types.ObjectId.isValid(flowId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }

    const existing = await this.flowModel.findById(flowId);
    if (!existing) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    if (String(existing.ownerId) !== String(ownerId)) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow');
    }

    this.ensureExpectedUpdatedAt(
      (existing as { updatedAt?: Date }).updatedAt,
      dto.expectedUpdatedAt,
      'Playbook changed since this autosave started.',
    );

    if (dto.clientMutationId) {
      this.logger.debug(`Saving playbook delta mutation ${dto.clientMutationId} for flow ${flowId}`);
    }

    const fields = dto.patch.fields;
    const positionUpdates = dto.patch.nodes?.positionUpdates ?? [];
    const unsupportedStructurePatch = Object.keys(dto.patch).some((key) => key !== 'fields' && key !== 'nodes');
    if (unsupportedStructurePatch) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Delta patch requires full refresh.');
    }

    if (dto.patch.nodes && dto.patch.nodes.positionUpdates === undefined) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Delta patch requires full refresh.');
    }

    if (!fields && positionUpdates.length === 0) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Delta patch is empty.');
    }

    const nodesById = new Map((existing.nodes as any[]).map((node: any) => [node.id, node]));
    const candidateNodes = (existing.nodes as any[]).map((node: any) => ({
      ...node,
      metadata: { ...(node.metadata ?? {}) },
    }));
    const candidateNodesById = new Map(candidateNodes.map((node: any) => [node.id, node]));

    for (const update of positionUpdates) {
      const currentNode = nodesById.get(update.id);
      const candidateNode = candidateNodesById.get(update.id);
      if (!currentNode || !candidateNode) {
        throw new ConflictException(ErrorCode.CONFLICT, 'Delta patch requires full refresh.');
      }
      candidateNode.metadata.positionX = update.positionX;
      candidateNode.metadata.positionY = update.positionY;
    }

    const normalizedWorkspaces = this.normalizeWorkspaces(fields?.workspaces ?? existing.workspaces);
    if (fields?.workspaces !== undefined || existing.workspaces.length > 1) {
      this.ensureWorkspaceSelection(normalizedWorkspaces);
    }

    this.validatorService.validate(
      candidateNodes as any,
      existing.controlEdges as any,
      existing.dataBindings as any,
      { allowDraftRouters: true },
    );

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
      if (fields.workspaces !== undefined) existing.workspaces = normalizedWorkspaces;
    }

    if (positionUpdates.length > 0) {
      existing.nodes = candidateNodes as any;
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
        scalarFields: fields ? Object.keys(fields).length : 0,
        nodesUpserted: 0,
        nodesDeleted: 0,
        edgeChanges: 0,
        dataBindingChanges: 0,
        positionUpdates: positionUpdates.length,
      },
    };
  }

  async findById(flowId: string): Promise<FlowDocument> {
    const flow = await this.flowModel.findById(flowId);
    if (!flow) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    return flow;
  }

  async createWithNodesAndEdges(
    ownerId: string, name: string, description: string,
    nodes: any[], controlEdges: any[], dataBindings: any[],
    workspaces: string[] = [],
  ): Promise<IFlowResponse> {
    const normalizedWorkspaces = this.normalizeWorkspaces(workspaces);

    this.ensureWorkspaceSelection(normalizedWorkspaces);

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
      existing.workspaces = this.normalizeWorkspaces(existing.workspaces);
      this.ensureWorkspaceSelection(existing.workspaces);

      const nodesById = new Map((existing.nodes as any[]).map((n: any) => [n.id, n]));
      existing.dataBindings = (existing.dataBindings as any[]).filter((b: any) => {
        const targetNode = nodesById.get(b.targetNode);
        if (!targetNode) return true;
        const targetPortExists = targetNode.input?.ports?.some((p: any) => p.id === b.targetPort);
        if (!targetPortExists) {
          this.logger.warn(`Removing stale data binding ${b.id}: target port ${b.targetNode}.${b.targetPort} no longer exists`);
          return false;
        }
        if (b.sourceKind === 'node-output' && b.sourceNode) {
          const sourceNode = nodesById.get(b.sourceNode);
          if (sourceNode) {
            const sourcePortExists = sourceNode.output?.ports?.some((p: any) => p.id === b.sourcePort);
            if (!sourcePortExists) {
              this.logger.warn(`Removing stale data binding ${b.id}: source port ${b.sourceNode}.${b.sourcePort} no longer exists`);
              return false;
            }
          }
        }
        return true;
      });

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
    if (!Types.ObjectId.isValid(flowId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    const flow = await this.flowModel.findById(flowId);
    if (!flow) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    if (String(flow.ownerId) !== String(ownerId)) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow');
    }
    await this.flowModel.findByIdAndDelete(flowId);
  }

  async clone(flowId: string, ownerId: string, nameSuffix?: string): Promise<IFlowResponse> {
    if (!Types.ObjectId.isValid(flowId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    const existing = await this.flowModel.findById(flowId);
    if (!existing) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    if (String(existing.ownerId) !== String(ownerId)) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow');
    }

    const cloneName = nameSuffix ? `${existing.name} ${nameSuffix}` : `${existing.name} (copy)`;
    const normalizedWorkspaces = this.normalizeWorkspaces(existing.workspaces);

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
