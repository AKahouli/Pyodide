import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isObjectId, isUniqueViolation } from '@common/postgres';
import { ControlEdge, DataBinding } from '../models/playbook-flow.model';
import { CreatePlaybookFlowDto } from '../dto/create-playbook-flow.dto';
import { PatchPlaybookFlowDeltaDto } from '../dto/patch-playbook-flow-delta.dto';
import { UpdatePlaybookFlowDto } from '../dto/update-playbook-flow.dto';
import { PlaybookFlowValidatorService } from './playbook-flow-validator.service';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '../../exceptions/exceptions/http.exceptions';
import { PlaybookFlowQueryDto } from '../dto/playbook-flow-query.dto';
import { IFlowResponse, IFlowListResponse } from '../interfaces/playbook-flow.interface';
import { FlowAccessService } from '../domain/flow-access.service';
import { FlowResponseAssemblerService, toFlowJson } from '../domain/flow-response-assembler.service';
import { FlowWorkspacePolicyService } from '../domain/flow-workspace-policy.service';
import { FlowGraphSanitizerService } from '../domain/flow-graph-sanitizer.service';
import { FlowDeltaPatchService } from '../domain/flow-delta-patch.service';
import { PlaybookFlowIdempotencyService } from './playbook-flow-idempotency.service';
import { DEFAULT_HITL_POLICY, type HitlBlockerRule, type HitlPolicy } from '../models/playbook-flow-hitl.model';
import { PlaybookShareService } from './playbook-share.service';
import {
  FlowRepository,
  castFlowPatch,
  type FlowGenerationProvenance,
  type FlowPatch,
  type FlowRecord,
} from '../persistence/flow.repository';
import { ExecutionRepository, toExecutionJson } from '../persistence/execution.repository';

/** The fields an editor save writes, all of them, as persistEditorWrite did with `$set`. */
type EditorState = Required<Pick<FlowPatch,
  | 'name' | 'description' | 'triggerConfig' | 'settings' | 'hitlPolicy' | 'hitlBlockers' | 'nodes' | 'controlEdges'
  | 'dataBindings' | 'workspaces' | 'designSettings' | 'reflectionEnabled' | 'advisorScoringMode' | 'advisorAutopilotEnabled'
  | 'advisorAutopilotTargetScore' | 'advisorAutopilotMaxTurns'
>>;

@Injectable()
export class PlaybookFlowService {
  private readonly logger = new Logger(PlaybookFlowService.name);

  private stableStringify(value: unknown, seen = new WeakSet()): string {
    if (value === undefined) {
      return 'undefined';
    }

    if (value === null) {
      return 'null';
    }
    if (typeof value !== 'object') {
      return JSON.stringify(value);
    }

    const objectValue = value as Record<string, unknown>;

    if (seen.has(objectValue)) {
      return JSON.stringify('[Circular]');
    }

    if (Array.isArray(value)) {
      seen.add(objectValue);
      const serialized = `[${value.map((item) => this.stableStringify(item, seen)).join(',')}]`;
      seen.delete(objectValue);
      return serialized;
    }

    seen.add(objectValue);
    const serialized = `{${Object.keys(objectValue)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => `${JSON.stringify(key)}:${this.stableStringify(objectValue[key], seen)}`)
      .join(',')}}`;
    seen.delete(objectValue);
    return serialized;
  }

  private buildEditorStateHash(flow: FlowRecord | EditorState | Record<string, unknown>): string {
    const source = flow as Record<string, unknown>;
    return this.stableStringify({
      name: source.name,
      description: source.description,
      triggerConfig: source.triggerConfig,
      settings: source.settings,
      hitlPolicy: source.hitlPolicy,
      hitlBlockers: source.hitlBlockers,
      nodes: source.nodes,
      controlEdges: source.controlEdges,
      dataBindings: source.dataBindings,
      workspaces: source.workspaces,
      designSettings: source.designSettings,
      reflectionEnabled: source.reflectionEnabled,
      advisorScoringMode: source.advisorScoringMode,
      advisorAutopilotEnabled: source.advisorAutopilotEnabled,
      advisorAutopilotTargetScore: source.advisorAutopilotTargetScore,
      advisorAutopilotMaxTurns: source.advisorAutopilotMaxTurns,
    });
  }

  private buildSaveIdempotencyKey(flowId: string, clientMutationId: string): string {
    return `flow-save:${flowId}:${clientMutationId}`;
  }

  private buildDeltaPatchSummary(dto: PatchPlaybookFlowDeltaDto) {
    return {
      scalarFields: Object.keys(dto.patch.fields ?? {}).length,
      nodesUpserted: dto.patch.nodes?.upserts?.length ?? 0,
      nodesDeleted: dto.patch.nodes?.deleteIds?.length ?? 0,
      edgeChanges: dto.patch.controlEdges !== undefined ? 1 : 0,
      dataBindingChanges: dto.patch.dataBindings !== undefined ? 1 : 0,
      positionUpdates: dto.patch.nodes?.positionUpdates?.length ?? 0,
    };
  }

  /** The editor fields of a stored flow, copied so they can be changed before the save. */
  private toEditorState(flow: FlowRecord): EditorState {
    return {
      name: flow.name,
      description: flow.description,
      triggerConfig: flow.triggerConfig,
      settings: flow.settings,
      hitlPolicy: flow.hitlPolicy,
      hitlBlockers: flow.hitlBlockers,
      nodes: flow.nodes,
      controlEdges: flow.controlEdges,
      dataBindings: flow.dataBindings,
      workspaces: flow.workspaces,
      designSettings: flow.designSettings,
      reflectionEnabled: flow.reflectionEnabled,
      advisorScoringMode: flow.advisorScoringMode,
      advisorAutopilotEnabled: flow.advisorAutopilotEnabled,
      advisorAutopilotTargetScore: flow.advisorAutopilotTargetScore,
      advisorAutopilotMaxTurns: flow.advisorAutopilotMaxTurns,
    };
  }

  /** The state as it will read back once stored, so its hash matches a re-read of the saved flow. */
  private castEditorState(state: EditorState): EditorState {
    return castFlowPatch(state) as EditorState;
  }

  private sameWorkspaces(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((workspaceId, index) => workspaceId === right[index]);
  }

  private duplicateNameConflict(name: string): ConflictException {
    return new ConflictException(
      ErrorCode.PLAYBOOK_FLOW_DUPLICATE_NAME,
      `A playbook named "${name}" already exists.`,
    );
  }

  /**
   * Writes every editor field and increments the definition revision in one conditional UPDATE,
   * guarded by the expected revision or, failing that, the expected updatedAt.
   */
  private async persistEditorWrite(
    flowId: string,
    ownerId: string,
    expectedDefinitionRevision: number | undefined,
    expectedUpdatedAt: string | undefined,
    message: string,
    existing: FlowRecord,
    state: EditorState,
  ): Promise<FlowRecord> {
    const { workspaces, ...fields } = state;
    const workspacesChanged = !this.sameWorkspaces(workspaces, existing.workspaces);
    const guard = expectedDefinitionRevision !== undefined
      ? { expectedRevision: expectedDefinitionRevision }
      : expectedUpdatedAt !== undefined ? { expectedUpdatedAt: new Date(expectedUpdatedAt) } : {};

    let saved: FlowRecord | null;
    try {
      saved = await this.flows.updateFields(
        flowId,
        { ...fields, ...(workspacesChanged ? { workspaces } : {}) },
        { ownerId, incrementRevision: true, ...guard },
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw this.duplicateNameConflict(state.name);
      throw err;
    }

    if (!saved) {
      throw new ConflictException(ErrorCode.CONFLICT, message);
    }
    return saved;
  }

  private async resolveUniqueName(ownerId: string, baseName: string): Promise<string> {
    const existing = await this.flows.nameTaken(ownerId, baseName);
    if (!existing) return baseName;

    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapeRegex(baseName)} \\((\\d+)\\)$`);

    const duplicates = await this.flows.listNamesWithPrefix(ownerId, `${baseName} (`);

    let maxSeq = 1;
    for (const name of duplicates) {
      const match = name.match(pattern);
      if (match?.[1]) {
        maxSeq = Math.max(maxSeq, Number.parseInt(match[1], 10));
      }
    }

    const suffix = ` (${maxSeq + 1})`;
    const truncatedBase = baseName.length > 100 - suffix.length
      ? baseName.slice(0, 100 - suffix.length)
      : baseName;
    return `${truncatedBase}${suffix}`;
  }

  constructor(
    private readonly flows: FlowRepository,
    private readonly executions: ExecutionRepository,
    private readonly validatorService: PlaybookFlowValidatorService,
    private readonly accessService: FlowAccessService,
    private readonly responseAssembler: FlowResponseAssemblerService,
    private readonly workspacePolicy: FlowWorkspacePolicyService,
    private readonly graphSanitizer: FlowGraphSanitizerService,
    private readonly deltaPatchService: FlowDeltaPatchService,
    private readonly idempotencyService: PlaybookFlowIdempotencyService,
    private readonly configService: ConfigService,
    private readonly playbookShareService: PlaybookShareService,
  ) {}

  private buildDefaultHitlPolicy(): Record<string, unknown> {
    if (this.configService.get<boolean>('playbook-flow.smartHitlDefaultEnabled', true)) {
      return { ...DEFAULT_HITL_POLICY };
    }
    return { ...DEFAULT_HITL_POLICY, mode: 'manual', disabledReason: 'Smart HITL defaults are disabled by configuration.' };
  }

  private buildDefaultHitlBlockers(): Record<string, unknown>[] {
    return [];
  }

  async create(ownerId: string, dto: CreatePlaybookFlowDto, options?: {
    assistantOperationId?: string;
    generationProvenance?: FlowGenerationProvenance & { acceptedAt: Date };
  }): Promise<IFlowResponse> {
    const nodes = dto.nodes || [];
    const controlEdges = dto.controlEdges || [];
    const dataBindings = dto.dataBindings || [];
    const workspaces = this.workspacePolicy.normalizeWorkspaces(dto.workspaces);

    this.validatorService.validate(nodes as any, controlEdges, dataBindings, { allowDraftRouters: true });

    const resolvedName = await this.resolveUniqueName(ownerId, dto.name);

    try {
      const saved = await this.flows.create({
        ownerId,
        ...(options?.assistantOperationId ? { assistantOperationId: options.assistantOperationId } : {}),
        ...(options?.generationProvenance ? { generationProvenance: options.generationProvenance } : {}),
        schemaVersion: 1,
        name: resolvedName,
        description: dto.description,
        triggerConfig: dto.triggerConfig,
        settings: dto.settings || { recursionLimit: 25, maxParallelism: 5 },
        hitlPolicy: (dto.hitlPolicy ?? this.buildDefaultHitlPolicy()) as unknown as HitlPolicy,
        hitlBlockers: (dto.hitlBlockers ?? this.buildDefaultHitlBlockers()) as unknown as HitlBlockerRule[],
        nodes: nodes as unknown as FlowRecord['nodes'],
        controlEdges: controlEdges,
        dataBindings: dataBindings,
        workspaces,
        reflectionEnabled: dto.reflectionEnabled ?? false,
        advisorScoringMode: dto.advisorScoringMode ?? 'llm',
        advisorAutopilotEnabled: dto.advisorAutopilotEnabled ?? false,
        advisorAutopilotTargetScore: dto.advisorAutopilotTargetScore,
        advisorAutopilotMaxTurns: dto.advisorAutopilotMaxTurns,
      });
      return toFlowJson(saved);
    } catch (err) {
      // Mongo's code 11000 covered both unique indexes (owner + name, assistant operation).
      if (isUniqueViolation(err)) throw this.duplicateNameConflict(dto.name);
      throw err;
    }
  }

  async findByAssistantOperationId(ownerId: string, assistantOperationId: string): Promise<IFlowResponse | null> {
    const flow = await this.flows.findByAssistantOperationId(ownerId, assistantOperationId);
    if (!flow) return null;
    return this.responseAssembler.toBaseFlowResponse(flow);
  }

  async removeAssistantDraftIfUnchanged(ownerId: string, playbookId: string, assistantOperationId: string, expectedDefinitionRevision: number): Promise<boolean> {
    return this.flows.deleteAssistantDraft(ownerId, playbookId, assistantOperationId, expectedDefinitionRevision);
  }

  async findAll(ownerId: string, query: PlaybookFlowQueryDto): Promise<IFlowListResponse> {
    const { page = 1, limit = 10, sortBy = 'updatedAt', sortOrder = 'desc', search } = query;

    const sharedFlowIds = await this.playbookShareService.getSharedPlaybookIdsForUser(ownerId);
    const { items, total } = await this.flows.listAccessible({ ownerId, sharedFlowIds, search, sortBy, sortOrder, page, limit });

    const shareInfoByFlowId = await this.playbookShareService.getShareInfoMapForUser(ownerId);

    return {
      items: items.map(({ flow, latestExecution }) => ({
        ...toFlowJson(flow),
        accessLevel: String(flow.ownerId) === String(ownerId)
          ? 'owner'
          : shareInfoByFlowId.get(flow.id)?.permission ?? 'read',
        shareInfo: shareInfoByFlowId.get(flow.id) ?? null,
        definitionRevision: flow.definitionRevision,
        executionStatus: latestExecution?.status ?? null,
        lastExecutionAt: latestExecution?.activityAt ?? null,
        activeReplays: {},
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async searchForAssistant(
    ownerId: string,
    query: string | undefined,
    workspaceId: string | undefined,
    limit: number,
  ): Promise<{
    playbookId: string;
    name: string;
    description?: string;
    definitionRevision: number;
    updatedAt?: Date;
    matchReason: 'exact_name' | 'prefix_name' | 'partial_name' | 'recent';
  }[]> {
    const sharedFlowIds = await this.playbookShareService.getSharedPlaybookIdsForUser(ownerId);
    const normalizedQuery = query?.trim() ?? '';
    const candidates = new Map<string, {
      id: string;
      name: string;
      description: string | null;
      definitionRevision: number;
      updatedAt: Date;
      matchReason: 'exact_name' | 'prefix_name' | 'partial_name' | 'recent';
    }>();

    const collect = async (
      match: 'exact' | 'prefix' | 'partial' | undefined,
      matchReason: 'exact_name' | 'prefix_name' | 'partial_name' | 'recent',
    ): Promise<void> => {
      const items = await this.flows.search({
        ownerId,
        sharedFlowIds,
        workspaceId: workspaceId || undefined,
        name: match ? { text: normalizedQuery, match } : undefined,
        limit,
      });
      for (const item of items) {
        if (!candidates.has(item.id)) {
          candidates.set(item.id, { ...item, matchReason });
        }
      }
    };

    if (normalizedQuery) {
      await collect('exact', 'exact_name');
      if (candidates.size < limit) await collect('prefix', 'prefix_name');
      if (candidates.size < limit) await collect('partial', 'partial_name');
    } else {
      await collect(undefined, 'recent');
    }

    return [...candidates.values()].slice(0, limit).map((item) => ({
      playbookId: item.id,
      name: item.name,
      description: item.description?.slice(0, 500),
      definitionRevision: item.definitionRevision,
      updatedAt: item.updatedAt,
      matchReason: item.matchReason,
    }));
  }

  async findAccessibleAssistantIndex(ownerId: string): Promise<{
    playbookId: string;
    name: string;
    tasks: { taskId: string; taskName: string }[];
  }[]> {
    const sharedFlowIds = await this.playbookShareService.getSharedPlaybookIdsForUser(ownerId);
    const flows = await this.flows.listNodeIndex(ownerId, sharedFlowIds);
    return flows.map((flow) => ({
      playbookId: flow.id,
      name: flow.name,
      tasks: flow.nodes.map((node) => ({ taskId: node.id, taskName: node.label ?? node.id })),
    }));
  }

  async findOneBase(flowId: string, ownerId: string): Promise<IFlowResponse> {
    const startedAt = Date.now();
    const flow = await this.accessService.findAccessibleFlow(flowId, ownerId, 'read');
    const raw = this.responseAssembler.toBaseFlowResponse(flow);
    (raw as IFlowResponse & { accessLevel?: string }).accessLevel = String(flow.ownerId) === String(ownerId) ? 'owner' : await this.playbookShareService.getSharePermission(ownerId, flowId) ?? 'read';
    const durationMs = Date.now() - startedAt;
    this.logger.log(`playbook_find_one_duration_ms view=base flowId=${flowId} durationMs=${durationMs}`);
    return raw;
  }

  async findOneEnriched(flowId: string, ownerId: string): Promise<IFlowResponse> {
    const startedAt = Date.now();
    const flow = await this.accessService.findAccessibleFlow(flowId, ownerId, 'read');
    const raw = await this.responseAssembler.toEnrichedFlowResponse(flowId, flow);
    (raw as IFlowResponse & { accessLevel?: string }).accessLevel = String(flow.ownerId) === String(ownerId) ? 'owner' : await this.playbookShareService.getSharePermission(ownerId, flowId) ?? 'read';

    const durationMs = Date.now() - startedAt;
    this.logger.log(`playbook_find_one_duration_ms view=enriched flowId=${flowId} durationMs=${durationMs}`);

    return raw;
  }

  async findOne(flowId: string, ownerId: string): Promise<IFlowResponse> {
    return this.findOneEnriched(flowId, ownerId);
  }

  async findOneForWrite(flowId: string, ownerId: string): Promise<IFlowResponse> {
    const flow = await this.accessService.findAccessibleFlow(flowId, ownerId, 'write');
    return this.responseAssembler.toEnrichedFlowResponse(flowId, flow);
  }

  async findOneForExecutionStart(flowId: string, ownerId: string): Promise<IFlowResponse> {
    const flow = await this.accessService.findAccessibleFlow(flowId, ownerId, 'write');
    return this.responseAssembler.toBaseFlowResponse(flow);
  }

  async persistSanitizedExecutionGraph(
    flowId: string,
    ownerId: string,
    expectedDefinitionRevision: number,
    controlEdges: ControlEdge[],
    dataBindings: DataBinding[],
  ): Promise<number> {
    const saved = await this.flows.updateFields(
      flowId,
      { controlEdges, dataBindings },
      { ownerId, expectedRevision: expectedDefinitionRevision, incrementRevision: true },
    );
    if (!saved) {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Playbook changed while preparing execution. Retry with the latest version.',
      );
    }
    return saved.definitionRevision;
  }

  async update(
    flowId: string,
    ownerId: string,
    dto: UpdatePlaybookFlowDto,
    validationOptions: { allowUnboundRequiredPorts?: boolean; allowIncompleteNodeOutputBindings?: boolean } = {},
  ): Promise<IFlowResponse> {
    const startedAt = Date.now();
    const idempotencyKey = dto.clientMutationId
      ? this.buildSaveIdempotencyKey(flowId, dto.clientMutationId)
      : null;
    let reservedByRequest = false;
    let writeCommitted = false;
    if (idempotencyKey) {
      const reservation = await this.idempotencyService.reserveSave<IFlowResponse>(ownerId, idempotencyKey, dto);
      if (reservation.type === 'duplicate') {
        return reservation.responseBody;
      }
      if (reservation.type === 'duplicate-pending') {
        const existing = await this.accessService.findAccessibleFlow(flowId, ownerId, 'write');
        if (reservation.expectedDefinitionRevision !== undefined
          && reservation.expectedStateHash
          && existing.definitionRevision === reservation.expectedDefinitionRevision
          && this.buildEditorStateHash(existing) === reservation.expectedStateHash) {
          const response = this.responseAssembler.toBaseFlowResponse(existing);
          await this.idempotencyService.confirmSaveResult(ownerId, idempotencyKey, response);
          return response;
        }
        throw new ConflictException(
          ErrorCode.CONFLICT,
          'Idempotency key reservation exists but save result was not recorded yet. Retry shortly with the same payload.',
        );
      }
      reservedByRequest = true;
    }

    try {
    const existing = await this.accessService.findAccessibleFlow(flowId, ownerId, 'write');

    if (dto.expectedDefinitionRevision !== undefined) {
      this.accessService.ensureExpectedDefinitionRevision(
        existing.definitionRevision,
        dto.expectedDefinitionRevision,
        'Playbook changed since this suggestion was generated. Refresh and retry the suggestion.',
      );
    } else if (dto.expectedUpdatedAt !== undefined) {
      this.accessService.ensureExpectedUpdatedAt(
        existing.updatedAt,
        dto.expectedUpdatedAt,
        'Playbook changed since this suggestion was generated. Refresh and retry the suggestion.',
      );
    }

    if (dto.clientMutationId) {
      this.logger.debug(`Saving playbook mutation ${dto.clientMutationId} for flow ${flowId}`);
    }

    const next = this.toEditorState(existing);
    if (dto.name !== undefined) next.name = dto.name;
    if (dto.description !== undefined) next.description = dto.description;
    if (dto.triggerConfig !== undefined) next.triggerConfig = dto.triggerConfig;
    if (dto.settings !== undefined) next.settings = dto.settings;
    if (dto.hitlPolicy !== undefined) next.hitlPolicy = dto.hitlPolicy as unknown as HitlPolicy;
    if (dto.hitlBlockers !== undefined) next.hitlBlockers = dto.hitlBlockers as unknown as HitlBlockerRule[];
    if (dto.nodes !== undefined) next.nodes = dto.nodes as unknown as FlowRecord['nodes'];
    if (dto.controlEdges !== undefined) next.controlEdges = dto.controlEdges;
    if (dto.dataBindings !== undefined) next.dataBindings = dto.dataBindings;
    if (dto.reflectionEnabled !== undefined) next.reflectionEnabled = dto.reflectionEnabled;
    if (dto.advisorScoringMode !== undefined) next.advisorScoringMode = dto.advisorScoringMode;
    if (dto.advisorAutopilotEnabled !== undefined) next.advisorAutopilotEnabled = dto.advisorAutopilotEnabled;
    if (dto.advisorAutopilotTargetScore !== undefined) next.advisorAutopilotTargetScore = dto.advisorAutopilotTargetScore;
    if (dto.advisorAutopilotMaxTurns !== undefined) next.advisorAutopilotMaxTurns = dto.advisorAutopilotMaxTurns;
    next.workspaces = this.workspacePolicy.normalizeWorkspaces(dto.workspaces ?? existing.workspaces);

    // Sanitized and validated as cast, like the Mongoose subdocuments the assignments produced.
    const cast = this.castEditorState(next);
    const sanitizedGraph = this.graphSanitizer.sanitize({
      nodes: cast.nodes,
      controlEdges: cast.controlEdges,
      dataBindings: cast.dataBindings,
    });
    cast.controlEdges = sanitizedGraph.controlEdges;
    cast.dataBindings = sanitizedGraph.dataBindings;

    this.validatorService.validate(
      cast.nodes,
      cast.controlEdges,
      cast.dataBindings,
      { allowDraftRouters: true, ...validationOptions },
    );

    const state = this.castEditorState(cast);
    if (idempotencyKey) {
      await this.idempotencyService.recordExpectedSaveState(
        ownerId,
        idempotencyKey,
        this.buildEditorStateHash(state),
        existing.definitionRevision + 1,
      );
    }

    const saved = await this.persistEditorWrite(
      flowId,
      String(existing.ownerId),
      dto.expectedDefinitionRevision,
      dto.expectedUpdatedAt,
      'Playbook changed since this suggestion was generated. Refresh and retry the suggestion.',
      existing,
      state,
    );
    const raw = toFlowJson(saved);
    const durationMs = Date.now() - startedAt;
    this.logger.log(`playbook_save_duration_ms mode=full flowId=${flowId} durationMs=${durationMs}`);
    writeCommitted = true;
    if (idempotencyKey) {
      try {
        await this.idempotencyService.confirmSaveResult(ownerId, idempotencyKey, raw);
      } catch (err) {
        this.logger.warn(`Failed to record idempotent full-save result for flow ${flowId}: ${(err as Error).message}`);
      }
    }
    return raw;
    } catch (err) {
      if (idempotencyKey && reservedByRequest && !writeCommitted) {
        await this.idempotencyService.release(ownerId, idempotencyKey);
      }
      throw err;
    }
  }

  async applyDeltaPatch(flowId: string, ownerId: string, dto: PatchPlaybookFlowDeltaDto): Promise<{
    id: string;
    updatedAt: string;
    definitionRevision: number;
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
    const idempotencyKey = dto.clientMutationId
      ? this.buildSaveIdempotencyKey(flowId, dto.clientMutationId)
      : null;
    let reservedByRequest = false;
    let writeCommitted = false;
    if (idempotencyKey) {
      const reservation = await this.idempotencyService.reserveSave<{
        id: string;
        updatedAt: string;
        definitionRevision: number;
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
      }>(ownerId, idempotencyKey, dto);
      if (reservation.type === 'duplicate') {
        return reservation.responseBody;
      }
      if (reservation.type === 'duplicate-pending') {
        const existing = await this.accessService.findAccessibleFlow(flowId, ownerId, 'write');
        if (reservation.expectedDefinitionRevision !== undefined
          && reservation.expectedStateHash
          && existing.definitionRevision === reservation.expectedDefinitionRevision
          && this.buildEditorStateHash(existing) === reservation.expectedStateHash) {
          const response = {
            id: existing.id,
            updatedAt: existing.updatedAt.toISOString(),
            definitionRevision: existing.definitionRevision,
            ...(dto.payloadHash ? { payloadHash: dto.payloadHash } : {}),
            applied: true as const,
            patchSummary: this.buildDeltaPatchSummary(dto),
          };
          await this.idempotencyService.confirmSaveResult(ownerId, idempotencyKey, response);
          return response;
        }
        throw new ConflictException(
          ErrorCode.CONFLICT,
          'Idempotency key reservation exists but save result was not recorded yet. Retry shortly with the same payload.',
        );
      }
      reservedByRequest = true;
    }

    try {
    const existing = await this.accessService.findAccessibleFlow(flowId, ownerId, 'write');

    this.accessService.ensureExpectedDefinitionRevision(
      existing.definitionRevision,
      dto.expectedDefinitionRevision,
      'Playbook changed since this autosave started.',
    );

    if (dto.clientMutationId) {
      this.logger.debug(`Saving playbook delta mutation ${dto.clientMutationId} for flow ${flowId}`);
    }

    const patchedGraph = this.deltaPatchService.buildPatchedGraph(existing, dto);

    this.validatorService.validate(
      patchedGraph.nodes,
      patchedGraph.controlEdges,
      patchedGraph.dataBindings,
      {
        allowDraftRouters: true,
        allowUnboundRequiredPorts: true,
        allowIncompleteNodeOutputBindings: true,
      },
    );

    const next = this.toEditorState(existing);
    const fields = dto.patch.fields;
    if (fields) {
      if (fields.name !== undefined) next.name = fields.name;
      if (fields.description !== undefined) next.description = fields.description;
      if (fields.designSettings !== undefined) next.designSettings = fields.designSettings;
      if (fields.settings !== undefined) next.settings = fields.settings as unknown as FlowRecord['settings'];
      if (fields.reflectionEnabled !== undefined) next.reflectionEnabled = fields.reflectionEnabled;
      if (fields.advisorScoringMode !== undefined) next.advisorScoringMode = fields.advisorScoringMode;
      if (fields.advisorAutopilotEnabled !== undefined) next.advisorAutopilotEnabled = fields.advisorAutopilotEnabled;
      // null clears the value (the Mongo $set dropped the undefined it became, leaving the old value).
      if (fields.advisorAutopilotTargetScore !== undefined) next.advisorAutopilotTargetScore = fields.advisorAutopilotTargetScore ?? null;
      if (fields.advisorAutopilotMaxTurns !== undefined) next.advisorAutopilotMaxTurns = fields.advisorAutopilotMaxTurns ?? null;
      if (fields.workspaces !== undefined) next.workspaces = patchedGraph.normalizedWorkspaces;
    }

    const nodeUpserts = dto.patch.nodes?.upserts ?? [];
    const nodeDeleteIds = dto.patch.nodes?.deleteIds ?? [];
    const positionUpdates = dto.patch.nodes?.positionUpdates ?? [];
    if (nodeUpserts.length > 0 || nodeDeleteIds.length > 0 || positionUpdates.length > 0) {
      next.nodes = patchedGraph.nodes;
    }
    if (dto.patch.controlEdges !== undefined || nodeUpserts.length > 0 || nodeDeleteIds.length > 0) {
      next.controlEdges = patchedGraph.controlEdges;
    }
    if (dto.patch.dataBindings !== undefined || nodeUpserts.length > 0 || nodeDeleteIds.length > 0) {
      next.dataBindings = patchedGraph.dataBindings;
    }

    const state = this.castEditorState(next);
    if (idempotencyKey) {
      await this.idempotencyService.recordExpectedSaveState(
        ownerId,
        idempotencyKey,
        this.buildEditorStateHash(state),
        existing.definitionRevision + 1,
      );
    }

    const saved = await this.persistEditorWrite(
      flowId,
      String(existing.ownerId),
      dto.expectedDefinitionRevision,
      dto.expectedUpdatedAt,
      'Playbook changed since this autosave started.',
      existing,
      state,
    );

    const durationMs = Date.now() - startedAt;
    this.logger.log(`playbook_save_duration_ms mode=delta flowId=${flowId} durationMs=${durationMs}`);

    const response: {
      id: string;
      updatedAt: string;
      definitionRevision: number;
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
    } = {
      id: saved.id,
      updatedAt: saved.updatedAt.toISOString(),
      definitionRevision: saved.definitionRevision,
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
    writeCommitted = true;
    if (idempotencyKey) {
      try {
        await this.idempotencyService.confirmSaveResult(ownerId, idempotencyKey, response);
      } catch (err) {
        this.logger.warn(`Failed to record idempotent delta-save result for flow ${flowId}: ${(err as Error).message}`);
      }
    }
    return response;
    } catch (err) {
      if (idempotencyKey && reservedByRequest && !writeCommitted) {
        await this.idempotencyService.release(ownerId, idempotencyKey);
      }
      throw err;
    }
  }

  async findById(flowId: string): Promise<FlowRecord> {
    return this.accessService.findById(flowId);
  }

  async createWithNodesAndEdges(
    ownerId: string, name: string, description: string,
    nodes: any[], controlEdges: any[], dataBindings: any[],
    workspaces: string[] = [],
  ): Promise<IFlowResponse> {
    const normalizedWorkspaces = this.workspacePolicy.normalizeWorkspaces(workspaces);

    this.validatorService.validate(nodes as any, controlEdges as any, dataBindings as any, { allowDraftRouters: true });

    try {
      const saved = await this.flows.create({
        ownerId, schemaVersion: 1, name, description,
        nodes, controlEdges, dataBindings, workspaces: normalizedWorkspaces,
        settings: { recursionLimit: 25, maxParallelism: 5 },
        hitlPolicy: this.buildDefaultHitlPolicy() as unknown as HitlPolicy,
        hitlBlockers: this.buildDefaultHitlBlockers() as unknown as HitlBlockerRule[],
      });
      return toFlowJson(saved);
    } catch (err) {
      if (isUniqueViolation(err)) throw this.duplicateNameConflict(name);
      throw err;
    }
  }

  async updateNodesAndEdges(
    flowId: string, update: { nodes?: any[]; controlEdges?: any[]; dataBindings?: any[] },
  ): Promise<IFlowResponse> {
    if (update.nodes || update.controlEdges || update.dataBindings) {
      const existing = await this.flows.findById(flowId);
      if (!existing) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND);
      const graph = castFlowPatch({
        nodes: update.nodes ?? existing.nodes,
        controlEdges: update.controlEdges ?? existing.controlEdges,
        dataBindings: update.dataBindings ?? existing.dataBindings,
      });
      const workspaces = this.workspacePolicy.normalizeWorkspaces(existing.workspaces);

      const sanitizedGraph = this.graphSanitizer.sanitize({
        nodes: graph.nodes as any,
        controlEdges: graph.controlEdges as any,
        dataBindings: graph.dataBindings as any,
      });

      this.validatorService.validate(
        graph.nodes as any,
        sanitizedGraph.controlEdges,
        sanitizedGraph.dataBindings,
        { allowDraftRouters: true },
      );
      const saved = await this.flows.updateFields(flowId, {
        nodes: graph.nodes,
        controlEdges: sanitizedGraph.controlEdges,
        dataBindings: sanitizedGraph.dataBindings,
        ...(this.sameWorkspaces(workspaces, existing.workspaces) ? {} : { workspaces }),
      });
      if (!saved) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND);
      return toFlowJson(saved);
    }
    return this.findOne(flowId, '');
  }

  /** Deletes the flow; the foreign keys take its shares, workspace links and executions with it. */
  async remove(flowId: string, ownerId: string): Promise<void> {
    await this.accessService.findOwnedFlow(flowId, ownerId);
    await this.flows.deleteOwned(flowId, ownerId);
  }

  async clone(flowId: string, ownerId: string, nameSuffix?: string): Promise<IFlowResponse> {
    const existing = await this.accessService.findOwnedFlow(flowId, ownerId);

    const cloneName = nameSuffix ? `${existing.name} ${nameSuffix}` : `${existing.name} (copy)`;
    const normalizedWorkspaces = this.workspacePolicy.normalizeWorkspaces(existing.workspaces);

    try {
      const saved = await this.flows.create({
        ownerId,
        schemaVersion: existing.schemaVersion,
        name: cloneName,
        description: existing.description,
        triggerConfig: existing.triggerConfig,
        hitlPolicy: existing.hitlPolicy ?? (this.buildDefaultHitlPolicy() as unknown as HitlPolicy),
        hitlBlockers: existing.hitlBlockers ?? (this.buildDefaultHitlBlockers() as unknown as HitlBlockerRule[]),
        settings: existing.settings,
        nodes: existing.nodes,
        controlEdges: existing.controlEdges,
        dataBindings: existing.dataBindings,
        workspaces: normalizedWorkspaces,
        designSettings: existing.designSettings ?? undefined,
        isFavorite: existing.isFavorite,
        reflectionEnabled: existing.reflectionEnabled,
        advisorScoringMode: existing.advisorScoringMode ?? 'llm',
        advisorAutopilotEnabled: existing.advisorAutopilotEnabled,
        advisorAutopilotTargetScore: existing.advisorAutopilotTargetScore,
        advisorAutopilotMaxTurns: existing.advisorAutopilotMaxTurns,
      });
      return toFlowJson(saved);
    } catch (err) {
      if (isUniqueViolation(err)) throw this.duplicateNameConflict(cloneName);
      throw err;
    }
  }

  async findAllWithTriggerKind(kind: string): Promise<{ id: string; ownerId: string; triggerConfig: any }[]> {
    const flows = await this.flows.listByTrigger(kind);
    return flows.map((f) => ({
      id: f.id,
      ownerId: f.ownerId,
      triggerConfig: f.triggerConfig,
    }));
  }

  async toggleFavorite(flowId: string, ownerId: string): Promise<{ isFavorite: boolean }> {
    await this.accessService.findAccessibleFlow(flowId, ownerId, 'write');
    const isFavorite = await this.flows.toggleFavorite(flowId);
    if (isFavorite === null) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    return { isFavorite };
  }

  async bulkDelete(ids: string[], ownerId: string): Promise<{ deleted: number }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'No IDs provided');
    }
    const validIds = ids.filter((id) => isObjectId(id));
    if (validIds.length === 0) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'No valid IDs provided');
    }
    // The foreign keys take the shares of every deleted flow with it.
    const deleted = await this.flows.deleteManyOwned(validIds, ownerId);
    return { deleted: deleted.length };
  }

  async getActiveExecutions(ownerId: string): Promise<any[]> {
    const sharedFlowIds = await this.playbookShareService.getSharedPlaybookIdsForUser(ownerId);
    const executions = await this.executions.listActive(ownerId, sharedFlowIds);
    return executions.map(toExecutionJson);
  }

  async cloneShare(flowId: string, ownerId: string, emails: string[]): Promise<{ clone?: IFlowResponse; shared: string[] }> {
    const clone = await this.clone(flowId, ownerId, ' (shared)');
    return { clone, shared: emails };
  }
}
