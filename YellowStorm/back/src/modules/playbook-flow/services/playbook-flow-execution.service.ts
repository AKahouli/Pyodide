import { forwardRef, Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { AgentService } from '@modules/agent/agent.service';
import {
  FlowExecution,
  FlowExecutionDocument,
} from '../schemas/playbook-flow-execution.schema';
import { FlowTaskResult, FlowTaskResultDocument } from '../schemas/playbook-flow-task-result.schema';
import { FlowRouterDecision, FlowRouterDecisionDocument } from '../schemas/playbook-flow-router-decision.schema';
import { PlaybookFlowQueueService } from './playbook-flow-queue.service';
import { PlaybookFlowIdempotencyService } from './playbook-flow-idempotency.service';
import { PlaybookFlowService } from './playbook-flow.service';
import { FlowSnapshot } from '../mappers/flow-to-snapshot.mapper';
import { PlaybookFlowBuilderService } from './playbook-flow-builder.service';
import { PlaybookFlowValidatorService } from './playbook-flow-validator.service';
import { PlaybookFlowStreamEventsService } from './playbook-flow-stream-events.service';
import { PlaybookFlowExecutionAdvisorService } from './advisor/playbook-flow-execution-advisor.service';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '../../exceptions/exceptions/http.exceptions';
import {
  IFlowExecutionResponse,
  IFlowExecutionDetailResponse,
  IFlowExecutionListResponse,
  IFlowTaskResultResponse,
  IFlowRouterDecisionResponse,
  IResumeApprovalPayload,
  IResumeFromStepPayload,
  IRunFromStepPayload,
} from '../interfaces/playbook-flow-execution.interface';
import { IFlowResponse } from '../interfaces/playbook-flow.interface';
import { ControlEdge, DataBinding, FlowNode } from '../schemas/playbook-flow.schema';
import type { AdvisorScoringMode } from '../schemas/playbook-flow.schema';
import { PlaybookFlowObservabilityService } from './observability/playbook-flow-observability.service';
import { PlaybookFlowReplayArtifactService } from './playbook-flow-replay-artifact.service';
import { PlaybookFlowReplayPromptService } from './playbook-flow-replay-prompt.service';
import { PlaybookFlowReplayReportService } from './playbook-flow-replay-report.service';
import { PlaybookFlowReplayDriftService } from './playbook-flow-replay-drift.service';
import { PlaybookFlowReplayPlanService } from './playbook-flow-replay-plan.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { PlaybookFlowOutputFormatService } from './playbook-flow-output-format.service';
import { ModelsService } from '@modules/models/models.service';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import type { ResolvedReplayArtifacts } from '../interfaces/playbook-flow-replay-artifact.interface';
import type { ReplayPlanningSummary } from '../interfaces/playbook-flow-replay-plan.interface';
import {
  flattenUsage,
} from './observability/playbook-flow-observability.mapper';
import {
  FlowToolTraceItem,
  FlowLlmPromptTraceItem,
  FlowUsageSummary,
  FlowSemanticMatchSummary,
} from '../interfaces/playbook-flow-observability.interface';
import { PublicReasoningTraceItem } from '../interfaces/playbook-flow-reasoning.interface';
import { PlaybookFlowReplayPostRunEvaluationService } from './playbook-flow-replay-post-run-evaluation.service';
import { PlaybookFlowTokenBufferService } from './playbook-flow-token-buffer.service';
import { PlaybookFlowExecutionLeaseService } from './playbook-flow-execution-lease.service';
export { buildGrpcHumanApprovalConfig, toGrpcStruct, toGrpcValue } from '../execution/grpc/grpc-struct.mapper';
import { buildGrpcHumanApprovalConfig, toGrpcStruct, toGrpcValue } from '../execution/grpc/grpc-struct.mapper';
import { PlaybookFlowRuntimeClientService } from '../execution/grpc/playbook-flow-runtime-client.service';
import { FlowGraphSanitizerService } from '../domain/flow-graph-sanitizer.service';
import { PlaybookExecutionDispatcherService } from '../execution/runtime/playbook-execution-dispatcher.service';
import { PlaybookExecutionEventHandlerService } from '../execution/runtime/playbook-execution-event-handler.service';
import { PlaybookExecutionReplayRuntimeService } from '../execution/runtime/playbook-execution-replay-runtime.service';
import { PlaybookExecutionStreamFinalizerService } from '../execution/runtime/playbook-execution-stream-finalizer.service';
import { PlaybookExecutionHitlResumeService } from '../execution/runtime/playbook-execution-hitl-resume.service';
import {
  PlaybookExecutionSingleStepPrepService,
  SeededTaskOutput,
} from '../execution/runtime/playbook-execution-single-step-prep.service';
import { FlowHitlMemory, FlowHitlMemoryDocument } from '../schemas/playbook-flow-hitl-memory.schema';
import { FlowAccessService } from '../domain/flow-access.service';
import { PlaybookExecutionSettingsResolverService } from './playbook-execution-settings-resolver.service';
import { publicPlaybookTaskResult, sanitizePlaybookPublicValue } from '../utils/playbook-artifact';
import { PlaybookFlowArtifactService } from './playbook-flow-artifact.service';
import { FlowDynamicReasoningAttempt, FlowDynamicReasoningAttemptDocument } from '../schemas/playbook-flow-dynamic-reasoning-attempt.schema';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;
const RUNTIME_AGENT_METADATA_KEYS = [
  'agent_name',
  'agent_description',
  'agent_model',
  'agent_prompt',
  'agent_type',
  'agent_tools',
  'skills',
  'agent_params',
  'connector_bindings',
  'connector_ids',
  'brain_context',
] as const;

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function sanitizeExecutionSnapshotForResponse(
  snapshot?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!snapshot) return undefined;
  const { playbookPlanner: _planner, ...safeSnapshot } = snapshot;
  return safeSnapshot;
}

export function sanitizeExecutionForResponse(
  execution: IFlowExecutionResponse & {
    snapshot?: Record<string, unknown>;
    playbookPlannerSnapshot?: Record<string, unknown>;
  },
): IFlowExecutionResponse {
  const { playbookPlannerSnapshot: _plannerSnapshot, ...safeExecution } = execution;
  return {
    ...safeExecution,
    error: sanitizePlaybookPublicValue(safeExecution.error) as string | null | undefined,
    ...(safeExecution.snapshot
      ? { snapshot: sanitizeExecutionSnapshotForResponse(safeExecution.snapshot) }
      : {}),
  } as IFlowExecutionResponse;
}

function stripRuntimeAgentMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitizedMetadata = { ...metadata };
  for (const key of RUNTIME_AGENT_METADATA_KEYS) {
    delete sanitizedMetadata[key];
  }
  return sanitizedMetadata;
}

function getConnectorIdsFromRuntimeBindings(bindings: unknown): Set<string> {
  if (!Array.isArray(bindings)) {
    return new Set<string>();
  }

  return new Set(
    bindings
      .filter((binding): binding is Record<string, unknown> => !!binding && typeof binding === 'object' && !Array.isArray(binding))
      .map((binding) => String(binding.connector_id || '').trim())
      .filter(Boolean),
  );
}

function getSkillIdsFromRuntimeSkills(skills: unknown): Set<string> {
  if (!Array.isArray(skills)) {
    return new Set<string>();
  }

  return new Set(
    skills
      .filter((skill): skill is Record<string, unknown> => !!skill && typeof skill === 'object' && !Array.isArray(skill))
      .map((skill) => String(skill.id || '').trim())
      .filter(Boolean),
  );
}

function filterRuntimeHitlBlockers(blockers: unknown): Record<string, unknown>[] {
  if (!Array.isArray(blockers)) return [];
  return blockers.filter((blocker): blocker is Record<string, unknown> => (
    !!blocker
    && typeof blocker === 'object'
    && !Array.isArray(blocker)
    && blocker.enabled !== false
    && blocker.createdBy === 'user'
  ));
}

export function buildGrpcNodeMetadata(node: Record<string, unknown>, snapshot: Record<string, unknown>): Record<string, unknown> {
  const metadata = node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
    ? node.metadata as Record<string, unknown>
    : {};
  const flowHitlPolicy = snapshot.hitlPolicy;
  const nodeHitlPolicy = node.hitlPolicy ?? metadata.hitlPolicy ?? metadata.hitl_policy;
  const hitlBlockers = filterRuntimeHitlBlockers(snapshot.hitlBlockers);

  // Keep HITL contract data inside metadata until the runtime proto carries first-class flow-node fields.
  return {
    ...metadata,
    ...(node.interruptBefore !== undefined || metadata.interruptBefore !== undefined
      ? { interrupt_before: Boolean(node.interruptBefore ?? metadata.interruptBefore) }
      : {}),
    ...(node.interruptAfter !== undefined || metadata.interruptAfter !== undefined
      ? { interrupt_after: Boolean(node.interruptAfter ?? metadata.interruptAfter) }
      : {}),
    ...(node.allowClarification !== undefined || metadata.allowClarification !== undefined
      ? { allow_clarification: Boolean(node.allowClarification ?? metadata.allowClarification) }
      : {}),
    ...(typeof (node.clarificationPrompt ?? metadata.clarificationPrompt) === 'string'
      ? { clarification_prompt: node.clarificationPrompt ?? metadata.clarificationPrompt }
      : {}),
    ...(node.maxClarifications !== undefined || metadata.maxClarifications !== undefined
      ? { max_clarifications: Number(node.maxClarifications ?? metadata.maxClarifications) || 0 }
      : {}),
    ...(flowHitlPolicy || nodeHitlPolicy ? { hitl_policy: nodeHitlPolicy ?? flowHitlPolicy } : {}),
    ...(hitlBlockers.length ? { hitl_blockers: hitlBlockers } : {}),
  };
}

interface RuntimeHitlMemory {
  id: string;
  node_id: string | null;
  memory_type: string;
  title: string;
  normalized_instruction: string;
  content: string;
  applies_to: string;
  sensitivity: string;
}

@Injectable()
export class PlaybookFlowExecutionService implements OnModuleInit {
  private readonly logger = new Logger(PlaybookFlowExecutionService.name);
  private playbookFlowClient?: {
    Run?: (request: Record<string, unknown>) => any;
    RunFromCheckpoint?: (request: Record<string, unknown>) => any;
    Cancel?: (request: Record<string, unknown>, callback: (err: Error | null) => void) => void;
    ResumeApproval?: (request: Record<string, unknown>, callback: (err: Error | null) => void) => void;
    ResumeFromStep?: (request: Record<string, unknown>, callback: (err: Error | null) => void) => void;
  };
  private isGrpcAvailable = false;
  private fallbackExecutionDispatcherService?: PlaybookExecutionDispatcherService;
  private fallbackEventHandlerService?: PlaybookExecutionEventHandlerService;
  private fallbackReplayRuntimeService?: PlaybookExecutionReplayRuntimeService;
  private fallbackSingleStepPrepService?: PlaybookExecutionSingleStepPrepService;

  constructor(
    @InjectModel(FlowExecution.name)
    private readonly executionModel: Model<FlowExecutionDocument>,
    @InjectModel(FlowTaskResult.name)
    private readonly taskResultModel: Model<FlowTaskResultDocument>,
    @InjectModel(FlowRouterDecision.name)
    private readonly routerDecisionModel: Model<FlowRouterDecisionDocument>,
    private readonly configService: ConfigService,
    private readonly runtimeClient: PlaybookFlowRuntimeClientService,
    private readonly queueService: PlaybookFlowQueueService,
    private readonly idempotencyService: PlaybookFlowIdempotencyService,
    @Inject(forwardRef(() => PlaybookFlowService))
    private readonly flowService: PlaybookFlowService,
    private readonly builderService: PlaybookFlowBuilderService,
    private readonly validatorService: PlaybookFlowValidatorService,
    private readonly agentService: AgentService,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
    private readonly observabilityService: PlaybookFlowObservabilityService,
    @Inject(forwardRef(() => PlaybookFlowExecutionAdvisorService))
    private readonly advisorService: PlaybookFlowExecutionAdvisorService,
    private readonly replayArtifactService: PlaybookFlowReplayArtifactService,
    private readonly replayPromptService: PlaybookFlowReplayPromptService,
    private readonly replayReportService: PlaybookFlowReplayReportService,
    private readonly outputContractService: PlaybookFlowOutputContractService,
    private readonly modelsService: ModelsService,
    @Optional() private readonly outputFormatService?: PlaybookFlowOutputFormatService,
    @Optional() private readonly replayPlanService?: PlaybookFlowReplayPlanService,
    @Optional() private readonly replayDriftService?: PlaybookFlowReplayDriftService,
    @Optional() private readonly postRunEvaluationService?: PlaybookFlowReplayPostRunEvaluationService,
    @Optional() private readonly tokenBufferService?: PlaybookFlowTokenBufferService,
    @Optional() private readonly executionLeaseService?: PlaybookFlowExecutionLeaseService,
    @Optional() private readonly graphSanitizerService?: FlowGraphSanitizerService,
    @Optional() private readonly executionDispatcherService?: PlaybookExecutionDispatcherService,
    @Optional() private readonly eventHandlerService?: PlaybookExecutionEventHandlerService,
    @Optional() private readonly replayRuntimeService?: PlaybookExecutionReplayRuntimeService,
    @Optional() private readonly executionStreamFinalizerService?: PlaybookExecutionStreamFinalizerService,
    @Optional() private readonly workspaceService?: WorkspaceService,
    @Optional()
    @InjectModel(FlowHitlMemory.name)
    private readonly hitlMemoryModel?: Model<FlowHitlMemoryDocument>,
    @Optional() private readonly accessService?: FlowAccessService,
    @Optional() private readonly hitlResumeService?: PlaybookExecutionHitlResumeService,
    @Optional() private readonly singleStepPrepService?: PlaybookExecutionSingleStepPrepService,
    @Optional() private readonly executionSettingsResolver?: PlaybookExecutionSettingsResolverService,
    @Optional()
    @InjectModel(FlowDynamicReasoningAttempt.name)
    private readonly dynamicReasoningAttemptModel?: Model<FlowDynamicReasoningAttemptDocument>,
    @Optional() private readonly artifactService?: PlaybookFlowArtifactService,
  ) {
    this.hitlResumeService?.bindExecutionHost({
      isRuntimeAvailable: () => this.isRuntimeAvailable(),
      resumeApprovalRuntime: (request, callback) => this.resumeApprovalRuntime(request, callback),
      resumeFromStepRuntime: (request, callback) => this.resumeFromStepRuntime(request, callback),
      scheduleDurableResume: (ownerId) => this.scheduleQueueDrain(ownerId),
    });
  }

  private requireAccessService(): FlowAccessService {
    if (!this.accessService) {
      throw new Error('FlowAccessService is required for playbook execution authorization');
    }
    return this.accessService;
  }

  private getReplayRuntime(): PlaybookExecutionReplayRuntimeService {
    if (this.replayRuntimeService) {
      return this.replayRuntimeService;
    }
    this.fallbackReplayRuntimeService ??= new PlaybookExecutionReplayRuntimeService(
        this.executionModel,
        this.replayArtifactService,
        this.replayReportService,
        this.outputContractService,
        this.replayPlanService,
        this.replayDriftService,
        this.postRunEvaluationService,
      );
    return this.fallbackReplayRuntimeService;
  }

  private async resolvePlaybookPlanner(
    agentId: string,
    flowSettings?: Record<string, unknown>,
  ) {
    if (this.executionSettingsResolver) {
      return this.executionSettingsResolver.resolvePlanner(agentId, flowSettings);
    }
    const planner = await this.agentService.findPlaybookPlannerById(agentId);
    if (!planner.model) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }
    return { ...planner, omitTemperature: false };
  }

  private getEventHandler(): PlaybookExecutionEventHandlerService {
    if (this.eventHandlerService) {
      return this.eventHandlerService;
    }
    this.fallbackEventHandlerService ??= new PlaybookExecutionEventHandlerService(
      this.executionModel,
      this.taskResultModel,
      this.routerDecisionModel,
      this.streamEvents,
      this.observabilityService,
      this.advisorService,
      this.getReplayRuntime(),
      undefined,
      this.tokenBufferService,
    );
    return this.fallbackEventHandlerService;
  }

  onModuleInit() {
    this.runtimeClient.init();
    if (this.isRuntimeAvailable()) {
      this.recoverStaleRunningExecutions()
        .then(() => this.recoverQueuedExecutions())
        .catch((err) => {
          this.logger.error('Failed to recover queued executions', err instanceof Error ? err.stack : undefined);
        });
    }
  }

  private async reconcileOrphanedExecutions(): Promise<void> {
    // This remains disabled until execution ownership is persisted and validated.
  }

  private async buildNodeRuntimeAgentMetadata(
    ownerId: string,
    nodeId: string,
    baseMetadata: Record<string, unknown>,
    resolvedAgent?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    if (!resolvedAgent) {
      return resolvedAgent;
    }

    const taskToolBindings = Array.isArray(baseMetadata.toolBindings)
      ? baseMetadata.toolBindings.filter((binding): binding is Record<string, unknown> => (
        !!binding && typeof binding === 'object' && !Array.isArray(binding)
      ))
      : [];

    if (taskToolBindings.length === 0) {
      return this.mergeNodeRuntimeSkills(ownerId, nodeId, baseMetadata, resolvedAgent);
    }

    const existingConnectorIds = new Set([
      ...getConnectorIdsFromRuntimeBindings(resolvedAgent.connector_bindings),
      ...((Array.isArray(resolvedAgent.connector_ids) ? resolvedAgent.connector_ids : [])
        .map((connectorId) => String(connectorId || '').trim())
        .filter(Boolean)),
    ]);

    const additionalBindings: Record<string, unknown>[] = [];
    const seenConnectorIds = new Set<string>();

    for (const binding of taskToolBindings) {
      if (binding.isEnabled === false) {
        continue;
      }

      const connectorId = String(binding.connectorId || '').trim();
      if (!connectorId || existingConnectorIds.has(connectorId) || seenConnectorIds.has(connectorId)) {
        continue;
      }

      seenConnectorIds.add(connectorId);
      additionalBindings.push(binding);
    }

    if (additionalBindings.length === 0) {
      return this.mergeNodeRuntimeSkills(ownerId, nodeId, baseMetadata, resolvedAgent);
    }

    const additionalRuntime = await this.agentService.buildGrpcConnectorRuntimeForPlaybook(ownerId, additionalBindings);
    if (additionalRuntime.connector_bindings.length === 0) {
      this.logger.warn('Skipped playbook task connector bindings without runtime actions', {
        ownerId,
        nodeId,
        connectorIds: additionalBindings.map((binding) => String(binding.connectorId || '')).filter(Boolean),
      });
      return this.mergeNodeRuntimeSkills(ownerId, nodeId, baseMetadata, resolvedAgent);
    }

    const mergedConnectorBindings = [
      ...(Array.isArray(resolvedAgent.connector_bindings) ? resolvedAgent.connector_bindings : []),
      ...additionalRuntime.connector_bindings,
    ];
    const existingSkillIds = getSkillIdsFromRuntimeSkills(resolvedAgent.skills);
    const additionalConnectorSkills = (Array.isArray(additionalRuntime.skills) ? additionalRuntime.skills : [])
      .filter((skill): skill is Record<string, unknown> => !!skill && typeof skill === 'object' && !Array.isArray(skill))
      .filter((skill) => {
        const skillId = String(skill.id || '').trim();
        return !!skillId && !existingSkillIds.has(skillId);
      });

    return this.mergeNodeRuntimeSkills(ownerId, nodeId, baseMetadata, {
      ...resolvedAgent,
      agent_tools: [
        ...(Array.isArray(resolvedAgent.agent_tools) ? resolvedAgent.agent_tools : []),
        ...additionalRuntime.tools,
      ],
      skills: [
        ...(Array.isArray(resolvedAgent.skills) ? resolvedAgent.skills : []),
        ...additionalConnectorSkills,
      ],
      agent_params: {
        ...(resolvedAgent.agent_params && typeof resolvedAgent.agent_params === 'object' && !Array.isArray(resolvedAgent.agent_params)
          ? resolvedAgent.agent_params as Record<string, unknown>
          : {}),
        connector_bindings_json: JSON.stringify(mergedConnectorBindings),
      },
      connector_bindings: mergedConnectorBindings,
      connector_ids: [
        ...existingConnectorIds,
        ...additionalRuntime.connectorIds,
      ],
    });
  }

  private async mergeNodeRuntimeSkills(
    ownerId: string,
    nodeId: string,
    baseMetadata: Record<string, unknown>,
    resolvedAgent: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const taskSkillBindings = Array.isArray(baseMetadata.skillBindings)
      ? baseMetadata.skillBindings.filter((binding): binding is Record<string, unknown> => (
        !!binding && typeof binding === 'object' && !Array.isArray(binding)
      ))
      : [];

    if (taskSkillBindings.length === 0) {
      return resolvedAgent;
    }

    const existingSkillIds = getSkillIdsFromRuntimeSkills(resolvedAgent.skills);
    const additionalSkillIds = [...new Set(taskSkillBindings
      .filter((binding) => binding.isEnabled !== false)
      .map((binding) => String(binding.skillId || '').trim())
      .filter((skillId) => skillId && !existingSkillIds.has(skillId)))];

    if (additionalSkillIds.length === 0) {
      return resolvedAgent;
    }

    const additionalSkills = await this.agentService.buildGrpcSkillsForPlaybook(additionalSkillIds);
    if (additionalSkills.length === 0) {
      this.logger.warn('Skipped playbook task skill bindings without active runtime skills', {
        ownerId,
        nodeId,
        skillIds: additionalSkillIds,
      });
      return resolvedAgent;
    }

    return {
      ...resolvedAgent,
      skills: [
        ...(Array.isArray(resolvedAgent.skills) ? resolvedAgent.skills : []),
        ...additionalSkills,
      ],
    };
  }

  private cacheSelectedReplayArtifacts(
    executionId: string,
    taskId: string,
    artifacts: ResolvedReplayArtifacts,
  ): void {
    this.getReplayRuntime().cacheSelectedArtifacts(executionId, taskId, artifacts);
  }

  private trackReplayTask(executionId: string, taskId: string): void {
    this.getReplayRuntime().trackTask(executionId, taskId);
  }

  private hasTrackedReplayTask(executionId: string, taskId: string): boolean {
    return this.getReplayRuntime().hasTrackedTask(executionId, taskId);
  }

  private getSelectedReplayArtifacts(
    executionId: string,
    taskId: string,
  ): ResolvedReplayArtifacts | null {
    return this.getReplayRuntime().getSelectedArtifacts(executionId, taskId);
  }

  private async resolveReplayArtifactsForCompletedTask(
    executionId: string,
    taskId: string,
    iteration: number,
  ): Promise<ResolvedReplayArtifacts | null> {
    return this.getReplayRuntime().resolveArtifactsForCompletedTask(executionId, taskId, iteration);
  }

  private clearSelectedReplayArtifacts(executionId: string): void {
    this.getReplayRuntime().clear(executionId);
  }

  private buildReplayPlanning(
    artifacts: ResolvedReplayArtifacts,
    input: {
      taskId: string;
      inputContext?: Record<string, unknown>;
      taskTitle?: string | null;
      taskDescription?: string | null;
    },
  ): ReplayPlanningSummary {
    const replayPlanService = this.replayPlanService ?? new PlaybookFlowReplayPlanService();
    return replayPlanService.buildReplayPlanning({
      taskId: input.taskId,
      replayId: artifacts.replayId,
      validationVersion: artifacts.validationVersion,
      intentKey: artifacts.intentKey,
      intentLabel: artifacts.intentLabel,
      contextVariableSchema: artifacts.contextVariableSchema,
      reasoningOutline: artifacts.reasoningOutline,
      toolTraceTemplate: artifacts.toolTraceTemplate,
      semanticChecklist: artifacts.semanticChecklist,
      toolCalls: artifacts.toolCalls,
      outputFormatGuide: artifacts.outputFormatGuide,
      outputContract: artifacts.outputContract,
      inputContext: input.inputContext,
      taskTitle: input.taskTitle,
      taskDescription: input.taskDescription,
    });
  }

  private resolveStepExecutionMode(
    node: { id: string; metadata?: Record<string, unknown> },
    stepModes: Record<string, string>,
    globalExecMode: string,
    validStepModes: Set<string>,
  ): string {
    const savedStepMode = typeof node.metadata?.stepReplayMode === 'string'
      ? node.metadata.stepReplayMode
      : undefined;
    const rawStepMode = stepModes[node.id] || savedStepMode || (globalExecMode === 'inherit' ? 'live' : globalExecMode);
    return validStepModes.has(rawStepMode) ? rawStepMode : 'live';
  }

  /** Keeps runtime HITL memory payloads lean and stable across the NestJS to ADK boundary. */
  private mapRuntimeHitlMemories(memories: Array<Record<string, unknown>>): RuntimeHitlMemory[] {
    return memories.map((memory) => ({
      id: String(memory.id || memory._id || ''),
      node_id: memory.nodeId == null ? null : String(memory.nodeId),
      memory_type: String(memory.memoryType || 'procedural'),
      title: String(memory.title || ''),
      normalized_instruction: String(memory.normalizedInstruction || memory.content || ''),
      content: String(memory.content || ''),
      applies_to: String(memory.appliesTo || 'workflow'),
      sensitivity: String(memory.sensitivity || 'normal'),
    }));
  }

  private async loadActiveHitlMemories(
    flowId: string,
    taskIds: string[],
  ): Promise<RuntimeHitlMemory[]> {
    if (!this.hitlMemoryModel) {
      return [];
    }

    const uniqueTaskIds = Array.from(new Set(taskIds.filter(Boolean)));
    const memories = await this.hitlMemoryModel.find({
      flowId,
      status: 'active',
      $or: [
        { nodeId: null },
        { nodeId: { $exists: false } },
        ...(uniqueTaskIds.length > 0 ? [{ nodeId: { $in: uniqueTaskIds } }] : []),
      ],
    }).lean().exec() as Array<Record<string, unknown>>;

    return this.mapRuntimeHitlMemories(memories);
  }

  private buildRuntimeInputContext(
    inputContext: Record<string, unknown>,
    activeHitlMemories: RuntimeHitlMemory[],
  ): Record<string, unknown> {
    const { __playbook_hitl_memory: _ignoredHitlMemory, ...safeInputContext } = inputContext;
    return {
      ...safeInputContext,
      __playbook_hitl_memory: activeHitlMemories,
    };
  }

  private async recoverQueuedExecutions(): Promise<void> {
    const owners = await this.executionModel.distinct('ownerId', { status: 'queued' });
    for (const ownerId of owners as string[]) {
      this.scheduleQueueDrain(ownerId);
    }
  }

  private async recoverStaleRunningExecutions(): Promise<void> {
    if (!this.executionLeaseService?.isEnabled()) return;

    const startupTimeoutMs = this.configService.get<number>('playbook-flow.executionStartupTimeoutMs', 180_000);
    const staleBefore = new Date(Date.now() - startupTimeoutMs);
    const staleExecutions = await this.executionModel.find(
      { status: 'running', startedAt: { $lte: staleBefore } },
      'ownerId queuePosition startedAt',
    ).lean().exec();

    for (const execution of staleExecutions as Array<Record<string, unknown>>) {
      const executionId = String(execution._id);
      const activeLease = await this.executionLeaseServiceHasLease(executionId);
      if (activeLease) {
        continue;
      }

      this.logger.warn(`Re-queueing stale running execution ${executionId} without an active lease`);
      await this.executionModel.updateOne(
        { _id: executionId, status: 'running' },
        {
          $set: {
            status: 'queued',
            queuePosition: 0,
            error: null,
          },
          $unset: { startedAt: 1 },
        },
      ).exec();

      const ownerId = String(execution.ownerId || '');
      const changes = await this.queueService.refreshPositions(ownerId);
      for (const { executionId: queuedExecutionId, queuePosition } of changes) {
        this.streamEvents.emitQueuePositionUpdate(queuedExecutionId, queuePosition);
      }
    }
  }

  private async executionLeaseServiceHasLease(executionId: string): Promise<boolean> {
    if (!this.executionLeaseService?.isEnabled()) {
      return false;
    }
    return this.executionLeaseService.hasActiveLease(executionId);
  }

  private async releaseExecutionLease(executionId: string): Promise<void> {
    await this.executionLeaseService?.release(executionId);
  }

  private getStreamFinalizer(): PlaybookExecutionStreamFinalizerService {
    return this.executionStreamFinalizerService
      ?? new PlaybookExecutionStreamFinalizerService(
        this.executionModel,
        this.taskResultModel,
        this.streamEvents,
        this.tokenBufferService,
        this.executionLeaseService,
      );
  }

  private isRuntimeAvailable(): boolean {
    return this.runtimeClient.isAvailable() || this.isGrpcAvailable;
  }

  private runRuntime(request: Record<string, unknown>): any {
    return this.playbookFlowClient?.Run?.(request) ?? this.runtimeClient.run(request);
  }

  private runFromCheckpointRuntime(request: Record<string, unknown>): any {
    return this.playbookFlowClient?.RunFromCheckpoint?.(request) ?? this.runtimeClient.runFromCheckpoint(request);
  }

  private cancelRuntime(request: Record<string, unknown>, callback: (err: Error | null) => void): void {
    this.playbookFlowClient?.Cancel?.(request, callback) ?? this.runtimeClient.cancel(request, callback);
  }

  private resumeApprovalRuntime(
    request: Record<string, unknown>,
    callback: (err: Error | null, response?: { resumed?: boolean }) => void,
  ): void {
    this.playbookFlowClient?.ResumeApproval?.(request, callback) ?? this.runtimeClient.resumeApproval(request, callback);
  }

  private resumeFromStepRuntime(
    request: Record<string, unknown>,
    callback: (err: Error | null, response?: { resumed?: boolean }) => void,
  ): void {
    this.playbookFlowClient?.ResumeFromStep?.(request, callback) ?? this.runtimeClient.resumeFromStep(request, callback);
  }

  private async loadFlowForExecutionStart(flowId: string, ownerId: string): Promise<IFlowResponse> {
    if (typeof this.flowService.findOneForExecutionStart === 'function') {
      return this.flowService.findOneForExecutionStart(flowId, ownerId);
    }
    return this.flowService.findOne(flowId, ownerId);
  }

  private getGraphSanitizerService(): FlowGraphSanitizerService {
    return this.graphSanitizerService ?? new FlowGraphSanitizerService();
  }

  private resolveLeaseModelScope(execution: Record<string, unknown>): { providerKey?: string; modelKey?: string } {
    const modelKey = typeof execution.modelIdOverride === 'string' && execution.modelIdOverride.trim()
      ? execution.modelIdOverride.trim()
      : this.findFirstSnapshotModel(execution.snapshot as Record<string, unknown> | undefined);
    if (!modelKey) return {};
    const [providerKey] = modelKey.includes('/') ? modelKey.split('/', 1) : ['default'];
    return { providerKey, modelKey };
  }

  private findFirstSnapshotModel(snapshot?: Record<string, unknown>): string | undefined {
    const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
    for (const node of nodes as Array<Record<string, unknown>>) {
      const metadata = node.metadata as Record<string, unknown> | undefined;
      const model = metadata?.modelId ?? metadata?.model_id ?? metadata?.agent_model;
      if (typeof model === 'string' && model.trim()) {
        return model.trim();
      }
    }
    return undefined;
  }

  private scheduleQueueDrain(ownerId: string): void {
    const dispatcher = this.executionDispatcherService
      ?? (this.fallbackExecutionDispatcherService ??= new PlaybookExecutionDispatcherService(this.configService));
    dispatcher.schedule(ownerId, (queuedOwnerId) => this.drainQueue(queuedOwnerId));
  }

  private async prepareExecutionStartFlow(
    flowId: string,
    ownerId: string,
    singleStepTaskId?: string,
  ): Promise<IFlowResponse> {
    const preflightStartedAt = Date.now();
    const flow = await this.loadFlowForExecutionStart(flowId, ownerId);
    this.logger.log(
      `playbook_execution_start_preflight_ms flowId=${flowId} nodeCount=${flow.nodes?.length ?? 0} edgeCount=${flow.controlEdges?.length ?? 0} durationMs=${Date.now() - preflightStartedAt}`,
    );

    const sanitizedGraph = this.getGraphSanitizerService().sanitize({
      nodes: flow.nodes,
      controlEdges: flow.controlEdges,
      dataBindings: flow.dataBindings,
      edgeAction: 'Cleaning',
      bindingAction: 'Cleaning',
    });

    if (
      sanitizedGraph.removedOrphanedEdgeCount > 0
      || sanitizedGraph.removedOrphanedBindingCount > 0
      || sanitizedGraph.removedStaleBindingCount > 0
    ) {
      this.logger.warn(
        `Cleaned ${sanitizedGraph.removedOrphanedEdgeCount} orphaned edge(s), ${sanitizedGraph.removedOrphanedBindingCount} orphaned binding(s), and ${sanitizedGraph.removedStaleBindingCount} stale binding(s) for flow ${flowId}`,
      );
      const doc = await this.flowService.findById(flowId);
      doc.controlEdges = sanitizedGraph.controlEdges as any;
      doc.dataBindings = sanitizedGraph.dataBindings as any;
      await doc.save();
      flow.controlEdges = sanitizedGraph.controlEdges as any;
      flow.dataBindings = sanitizedGraph.dataBindings as any;
    }

    this.validatorService.validate(flow.nodes, flow.controlEdges, flow.dataBindings, {
      ...(singleStepTaskId ? { requiredBindingNodeIds: [singleStepTaskId] } : {}),
    });

    return flow;
  }

  async start(
    flowId: string,
    ownerId: string,
    inputContext?: Record<string, unknown>,
    idempotencyKey?: string,
    singleStepTaskId?: string,
    advisorAutopilotEnabled?: boolean,
    advisorAutopilotTargetScore?: number,
    advisorAutopilotMaxTurns?: number,
    reflectionEnabled?: boolean,
    advisorScoringMode?: AdvisorScoringMode,
    executionMode?: string,
    stepExecutionModes?: Record<string, string>,
    modelIdOverride?: string,
  ): Promise<IFlowExecutionResponse> {
    const flow = await this.prepareExecutionStartFlow(flowId, ownerId, singleStepTaskId);

    if (singleStepTaskId) {
      this.assertSingleStepSupported(flow.nodes, singleStepTaskId);
      this.assertSingleStepControlDependenciesSupported(flow.nodes, flow.controlEdges, singleStepTaskId);
    }

    const effectiveExecutionSettings = this.executionSettingsResolver
      ? await this.executionSettingsResolver.resolve(flow.settings)
      : null;
    const maxConcurrent = effectiveExecutionSettings?.maxConcurrentPerUser
      ?? this.configService.get<number>('playbook-flow.maxConcurrentPerUser', 10);
    const maxDepth = effectiveExecutionSettings?.executionQueueMaxDepth
      ?? this.configService.get<number>('playbook-flow.executionQueueMaxDepth', 50);
    const recursionLimit = effectiveExecutionSettings
      ? Math.min(flow.settings?.recursionLimit || effectiveExecutionSettings.recursionLimitDefault, effectiveExecutionSettings.recursionLimitMax)
      : flow.settings?.recursionLimit || 25;
    const maxParallelism = effectiveExecutionSettings?.effectiveExecutionParallelism
      ?? (flow.settings?.maxParallelism || 5);

    if (idempotencyKey) {
      const reservation = await this.idempotencyService.reserve(ownerId, idempotencyKey, {
        flowId,
        inputContext: inputContext ?? {},
        executionMode: executionMode || 'live',
        stepExecutionModes: stepExecutionModes || {},
        modelIdOverride: modelIdOverride || undefined,
      });
      if (reservation.type === 'duplicate') {
        const existingExecution = await this.executionModel.findById(reservation.executionId);
        if (!existingExecution) {
          throw new ConflictException(
            ErrorCode.CONFLICT,
            'Idempotency record points to a missing execution. Retry with a new key.',
          );
        }
        return sanitizeExecutionForResponse(
          existingExecution.toJSON() as unknown as IFlowExecutionResponse,
        );
      }
    }

    if (modelIdOverride) {
      let validation;
      try {
        validation = await this.modelsService.validateModelActive(modelIdOverride);
      } catch (err) {
        if (idempotencyKey) {
          await this.idempotencyService.release(ownerId, idempotencyKey);
        }
        throw err;
      }
      if (!validation.valid) {
        if (idempotencyKey) {
          await this.idempotencyService.release(ownerId, idempotencyKey);
        }
        throw new BadRequestException(
          ErrorCode.MODEL_INACTIVE,
          `Model override '${modelIdOverride}' is unavailable or inactive.`,
        );
      }
    }

    const fullSnapshot = this.builderService.buildSnapshot(flow as any);
    const executableSnapshot = this.buildExecutableSnapshot(fullSnapshot, flowId);

    let snapshot: any;
    let seededTaskOutputs: SeededTaskOutput[] = [];
    if (singleStepTaskId) {
      const allNodes = (executableSnapshot as any).nodes || [];
      const targetNode = allNodes.find((n: any) => n.id === singleStepTaskId);
      if (!targetNode) {
        throw new BadRequestException(
          ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
          `Single-step target node ${singleStepTaskId} not found`,
        );
      }
      const targetBindings = ((executableSnapshot as any).dataBindings || [])
        .filter((binding: DataBinding) => binding.targetNode === singleStepTaskId);
      snapshot = {
        ...executableSnapshot,
        nodes: [targetNode],
        controlEdges: [],
        dataBindings: targetBindings,
      };
      seededTaskOutputs = await this.buildSeededTaskOutputsForSingleStep(
        flowId,
        ownerId,
        singleStepTaskId,
        executableSnapshot,
        targetBindings,
      );
    } else {
      snapshot = executableSnapshot;
    }
    const hasDynamicReasoningNode = ((snapshot.nodes ?? []) as FlowNode[])
      .some((node) => node.dynamicReasoning?.enabled === true);
    const planner = effectiveExecutionSettings?.dynamicReasoningEnabled && hasDynamicReasoningNode
      ? await this.resolvePlaybookPlanner(
        effectiveExecutionSettings.dynamicReasoning.plannerAgentId || '',
        snapshot.settings as Record<string, unknown> | undefined,
      )
      : null;
    const playbookPlannerSnapshot = planner ? {
      agentId: planner.agentId,
      agentTypeSlug: planner.agentTypeSlug,
      model: planner.model,
      systemPrompt: planner.instruction,
      temperature: planner.temperature,
      omitTemperature: planner.omitTemperature,
      promptHash: `sha256:${createHash('sha256').update(planner.instruction).digest('hex')}`,
      agentRevision: planner.agentRevision,
      planningContractVersion: '1',
    } : undefined;
    snapshot = {
      ...snapshot,
      ...(effectiveExecutionSettings ? { playbookExecutionSettings: effectiveExecutionSettings } : {}),
      ...(playbookPlannerSnapshot ? { playbookPlanner: playbookPlannerSnapshot } : {}),
    };

    const enabledAutopilot = advisorAutopilotEnabled ?? (flow as any).advisorAutopilotEnabled ?? false;
    const enabledReflection = reflectionEnabled ?? (flow as any).reflectionEnabled ?? false;
    const resolvedAdvisorScoringMode = advisorScoringMode ?? (flow as any).advisorScoringMode ?? 'llm';
    const execution = new this.executionModel({
      flowId,
      ownerId,
      schemaVersion: 1,
      status: 'queued',
      recursionLimit,
      maxParallelism,
      playbookExecutionSettings: effectiveExecutionSettings ?? undefined,
      playbookPlannerSnapshot,
      inputContext,
      idempotencyKey,
      snapshot,
      singleStepTaskId: singleStepTaskId || undefined,
      advisorAutopilotEnabled: enabledAutopilot,
      advisorAutopilotTargetScore: advisorAutopilotTargetScore ?? (flow as any).advisorAutopilotTargetScore ?? undefined,
      advisorAutopilotMaxTurns: advisorAutopilotMaxTurns ?? (flow as any).advisorAutopilotMaxTurns ?? undefined,
      reflectionEnabled: enabledReflection,
      advisorScoringMode: resolvedAdvisorScoringMode,
      seededTaskOutputs,
      executionMode: executionMode || 'live',
      stepExecutionModes: stepExecutionModes || {},
      modelIdOverride: modelIdOverride || undefined,
    });

    const saved = await execution.save();

    if (idempotencyKey) {
      try {
        await this.idempotencyService.confirmLink(ownerId, idempotencyKey, saved.id);
      } catch (err) {
        await this.executionModel.findByIdAndDelete(saved.id);
        await this.idempotencyService.release(ownerId, idempotencyKey);
        throw err;
      }
    }

    const position = await this.queueService.admit(ownerId, saved.id, maxConcurrent, maxDepth);
    if (position < 0) {
      await this.executionModel.findByIdAndDelete(saved.id);
      if (idempotencyKey) {
        await this.idempotencyService.release(ownerId, idempotencyKey);
      }
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_QUEUE_FULL,
        'Execution queue is full. Please try again later.',
      );
    }

    saved.queuePosition = position;
    await saved.save();

    this.scheduleQueueDrain(ownerId);

    return sanitizeExecutionForResponse(saved.toJSON() as unknown as IFlowExecutionResponse);
  }

  private assertSingleStepSupported(
    nodes: FlowNode[],
    singleStepTaskId: string,
  ): void {
    this.requireSingleStepPrepService().assertSingleStepSupported(nodes, singleStepTaskId);
  }

  private buildExecutableSnapshot(snapshot: FlowSnapshot, flowId: string): FlowSnapshot {
    return this.requireSingleStepPrepService().buildExecutableSnapshot(snapshot, flowId);
  }

  /**
   * Collect every workspaceId referenced by a constant-value file binding.
   * Constant values are file references (`{ workspaceId, name, path, ... }`) or
   * arrays of them, so we scan both shapes. Used to resolve their storage paths
   * in a single query before serializing the bindings for the runtime.
   */
  private collectBindingWorkspaceIds(dataBindings: any[]): string[] {
    const ids = new Set<string>();
    const scan = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(scan);
        return;
      }
      const workspaceId = (value as Record<string, unknown>).workspaceId;
      if (typeof workspaceId === 'string' && workspaceId) ids.add(workspaceId);
    };
    for (const binding of dataBindings) scan(binding?.constantValue);
    return [...ids];
  }

  /**
   * Add the `{ownerUserId}/{storagePrefix}` workspacePath next to the workspaceId
   * carried by a constant-value file binding, so the runtime gets the storage
   * path alongside the existing workspaceId / file name / file path. Handles both
   * a single file reference and an array of them; references without a resolvable
   * workspaceId are returned unchanged.
   */
  private enrichConstantValueWithWorkspacePath(
    constantValue: unknown,
    workspacePathsById: Record<string, string>,
  ): unknown {
    const enrichOne = (value: unknown): unknown => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const record = value as Record<string, unknown>;
      const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId : '';
      const workspacePath = workspaceId ? workspacePathsById[workspaceId] : undefined;
      return workspacePath ? { ...record, workspacePath } : value;
    };
    if (Array.isArray(constantValue)) return constantValue.map(enrichOne);
    return enrichOne(constantValue);
  }

  /**
   * Serialize a snapshot's data bindings to the proto shape, enriching each
   * constant-value file reference with its workspacePath. `knownWorkspacePaths`
   * holds paths already resolved for the run's selected workspaces; any extra
   * workspaceIds referenced only by bindings are resolved here in one query.
   */
  private async buildDataBindingsProto(
    dataBindings: any[],
    knownWorkspacePaths: Record<string, string> = {},
  ): Promise<any[]> {
    const referenced = this.collectBindingWorkspaceIds(dataBindings);
    const missing = referenced.filter((id) => !(id in knownWorkspacePaths));
    const resolvedMissing = missing.length > 0 && this.workspaceService
      ? await this.workspaceService.getStoragePathMapByIds(missing)
      : {};
    const workspacePathsById = { ...knownWorkspacePaths, ...resolvedMissing };

    return dataBindings.map((b) => ({
      id: b.id,
      target_node: b.targetNode,
      target_port: b.targetPort,
      source_kind: b.sourceKind,
      source_node: b.sourceNode || '',
      source_port: b.sourcePort || '',
      iteration: b.iteration || '',
      trigger_path: b.triggerPath || '',
      state_path: b.statePath || '',
      constant_value: toGrpcValue(
        this.enrichConstantValueWithWorkspacePath(b.constantValue, workspacePathsById),
      ),
      expression: b.expression || '',
    }));
  }

  private assertSingleStepControlDependenciesSupported(
    nodes: FlowNode[],
    controlEdges: ControlEdge[],
    singleStepTaskId: string,
  ): void {
    this.requireSingleStepPrepService().assertSingleStepControlDependenciesSupported(
      nodes,
      controlEdges,
      singleStepTaskId,
    );
  }

  private async buildSeededTaskOutputsForSingleStep(
    flowId: string,
    ownerId: string,
    singleStepTaskId: string,
    currentSnapshot: FlowSnapshot,
    bindings: DataBinding[],
  ): Promise<SeededTaskOutput[]> {
    return this.requireSingleStepPrepService().buildSeededTaskOutputsForSingleStep(
      flowId,
      ownerId,
      singleStepTaskId,
      currentSnapshot,
      bindings,
    );
  }

  private requireSingleStepPrepService(): PlaybookExecutionSingleStepPrepService {
    if (this.singleStepPrepService) {
      return this.singleStepPrepService;
    }
    this.fallbackSingleStepPrepService ??= new PlaybookExecutionSingleStepPrepService(
      this.executionModel,
      this.taskResultModel,
    );
    return this.fallbackSingleStepPrepService;
  }

  private async callGrpcRun(
    executionId: string,
    flowId: string,
    ownerId: string,
    flow: Record<string, unknown> | null,
    inputContext?: Record<string, unknown>,
    snapshotOverride?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const snapshot = (snapshotOverride || this.builderService.buildSnapshot((flow || {}) as any)) as any;
      const recursionLimit = snapshot.settings?.recursionLimit || 25;
      const maxParallelism = snapshot.settings?.maxParallelism || 5;
      const normalizedOwnerId = typeof ownerId === 'string' ? ownerId : String(ownerId);
      const effectiveExecutionSettings = snapshot.playbookExecutionSettings
        ?? (this.executionSettingsResolver ? await this.executionSettingsResolver.resolve(snapshot.settings) : null);
      const hasDynamicReasoningNode = (snapshot.nodes as any[]).some(
        (node) => node.dynamicReasoning?.enabled === true,
      );
      const persistedPlanner = snapshot.playbookPlanner as Record<string, unknown> | undefined;
      const planner = !persistedPlanner && effectiveExecutionSettings?.dynamicReasoningEnabled && hasDynamicReasoningNode
        ? await this.resolvePlaybookPlanner(
          effectiveExecutionSettings.dynamicReasoning.plannerAgentId || '',
          snapshot.settings as Record<string, unknown> | undefined,
        )
        : null;
      const plannerSnapshot = persistedPlanner ? {
        agent_id: persistedPlanner.agentId,
        agent_type_slug: persistedPlanner.agentTypeSlug,
        model: persistedPlanner.model,
        system_prompt: persistedPlanner.systemPrompt,
        temperature: persistedPlanner.temperature,
        omit_temperature: persistedPlanner.omitTemperature,
        prompt_hash: persistedPlanner.promptHash,
        agent_revision: persistedPlanner.agentRevision,
      } : planner ? {
        agent_id: planner.agentId,
        agent_type_slug: planner.agentTypeSlug,
        model: planner.model,
        system_prompt: planner.instruction,
        temperature: planner.temperature,
        omit_temperature: planner.omitTemperature,
        prompt_hash: `sha256:${createHash('sha256').update(planner.instruction).digest('hex')}`,
        agent_revision: planner.agentRevision,
      } : undefined;
      if (effectiveExecutionSettings) {
        await this.executionModel.updateOne(
          { _id: executionId },
          { $set: { playbookExecutionSettings: effectiveExecutionSettings } },
        ).exec();
      }

      // Resolve agents referenced by nodes and enrich metadata
      const agentIds = new Set<string>();
      for (const node of snapshot.nodes as any[]) {
        const assignedAgentId = node.metadata?.assignedAgentId;
        if (assignedAgentId && typeof assignedAgentId === 'string') {
          agentIds.add(assignedAgentId);
        }
      }
      const agentMap = new Map<string, Record<string, unknown>>();
      if (agentIds.size > 0) {
        const resolved = await this.agentService.buildGrpcAgentsForPlaybook(
          normalizedOwnerId,
          [...agentIds],
          undefined,
          executionId,
        );
        for (const agent of resolved) {
          agentMap.set(agent.id, {
            agent_name: agent.name,
            agent_description: agent.description,
            agent_model: agent.chatbot?.model,
            agent_prompt: agent.prompt,
            agent_type: agent.agent_type,
            agent_tools: agent.tools,
            skills: agent.skills || [],
            agent_params: agent.agent_params?.params || {},
            connector_bindings: agent.connector_bindings || [],
            connector_ids: agent.connectorIds || [],
            brain_context: agent.brain_context || [],
          });
        }
      }
      // Merge resolved agent config into each node's metadata (flattened to avoid gRPC Struct nesting issues)
      const nodeMetadataEntries = (snapshot.nodes as any[]).map((n) => {
        const baseMetadata = stripRuntimeAgentMetadata((n.metadata || {}) as Record<string, unknown>);
        return { n, baseMetadata };
      });
      const enrichedNodes = await Promise.all(nodeMetadataEntries.map(async ({ n, baseMetadata }) => {
        const assignedAgentId = n.metadata?.assignedAgentId;
        const resolvedAgent = typeof assignedAgentId === 'string' ? agentMap.get(assignedAgentId) : undefined;
        const runtimeAgentMetadata = await this.buildNodeRuntimeAgentMetadata(normalizedOwnerId, String(n.id || ''), baseMetadata, resolvedAgent);
        const description = typeof n.description === 'string' && n.description.trim()
          ? n.description.trim()
          : typeof n.metadata?.description === 'string' && n.metadata.description.trim()
            ? n.metadata.description.trim()
            : '';
        return {
          ...n,
          modelId: n.modelId || (runtimeAgentMetadata?.agent_model as string) || '',
          metadata: {
            ...baseMetadata,
            ...(description ? { description } : {}),
            ...(runtimeAgentMetadata || {}),
          },
        };
      }));

      const taskNodeIds = enrichedNodes
        .filter((n: any) => n.kind === 'step' || n.kind === 'iterator')
        .map((n: any) => n.id);
      const executionMeta = await this.executionModel.findById(executionId, 'singleStepTaskId executionMode stepExecutionModes modelIdOverride replayPlanningByTask').lean().exec();
      const executionModelIdOverride = executionMeta?.modelIdOverride;
      if (executionModelIdOverride && typeof executionModelIdOverride === 'string') {
        for (const node of enrichedNodes) {
          node.modelId = executionModelIdOverride;
          if (node.metadata && typeof node.metadata === 'object') {
            (node.metadata as Record<string, unknown>).agent_model = executionModelIdOverride;
          }
        }
      }
      const singleStepTargetId = executionMeta?.singleStepTaskId ?? null;
      const globalExecMode = executionMeta?.executionMode || 'live';
      const stepModes: Record<string, string> = (executionMeta?.stepExecutionModes as Record<string, string>) || {};
      const VALID_STEP_MODES = new Set(['live', 'replay_strict', 'replay_flex', 'replay_adaptive']);
      const REPLAY_MODES = new Set(['replay_strict', 'replay_flex', 'replay_adaptive']);
      const replayModeNodeIds = enrichedNodes
        .filter((node: any) => REPLAY_MODES.has(this.resolveStepExecutionMode(node, stepModes, globalExecMode, VALID_STEP_MODES)))
        .map((node: any) => node.id);
      const nodesEligibleForReplay = singleStepTargetId
        ? [singleStepTargetId]
        : Array.from(new Set([...taskNodeIds, ...replayModeNodeIds]));
      const replayArtifacts = await this.replayArtifactService.resolveReplayArtifacts(flowId, nodesEligibleForReplay);
      const activeOutputFormatTemplates = this.outputFormatService
        ? await this.outputFormatService.getActiveTemplates(flowId, nodesEligibleForReplay)
        : new Map<string, { formatGuide?: string | null }>();
      const activeHitlMemories = await this.loadActiveHitlMemories(flowId, taskNodeIds);
      const replayInputContext = inputContext || {};
      const workspaceIds: string[] = ((snapshotOverride || snapshot) as any).workspaces || [];
      const defaultWorkspaceId = workspaceIds[0] || '';
      // Resolve each workspaceId to its `{ownerUserId}/{storagePrefix}` storage
      // path so the runtime can scan documents without a second lookup. Keyed by
      // workspaceId (lossless); unresolved ids are simply absent from the map.
      const workspacePathsById = this.workspaceService
        ? await this.workspaceService.getStoragePathMapByIds(workspaceIds)
        : {};
      const runtimeInputContext = this.buildRuntimeInputContext({
        ...replayInputContext,
        __playbook_workspace_ids: workspaceIds,
        __playbook_default_workspace_id: defaultWorkspaceId,
        __playbook_workspace_paths: workspacePathsById,
        __playbook_default_workspace_path: workspacePathsById[defaultWorkspaceId] || '',
      }, activeHitlMemories);

      const replayPlanningByTask: Record<string, ReplayPlanningSummary> = {};
      for (const node of enrichedNodes) {
        const taskId = node.id;
        const stepMode = this.resolveStepExecutionMode(node, stepModes, globalExecMode, VALID_STEP_MODES);
        const isReplayMode = REPLAY_MODES.has(stepMode);
        node.metadata = { ...node.metadata, execution_mode: stepMode };
        if (!isReplayMode) continue;
        let artifacts = replayArtifacts.get(taskId);
        if (!artifacts) {
          artifacts = await this.replayArtifactService.resolveActiveReplayArtifact(flowId, taskId) ?? undefined;
          if (artifacts) {
            replayArtifacts.set(taskId, artifacts);
          }
        }
        if (!artifacts) {
          this.logger.warn(`Replay skipped for task ${taskId}: missing_replay_baseline`);
          continue;
        }
        const replayPlanning = isReplayMode
          ? this.buildReplayPlanning(artifacts, {
              taskId,
              inputContext: replayInputContext,
              taskTitle: typeof node.label === 'string' ? node.label : null,
              taskDescription: typeof node.metadata?.description === 'string'
                ? node.metadata.description as string
                : null,
            })
          : null;
        if (replayPlanning) {
          replayPlanningByTask[taskId] = replayPlanning;
          node.metadata = {
            ...node.metadata,
            replay_planning: replayPlanning,
          };
        }
        await this.getReplayRuntime().persistPreRunReport({
          executionId,
          flowId,
          taskId,
          replayId: artifacts.replayId,
          referenceExecutionId: artifacts.referenceExecutionId,
          validationVersion: artifacts.validationVersion,
          mode: stepMode as 'replay_strict' | 'replay_flex' | 'replay_adaptive',
        });
        this.trackReplayTask(executionId, taskId);
        this.cacheSelectedReplayArtifacts(executionId, taskId, artifacts);
        const activeTemplate = activeOutputFormatTemplates.get(taskId);
        const mergedArtifacts = (!artifacts.outputFormatGuide && activeTemplate?.formatGuide && artifacts.replayConfig.replayOutputFormat)
          ? { ...artifacts, outputFormatGuide: activeTemplate.formatGuide }
          : artifacts;
        const replayPrompt = this.replayPromptService.buildReplayPromptSection({
          artifacts: mergedArtifacts,
          mode: stepMode as 'replay_strict' | 'replay_flex' | 'replay_adaptive',
          planning: replayPlanning,
        });
        if (replayPrompt) {
          node.metadata = { ...node.metadata, replay_instructions: replayPrompt };
        }
      }

      const startResult = await this.executionModel.updateOne(
        { _id: executionId, status: 'running' },
        {
          startedAt: new Date(),
          queuePosition: 0,
          replayPlanningByTask,
        },
      ).exec();
      if (!(startResult as { modifiedCount?: number }).modifiedCount) {
        this.clearSelectedReplayArtifacts(executionId);
        await this.releaseExecutionLease(executionId);
        this.logger.warn(`Skipping gRPC start for execution ${executionId} because it is no longer runnable`);
        return;
      }

      this.executionLeaseService?.startHeartbeat(executionId);

      const executionStartState = await this.executionModel.findById(
        executionId,
        'singleStepTaskId advisorAutopilotEnabled advisorAutopilotTargetScore advisorAutopilotMaxTurns reflectionEnabled advisorScoringMode executionMode stepExecutionModes replayPlanningByTask',
      ).lean().exec();

      const effectiveExecutionMode = (executionStartState?.executionMode || 'live') as 'live' | 'inherit' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';
      this.streamEvents.emitExecutionStart(executionId, flowId, normalizedOwnerId, {
        executionMode: effectiveExecutionMode,
        stepExecutionModes: (executionStartState?.stepExecutionModes as Record<string, 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive'> | undefined) ?? {},
        reflectionEnabled: executionStartState?.reflectionEnabled,
        advisorScoringMode: executionStartState?.advisorScoringMode,
        advisorAutopilotEnabled: executionStartState?.advisorAutopilotEnabled,
        advisorAutopilotTargetScore: executionStartState?.advisorAutopilotTargetScore,
        advisorAutopilotMaxTurns: executionStartState?.advisorAutopilotMaxTurns,
        singleStepTaskId: executionStartState?.singleStepTaskId ?? null,
        replayPlanningByTask,
      });

    this.logger.log(`Starting playbook flow execution ${executionId} with ${snapshot.nodes.length} nodes, ${agentIds.size} agent IDs found, ${agentMap.size} agents resolved`);

    for (const n of enrichedNodes) {
      if (n.metadata?.agent_name) {
        this.logger.debug(
          `[playbook-exec] enriched node ${n.id} agent=${n.metadata.agent_name} model=${n.metadata.agent_model} type=${n.metadata.agent_type}`,
        );
      }
    }

      const executionRecord = await this.executionModel.findById(executionId, 'seededTaskOutputs').lean().exec();
      const seededTaskOutputs = Array.isArray((executionRecord as Record<string, unknown> | null)?.seededTaskOutputs)
        ? ((executionRecord as Record<string, unknown>).seededTaskOutputs as Array<SeededTaskOutput>)
        : [];

      const dataBindingsProto = await this.buildDataBindingsProto(
        snapshot.dataBindings as any[],
        workspacePathsById,
      );

      const request = {
        execution_id: executionId,
        flow_id: flowId,
        owner_id: normalizedOwnerId,

      snapshot: {
        nodes: (enrichedNodes as any[]).map((n) => ({
          id: n.id,
          kind: n.kind,
          label: n.label || '',
          task_template_id: n.taskTemplateId || '',
          prompt_template_id: n.promptTemplateId || '',
          output_format_id: n.outputFormatId || '',
          input: n.input ? {
            raw: n.input.raw || '',
            ports: (n.input.ports || []).map((p: Record<string, unknown>) => ({
              id: p.id || '',
              label: p.label || '',
              type: p.type || '',
              required: Boolean(p.required),
            })),
          } : undefined,
          output: n.output ? {
            raw: n.output.raw || '',
            ports: (n.output.ports || []).map((p: Record<string, unknown>) => ({
              id: p.id || '',
              label: p.label || '',
              type: p.type || '',
              required: Boolean(p.required),
            })),
          } : undefined,
          router_config: n.routerConfig ? {
            output_labels: n.routerConfig.outputLabels || [],
            max_iterations: n.routerConfig.maxIterations || 0,
            conditions: (n.routerConfig.conditions || []).map((condition: Record<string, unknown>) => ({
              label: condition.label || '',
              source_node: condition.sourceNode || '',
              source_port: condition.sourcePort || '',
              path: condition.path || '',
              operator: condition.operator || '',
              value: toGrpcValue(condition.value),
            })),
            default_label: n.routerConfig.defaultLabel || '',
          } : undefined,
          iterator_config: n.iteratorConfig ? {
            collection_path: n.iteratorConfig.collectionPath || '',
            max_items: n.iteratorConfig.maxItems || 0,
          } : undefined,
          human_approval_config: buildGrpcHumanApprovalConfig(n.humanApprovalConfig),
          retry_policy: n.retryPolicy ? {
            max_retries: n.retryPolicy.maxRetries || 0,
            delay_ms: n.retryPolicy.delayMs || 0,
          } : undefined,
          model_id: n.modelId || '',
          metadata: toGrpcStruct(buildGrpcNodeMetadata(n, snapshot as Record<string, unknown>)),
          dynamic_reasoning: n.dynamicReasoning ? { enabled: n.dynamicReasoning.enabled === true } : undefined,
        })),
        control_edges: (snapshot.controlEdges as any[]).map((e) => ({
          id: e.id,
          kind: e.kind,
          source: e.source,
          target: e.target,
          router_label: e.routerLabel || '',
          priority: e.priority || 0,
          source_output_port_id: e.sourceOutputPortId || '',
          target_input_port_id: e.targetInputPortId || '',
        })),
        data_bindings: dataBindingsProto,
        settings: {
          recursion_limit: recursionLimit,
          max_parallelism: maxParallelism,
        },
      },
      input_context: toGrpcStruct(runtimeInputContext),
        settings: {
          recursion_limit: effectiveExecutionSettings
            ? Math.min(recursionLimit, effectiveExecutionSettings.recursionLimitMax)
            : recursionLimit,
          max_parallelism: effectiveExecutionSettings?.effectiveExecutionParallelism ?? maxParallelism,
          dynamic_reasoning_policy: effectiveExecutionSettings?.dynamicReasoningEnabled ? {
            max_work_nodes: effectiveExecutionSettings.dynamicReasoning.maxWorkNodes,
            max_parallelism: effectiveExecutionSettings.dynamicReasoning.maxParallelism,
            max_depth: effectiveExecutionSettings.dynamicReasoning.maxDepth,
            max_repair_attempts: effectiveExecutionSettings.dynamicReasoning.maxRepairAttempts,
          } : undefined,
          playbook_planner: plannerSnapshot,
          runtime_settings: effectiveExecutionSettings ? {
            max_concurrent_per_user: effectiveExecutionSettings.maxConcurrentPerUser,
            execution_queue_max_depth: effectiveExecutionSettings.executionQueueMaxDepth,
            max_parallelism_per_execution: effectiveExecutionSettings.maxParallelismPerExecution,
            recursion_limit_default: effectiveExecutionSettings.recursionLimitDefault,
            recursion_limit_max: effectiveExecutionSettings.recursionLimitMax,
            max_hitl_rounds: effectiveExecutionSettings.maxHitlRounds,
            python_worker_pool_size: effectiveExecutionSettings.pythonWorkerPoolSize,
            python_worker_max_inflight: effectiveExecutionSettings.pythonWorkerMaxInflight,
            max_tool_iterations: effectiveExecutionSettings.maxToolIterations,
            graph_cache_enabled: effectiveExecutionSettings.graphCacheEnabled,
            graph_cache_max_entries: effectiveExecutionSettings.graphCacheMaxEntries,
            graph_cache_ttl_seconds: effectiveExecutionSettings.graphCacheTtlSeconds,
          } : undefined,
        },
        seeded_task_outputs: seededTaskOutputs.map((entry) => ({
          node_id: entry.nodeId,
          iteration: entry.iteration,
          payload: toGrpcStruct({
            output: entry.payload.output,
            ...(entry.payload.displayText ? { display_text: entry.payload.displayText } : {}),
            ...(entry.payload.artifacts ? { artifacts: entry.payload.artifacts } : {}),
            ...(entry.payload.components ? { components: entry.payload.components } : {}),
            ...(entry.payload.toolTrace ? { tool_trace: entry.payload.toolTrace } : {}),
            ...(entry.payload.llmPromptTrace ? { llm_prompt_trace: entry.payload.llmPromptTrace } : {}),
            ...(entry.payload.usage ? { usage: entry.payload.usage } : {}),
            ...(entry.payload.semanticMatch ? { semantic_match: entry.payload.semanticMatch } : {}),
            ...(entry.payload.traceMetadata ? { trace_metadata: entry.payload.traceMetadata } : {}),
            ...(('outputs' in entry.payload && (entry.payload as unknown as Record<string, unknown>).outputs)
              ? { outputs: (entry.payload as unknown as Record<string, unknown>).outputs }
              : {}),
          }),
        })),
      };
    const call = this.runRuntime(request);
    let finalized = false;
    let completionEmitted = false;
    let lastHandlePromise = Promise.resolve();
    const releaseOnce = () => {
      if (finalized) return;
      finalized = true;
      this.clearSelectedReplayArtifacts(executionId);
      this.scheduleQueueDrain(ownerId);
    };
    const waitForHandledEvents = async () => {
      await lastHandlePromise;
    };
    call.on('data', (event: Record<string, unknown>) => {
      lastHandlePromise = lastHandlePromise
        .then(() => this.getEventHandler().handleRunEvent({
          executionId,
          event,
          releaseExecutionLease: () => this.releaseExecutionLease(executionId),
          scheduleQueueDrain: (queuedOwnerId) => this.scheduleQueueDrain(queuedOwnerId),
        }))
        .catch((err) => {
          this.logger.error(`Failed to handle run event for execution ${executionId}`, err instanceof Error ? err.stack : undefined);
        });
      const eventType = event.event_type as string;
      if (eventType === 'ExecutionCompleted') {
        completionEmitted = true;
      } else if (eventType === 'ExecutionFailed') {
        completionEmitted = true;
      }
    });
    call.on('error', (err: Error) => {
      void (async () => {
        await waitForHandledEvents();
        this.logger.error(`gRPC stream error for execution ${executionId}: ${err.message}`, err.stack);
        if (!completionEmitted) {
          await this.getStreamFinalizer().finalizeErroredStream(executionId, err.message);
          completionEmitted = true;
        }
        releaseOnce();
      })().catch((updateErr) => {
        this.logger.error(`Failed to finalize errored stream for execution ${executionId}`, updateErr instanceof Error ? updateErr.stack : undefined);
        releaseOnce();
      });
    });
    call.on('end', () => {
      void (async () => {
        this.logger.log(`gRPC stream ended for execution ${executionId}`);
        await waitForHandledEvents();
        if (!completionEmitted) {
          completionEmitted = await this.getStreamFinalizer().finalizeEndedStream(executionId);
        }
        releaseOnce();
      })().catch((err) => {
        this.logger.error(`Failed to finalize gRPC stream for execution ${executionId}`, err instanceof Error ? err.stack : undefined);
        releaseOnce();
      });
    });
    } catch (err) {
      this.clearSelectedReplayArtifacts(executionId);
      this.logger.error(`Playbook flow execution ${executionId} failed before gRPC stream`, err instanceof Error ? err.stack : undefined);
      await this.executionModel.findByIdAndUpdate(executionId, {
        status: 'failed',
        endedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      }).exec();
      await this.tokenBufferService?.flushExecution(executionId);
      await this.releaseExecutionLease(executionId);
      this.streamEvents.emitExecutionComplete(executionId, 'failed', err instanceof Error ? err.message : String(err));
      this.scheduleQueueDrain(ownerId);
    }
  }

  private async handleRunEvent(executionId: string, event: Record<string, unknown>): Promise<void> {
    return this.getEventHandler().handleRunEvent({
      executionId,
      event,
      releaseExecutionLease: () => this.releaseExecutionLease(executionId),
      scheduleQueueDrain: (ownerId) => this.scheduleQueueDrain(ownerId),
    });
  }

  async findAll(
    flowId: string,
    ownerId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<IFlowExecutionListResponse> {
    await this.requireAccessService().assertExecutionAccess(flowId, ownerId, 'read');
    const filter: Record<string, unknown> = { flowId };
    const total = await this.executionModel.countDocuments(filter);
    const items = await this.executionModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return {
      items: items.map((item) => ({
        ...item,
        id: (item as unknown as Record<string, unknown>)._id as string,
      })) as unknown as IFlowExecutionResponse[],
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findRecentByAccessibleFlowIds(
    flowIds: string[],
    statuses: string[] | undefined,
    limit: number,
  ): Promise<Array<{
    executionId: string;
    flowId: string;
    status: string;
    startedAt?: Date;
    updatedAt?: Date;
    endedAt?: Date;
    waitingForHumanInput: boolean;
    task?: { taskId: string; iteration: number; status: string; taskName?: string };
  }>> {
    if (flowIds.length === 0) return [];
    const filter: Record<string, unknown> = { flowId: { $in: flowIds } };
    if (statuses?.length) filter.status = { $in: statuses };
    const executions = await this.executionModel
      .find(filter)
      .select('_id flowId status startedAt updatedAt endedAt pendingApproval')
      .sort({ updatedAt: -1, createdAt: -1, _id: 1 })
      .limit(limit)
      .lean()
      .exec();
    const executionIds = executions.map((execution) => String(execution._id));
    const taskResults = executionIds.length === 0
      ? []
      : await this.taskResultModel
        .find({ executionId: { $in: executionIds }, status: { $in: ['failed', 'running'] } })
        .select('executionId taskId iteration status generatedNodeTitle startedAt')
        .sort({ startedAt: -1, iteration: -1 })
        .lean()
        .exec();
    const taskByExecution = new Map<string, (typeof taskResults)[number]>();
    for (const task of taskResults) {
      const current = taskByExecution.get(task.executionId);
      if (!current || (task.status === 'failed' && current.status !== 'failed')) {
        taskByExecution.set(task.executionId, task);
      }
    }
    return executions.map((execution) => {
      const executionId = String(execution._id);
      const task = taskByExecution.get(executionId);
      return {
        executionId,
        flowId: execution.flowId,
        status: execution.status,
        startedAt: execution.startedAt,
        updatedAt: execution.updatedAt,
        endedAt: execution.endedAt,
        waitingForHumanInput: execution.status === 'pending_approval' || Boolean(execution.pendingApproval),
        ...(task ? {
          task: {
            taskId: task.taskId,
            iteration: task.iteration,
            status: task.status,
            taskName: task.generatedNodeTitle,
          },
        } : {}),
      };
    });
  }

  async findOne(executionId: string, ownerId: string): Promise<IFlowExecutionDetailResponse> {
    const execution = await this.findExecutionWithSnapshot(executionId);
    if (!execution) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }
    if (String(execution.ownerId) !== String(ownerId)) {
      await this.requireAccessService().assertExecutionAccess(String(execution.flowId), ownerId, 'read');
    }

    const taskResults = await this.taskResultModel
      .find({ executionId })
      .sort({ taskId: 1, iteration: 1 })
      .lean();

    const routerDecisions = await this.routerDecisionModel
      .find({ executionId })
      .sort({ decidedAt: 1 })
      .lean();
    const hitlEvents = execution.hitlEvents ?? [];
    const redactSensitiveText = await this.observabilityService.shouldRedactSensitiveText();
    const dynamicReasoningAttempts = this.dynamicReasoningAttemptModel
      ? await this.dynamicReasoningAttemptModel.find({ executionId }).sort({ createdAt: 1 }).lean().exec()
      : [];
    const executionJson = sanitizeExecutionForResponse(execution.toJSON() as unknown as IFlowExecutionResponse & {
      snapshot?: Record<string, unknown>;
      playbookPlannerSnapshot?: Record<string, unknown>;
    });

      return {
        ...executionJson,
        replayPlanningByTask: executionJson.replayPlanningByTask ?? null,
        taskResults: await Promise.all(taskResults.map(async (r): Promise<IFlowTaskResultResponse> => {
        const rawTaskResult = r as unknown as Record<string, unknown>;
        const doc = this.artifactService
          ? await this.artifactService.projectPublicTaskResult(
             rawTaskResult,
             String(execution.ownerId),
             executionId,
             redactSensitiveText,
           )
          : publicPlaybookTaskResult(
             rawTaskResult,
             String(execution.ownerId),
             executionId,
             new Set(),
             redactSensitiveText,
           );
        return {
          id: doc._id as string,
          executionId: r.executionId,
          taskId: r.taskId,
          iteration: r.iteration,
          status: r.status,
          output: doc.output as string | null | undefined,
          displayText: (doc.displayText as string | null | undefined) ?? undefined,
          outputs: doc.outputs as Record<string, unknown> | undefined,
          artifacts: doc.artifacts as Array<Record<string, unknown>>,
          components: doc.components as Array<Record<string, unknown>>,
          iteratorIterations: doc.iteratorIterations as Array<Record<string, unknown>> | undefined,
          error: doc.error == null ? undefined : String(doc.error),
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          toolTrace: doc.toolTrace as FlowToolTraceItem[] | undefined,
          reasoningChain: (doc.reasoningChain as PublicReasoningTraceItem[] | undefined) ?? [],
          llmPromptTrace: doc.llmPromptTrace as FlowLlmPromptTraceItem[] | undefined,
          usage: r.usage as unknown as FlowUsageSummary | null | undefined,
          ...flattenUsage({ usage: r.usage as unknown as FlowUsageSummary | null | undefined }),
          semanticMatch: doc.semanticMatch as FlowSemanticMatchSummary | null | undefined,
          traceMetadata: doc.traceMetadata as Record<string, unknown> ?? {},
          judgeStatus: (r as any).judgeStatus ?? 'idle',
          judgeScoringMode: (r as any).judgeScoringMode ?? null,
          judgeResult: (doc.judgeResult as IFlowTaskResultResponse['judgeResult']) ?? null,
          judgeError: doc.judgeError == null ? null : String(doc.judgeError),
          judgeHistory: (Array.isArray(doc.judgeHistory) ? doc.judgeHistory : []) as IFlowTaskResultResponse['judgeHistory'],
          hitlHistory: hitlEvents.filter((event) => event.nodeId === r.taskId && event.iteration === r.iteration),
          parentTaskId: r.parentTaskId,
          runtimeSubgraphId: r.runtimeSubgraphId,
          generatedLocalNodeId: r.generatedLocalNodeId,
          generatedNodeTitle: r.generatedNodeTitle,
        };
      })),
      routerDecisions: routerDecisions.map((r) => ({
        id: (r as unknown as Record<string, unknown>)._id as string,
        executionId: r.executionId,
        routerNodeId: r.routerNodeId,
        iteration: r.iteration,
        label: r.label,
        decidedAt: r.decidedAt,
      })),
      dynamicReasoningAttempts: dynamicReasoningAttempts.map((attempt) => ({
        ...attempt,
        id: String((attempt as unknown as Record<string, unknown>)._id),
      })),
    };
  }

  private async drainQueue(ownerId: string): Promise<void> {
    const maxConcurrent = this.executionSettingsResolver
      ? (await this.executionSettingsResolver.resolve()).maxConcurrentPerUser
      : this.configService.get<number>('playbook-flow.maxConcurrentPerUser', 10);
    if (!this.isRuntimeAvailable()) return;

    while (true) {
      const next = await this.queueService.release(ownerId, maxConcurrent);
      if (!next) return;

      const leaseResult = await this.executionLeaseService?.acquire(
        next.id,
        ownerId,
        next.flowId,
        this.resolveLeaseModelScope(next as unknown as Record<string, unknown>),
      );
      if (leaseResult && !leaseResult.acquired) {
        // Keep queue order stable when the oldest runnable execution is blocked by
        // a shared capacity limit. A later execution should not jump the queue.
        await this.executionModel.updateOne(
          { _id: next.id, status: 'running' },
          {
            $set: {
              status: 'queued',
              queuePosition: 0,
            },
            $unset: { startedAt: 1 },
          },
        ).exec();

        const restoredChanges = await this.queueService.refreshPositions(ownerId);
        for (const { executionId, queuePosition } of restoredChanges) {
          this.streamEvents.emitQueuePositionUpdate(executionId, queuePosition);
        }
        return;
      }

      const changes = await this.queueService.refreshPositions(ownerId);
      for (const { executionId, queuePosition } of changes) {
        this.streamEvents.emitQueuePositionUpdate(executionId, queuePosition);
      }

      const claimedExecution = await this.executionModel
        .findById(next.id)
        .select('+snapshot')
        .lean();

      if (!claimedExecution) {
        this.logger.error(`Drain: claimed execution ${next.id} disappeared before dispatch`);
        await this.releaseExecutionLease(next.id);
        await this.executionModel
          .findByIdAndUpdate(next.id, {
            status: 'failed',
            endedAt: new Date(),
            error: 'Claimed execution disappeared before runtime dispatch',
          })
          .exec();
        this.streamEvents.emitExecutionComplete(next.id, 'failed', 'Claimed execution disappeared before runtime dispatch');
        continue;
      }

      const executionRecord = claimedExecution as unknown as Record<string, unknown>;
      const snapshot = executionRecord.snapshot as Record<string, unknown> | undefined;
      let flow: Record<string, unknown> | null = null;

      if (!snapshot) {
        flow = await this.flowService.findOne(next.flowId, ownerId).catch((err) => {
          this.logger.warn(`Drain: flow ${next.flowId} not found for execution ${next.id}`, String(err));
          return null;
        }) as unknown as Record<string, unknown> | null;

        if (!flow) {
          await this.releaseExecutionLease(next.id);
          await this.executionModel
            .findByIdAndUpdate(next.id, {
              status: 'failed',
              endedAt: new Date(),
              error: 'Flow not found before runtime start',
            })
            .exec();
          this.streamEvents.emitExecutionComplete(next.id, 'failed', 'Flow not found before runtime start');
          continue;
        }
      }

      this.logger.log(`Drain: starting queued execution ${next.id} for owner ${ownerId}`);

      const replaySource = executionRecord.replaySource as { executionId: string; taskId: string; iteration?: number } | undefined;
      const dispatchInputContext =
        (executionRecord.inputContext as Record<string, unknown> | undefined) || next.inputContext || {};
      const isDurableResume = Object.prototype.hasOwnProperty.call(
        dispatchInputContext,
        '__playbook_resume',
      );

      if (replaySource && !isDurableResume) {
        this.logger.log(
          `Drain: dispatching replay execution ${next.id} from source ${replaySource.executionId} task ${replaySource.taskId} iteration ${replaySource.iteration ?? 0} via RunFromCheckpoint`,
        );
        this.callGrpcRunFromCheckpoint(
          next.id, next.flowId, ownerId,
          replaySource.executionId,
          snapshot || {},
          dispatchInputContext,
          replaySource.taskId,
          replaySource.iteration ?? 0,
        ).catch((err) => {
          this.logger.error(`Drain: checkpoint replay execution ${next.id} failed to start`, err instanceof Error ? err.stack : undefined);
        });
      } else {
        this.logger.log(`Drain: dispatching normal execution ${next.id} via Run`);
        this.callGrpcRun(
          next.id,
          next.flowId,
          ownerId,
          flow,
          dispatchInputContext,
          snapshot,
        ).catch((err) => {
          this.logger.error(`Drain: execution ${next.id} failed to start`, err instanceof Error ? err.stack : undefined);
        });
      }
    }
  }

  async cancel(executionId: string, ownerId: string): Promise<IFlowExecutionResponse> {
    const execution = await this.executionModel.findById(executionId);
    if (!execution) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }
    if (String(execution.ownerId) !== String(ownerId)) {
      await this.requireAccessService().assertExecutionAccess(String(execution.flowId), ownerId, 'write');
    }

    if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Execution already finished');
    }

    execution.status = 'cancelled';
    execution.endedAt = new Date();
    execution.pendingApproval = null;
    execution.hitlEvents = (execution.hitlEvents ?? []).map((event) => (
      event.status === 'pending'
        ? { ...event, status: 'cancelled' as const, respondedAt: new Date() }
        : event
    ));
    await execution.save();
    await this.tokenBufferService?.flushExecution(executionId);
    await this.releaseExecutionLease(executionId);

    await this.taskResultModel.updateMany(
      { executionId, status: { $in: ['pending', 'running', 'interrupted'] } },
      { status: 'cancelled' },
    );

    this.streamEvents.emitExecutionCancelled(executionId);

    if (this.isRuntimeAvailable()) {
      this.cancelRuntime({ execution_id: executionId }, (err: Error | null) => {
        if (err) {
        }
      });
    }

    return sanitizeExecutionForResponse(execution.toJSON() as unknown as IFlowExecutionResponse);
  }

  async delete(executionId: string, ownerId: string): Promise<void> {
    const execution = await this.executionModel.findById(executionId);
    if (!execution) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }
    if (String(execution.ownerId) !== String(ownerId)) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }

    if (execution.status === 'running') {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Cannot delete a running execution. Cancel it first.',
      );
    }

    await this.taskResultModel.deleteMany({ executionId });
    await this.routerDecisionModel.deleteMany({ executionId });
    await this.executionModel.findByIdAndDelete(executionId);
  }

  async deleteAll(flowId: string, ownerId: string): Promise<{ deleted: number }> {
    const flow = await this.flowService.findById(flowId);
    if (String(flow.ownerId) !== String(ownerId)) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }

    const executions = await this.executionModel.find({ flowId, ownerId }, { _id: 1 }).lean();
    const executionIds = executions.map((e: Record<string, unknown>) => String(e._id));

    if (executionIds.length > 0) {
      await this.taskResultModel.deleteMany({ executionId: { $in: executionIds } });
      await this.routerDecisionModel.deleteMany({ executionId: { $in: executionIds } });
    }

    const result = await this.executionModel.deleteMany({ flowId, ownerId });
    return { deleted: result.deletedCount ?? 0 };
  }

  async resumeApproval(
    executionId: string,
    ownerId: string,
    payload: IResumeApprovalPayload,
  ): Promise<IFlowExecutionResponse> {
    return this.requireHitlResumeService().resumeApproval(executionId, ownerId, payload);
  }

  async resumeFromStep(
    executionId: string,
    ownerId: string,
    payload: IResumeFromStepPayload,
  ): Promise<IFlowExecutionResponse> {
    return this.requireHitlResumeService().resumeFromStep(executionId, ownerId, payload);
  }

  private requireHitlResumeService(): PlaybookExecutionHitlResumeService {
    if (!this.hitlResumeService) {
      throw new Error('PlaybookExecutionHitlResumeService is required for HITL resume');
    }
    return this.hitlResumeService;
  }

  private async findExecutionWithSnapshot(executionId: string): Promise<FlowExecutionDocument | null> {
    const queryOrDocument = this.executionModel.findById(executionId) as unknown as {
      select?: (fields: string) => Promise<FlowExecutionDocument | null>;
    } | Promise<FlowExecutionDocument | null>;
    if ('select' in queryOrDocument && typeof queryOrDocument.select === 'function') {
      return queryOrDocument.select('+snapshot');
    }
    return queryOrDocument as Promise<FlowExecutionDocument | null>;
  }

  async runFromStep(
    executionId: string,
    ownerId: string,
    payload: IRunFromStepPayload,
  ): Promise<IFlowExecutionResponse> {
    const sourceExecution = await this.executionModel
      .findById(executionId)
      .select('+snapshot');
    if (!sourceExecution) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Source execution not found',
      );
    }
    if (String(sourceExecution.ownerId) !== String(ownerId)) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Source execution not found',
      );
    }
    if (sourceExecution.status !== 'completed') {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Source execution must be completed to run from step',
      );
    }
    if (!sourceExecution.snapshot) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Source execution has no persisted snapshot',
      );
    }

    const snapshot = structuredClone(
      sourceExecution.snapshot as Record<string, unknown>,
    );
    const nodes = (snapshot.nodes || []) as Array<Record<string, unknown>>;
    const targetNode = nodes.find((n) => n.id === payload.taskId);
    if (!targetNode || targetNode.kind !== 'step') {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Target must be a top-level step node',
      );
    }

    const iteration = payload.iteration ?? 0;
    const snapshotSettings = snapshot.settings && typeof snapshot.settings === 'object'
      ? snapshot.settings as Record<string, unknown>
      : {};
    const requestedRecursionLimit = Number(snapshotSettings.recursionLimit) || 25;
    const requestedMaxParallelism = Number(snapshotSettings.maxParallelism) || 5;
    const effectiveExecutionSettings = this.executionSettingsResolver
      ? await this.executionSettingsResolver.resolve({
        recursionLimit: requestedRecursionLimit,
        maxParallelism: requestedMaxParallelism,
      })
      : undefined;
    const recursionLimit = effectiveExecutionSettings
      ? Math.min(requestedRecursionLimit, effectiveExecutionSettings.recursionLimitMax)
      : requestedRecursionLimit;
    const maxParallelism = effectiveExecutionSettings?.effectiveExecutionParallelism ?? requestedMaxParallelism;
    if (effectiveExecutionSettings) {
      snapshot.playbookExecutionSettings = effectiveExecutionSettings;
    }

    const sourceInputContext = structuredClone(sourceExecution.inputContext ?? {});
    delete sourceInputContext.__playbook_resume;
    delete sourceInputContext.__playbook_hitl_memory;

    const newExecution = new this.executionModel({
      flowId: sourceExecution.flowId,
      ownerId,
      status: 'queued',
      recursionLimit,
      maxParallelism,
      inputContext: sourceInputContext,
      snapshot,
      replaySource: {
        executionId: sourceExecution.id,
        taskId: payload.taskId,
        iteration,
      },
    });
    await newExecution.save();

    this.logger.log(
      `Created replay execution ${newExecution.id} from source ${sourceExecution.id} task ${payload.taskId} iteration ${iteration}`,
    );

    const maxConcurrent = effectiveExecutionSettings?.maxConcurrentPerUser
      ?? this.configService.get<number>('playbook-flow.maxConcurrentPerUser', 10);
    const maxDepth = effectiveExecutionSettings?.executionQueueMaxDepth
      ?? this.configService.get<number>('playbook-flow.executionQueueMaxDepth', 50);
    await this.queueService.admit(
      ownerId,
      (newExecution as any).id || (newExecution as any)._id?.toString(),
      maxConcurrent,
      maxDepth,
    );
    this.scheduleQueueDrain(ownerId);

    return sanitizeExecutionForResponse(newExecution.toJSON() as unknown as IFlowExecutionResponse);
  }

  private async callGrpcRunFromCheckpoint(
    executionId: string,
    flowId: string,
    ownerId: string,
    sourceExecutionId: string,
    snapshotOverride: Record<string, unknown>,
    inputContext: Record<string, unknown>,
    targetNodeId: string,
    targetIteration: number,
  ): Promise<void> {
    const snapshot = snapshotOverride as any;
    const normalizedOwnerId = typeof ownerId === 'string' ? ownerId : String(ownerId);
    const recursionLimit = snapshot.settings?.recursionLimit || 25;
    const maxParallelism = snapshot.settings?.maxParallelism || 5;
    const effectiveExecutionSettings = snapshot.playbookExecutionSettings
      ?? (this.executionSettingsResolver
        ? await this.executionSettingsResolver.resolve({ recursionLimit, maxParallelism })
        : undefined);
    const hasDynamicReasoningNode = (snapshot.nodes as any[]).some(
      (node) => node.dynamicReasoning?.enabled === true,
    );
    const persistedPlanner = snapshot.playbookPlanner as Record<string, unknown> | undefined;
    const planner = !persistedPlanner && effectiveExecutionSettings?.dynamicReasoningEnabled && hasDynamicReasoningNode
      ? await this.resolvePlaybookPlanner(
        effectiveExecutionSettings.dynamicReasoning.plannerAgentId || '',
        snapshot.settings as Record<string, unknown> | undefined,
      )
      : null;
    const plannerSnapshot = persistedPlanner ? {
      agent_id: persistedPlanner.agentId,
      agent_type_slug: persistedPlanner.agentTypeSlug,
      model: persistedPlanner.model,
      system_prompt: persistedPlanner.systemPrompt,
      temperature: persistedPlanner.temperature,
      omit_temperature: persistedPlanner.omitTemperature,
      prompt_hash: persistedPlanner.promptHash,
      agent_revision: persistedPlanner.agentRevision,
    } : planner ? {
      agent_id: planner.agentId,
      agent_type_slug: planner.agentTypeSlug,
      model: planner.model,
      system_prompt: planner.instruction,
      temperature: planner.temperature,
      omit_temperature: planner.omitTemperature,
      prompt_hash: `sha256:${createHash('sha256').update(planner.instruction).digest('hex')}`,
      agent_revision: planner.agentRevision,
    } : undefined;
    const taskNodeIds = (snapshot.nodes as any[])
      .filter((node) => node.kind === 'step' || node.kind === 'task')
      .map((node) => String(node.id));
    const activeHitlMemories = await this.loadActiveHitlMemories(flowId, taskNodeIds);
    const runtimeInputContext = this.buildRuntimeInputContext(inputContext || {}, activeHitlMemories);

    const agentIds = new Set<string>();
    for (const node of snapshot.nodes as any[]) {
      const assignedAgentId = node.metadata?.assignedAgentId;
      if (assignedAgentId && typeof assignedAgentId === 'string') {
        agentIds.add(assignedAgentId);
      }
    }
    const agentMap = new Map<string, Record<string, unknown>>();
    if (agentIds.size > 0) {
      const resolved = await this.agentService.buildGrpcAgentsForPlaybook(
        normalizedOwnerId,
        [...agentIds],
        undefined,
        executionId,
      );
      for (const agent of resolved) {
        agentMap.set(agent.id, {
          agent_name: agent.name,
          agent_description: agent.description,
          agent_model: agent.chatbot?.model,
          agent_prompt: agent.prompt,
          agent_type: agent.agent_type,
          agent_tools: agent.tools,
          skills: agent.skills || [],
          agent_params: agent.agent_params?.params || {},
          connector_bindings: agent.connector_bindings || [],
          connector_ids: agent.connectorIds || [],
          brain_context: agent.brain_context || [],
        });
      }
    }

    const enrichedNodes = await Promise.all((snapshot.nodes as any[]).map(async (n) => {
      const assignedAgentId = n.metadata?.assignedAgentId;
      const resolvedAgent = typeof assignedAgentId === 'string' ? agentMap.get(assignedAgentId) : undefined;
      const baseMetadata = stripRuntimeAgentMetadata((n.metadata || {}) as Record<string, unknown>);
      const runtimeAgentMetadata = await this.buildNodeRuntimeAgentMetadata(normalizedOwnerId, String(n.id || ''), baseMetadata, resolvedAgent);
      return {
        ...n,
        metadata: { ...baseMetadata, ...(runtimeAgentMetadata || {}) },
      };
    }));

    const dataBindingsProto = await this.buildDataBindingsProto(snapshot.dataBindings as any[]);

    const snapshotProto = {
      nodes: enrichedNodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        label: n.label || '',
        task_template_id: n.taskTemplateId || '',
        prompt_template_id: n.promptTemplateId || '',
        output_format_id: n.outputFormatId || '',
        input: n.input ? {
          raw: n.input.raw || '',
          ports: (n.input.ports || []).map((p: Record<string, unknown>) => ({
            id: p.id || '', label: p.label || '', type: p.type || '', required: Boolean(p.required),
          })),
        } : undefined,
        output: n.output ? {
          raw: n.output.raw || '',
          ports: (n.output.ports || []).map((p: Record<string, unknown>) => ({
            id: p.id || '', label: p.label || '', type: p.type || '', required: Boolean(p.required),
          })),
        } : undefined,
        router_config: n.routerConfig ? {
          output_labels: n.routerConfig.outputLabels || [],
          max_iterations: n.routerConfig.maxIterations || 0,
          conditions: (n.routerConfig.conditions || []).map((c: Record<string, unknown>) => ({
            label: c.label || '', source_node: c.sourceNode || '', source_port: c.sourcePort || '',
            path: c.path || '', operator: c.operator || '', value: toGrpcValue(c.value),
          })),
          default_label: n.routerConfig.defaultLabel || '',
        } : undefined,
        iterator_config: n.iteratorConfig ? {
          collection_path: n.iteratorConfig.collectionPath || '', max_items: n.iteratorConfig.maxItems || 0,
        } : undefined,
        human_approval_config: buildGrpcHumanApprovalConfig(n.humanApprovalConfig),
        retry_policy: n.retryPolicy ? { max_retries: n.retryPolicy.maxRetries || 0, delay_ms: n.retryPolicy.delayMs || 0 } : undefined,
        model_id: n.modelId || '',
        metadata: toGrpcStruct(buildGrpcNodeMetadata(n, snapshot as Record<string, unknown>)),
        dynamic_reasoning: n.dynamicReasoning ? { enabled: n.dynamicReasoning.enabled === true } : undefined,
      })),
      control_edges: (snapshot.controlEdges as any[]).map((e) => ({
        id: e.id, kind: e.kind, source: e.source, target: e.target,
        router_label: e.routerLabel || '', priority: e.priority || 0,
        source_output_port_id: e.sourceOutputPortId || '', target_input_port_id: e.targetInputPortId || '',
      })),
      data_bindings: dataBindingsProto,
      settings: {
        recursion_limit: recursionLimit,
        max_parallelism: maxParallelism,
      },
    };

    const request = {
      execution_id: executionId,
      source_execution_id: sourceExecutionId,
      flow_id: flowId,
      owner_id: normalizedOwnerId,
      snapshot: snapshotProto,
      input_context: toGrpcStruct(runtimeInputContext),
      settings: {
        recursion_limit: effectiveExecutionSettings
          ? Math.min(recursionLimit, effectiveExecutionSettings.recursionLimitMax)
          : recursionLimit,
        max_parallelism: effectiveExecutionSettings?.effectiveExecutionParallelism ?? maxParallelism,
        dynamic_reasoning_policy: effectiveExecutionSettings?.dynamicReasoningEnabled ? {
          max_work_nodes: effectiveExecutionSettings.dynamicReasoning.maxWorkNodes,
          max_parallelism: effectiveExecutionSettings.dynamicReasoning.maxParallelism,
          max_depth: effectiveExecutionSettings.dynamicReasoning.maxDepth,
          max_repair_attempts: effectiveExecutionSettings.dynamicReasoning.maxRepairAttempts,
        } : undefined,
        playbook_planner: plannerSnapshot,
        runtime_settings: effectiveExecutionSettings ? {
          max_concurrent_per_user: effectiveExecutionSettings.maxConcurrentPerUser,
          execution_queue_max_depth: effectiveExecutionSettings.executionQueueMaxDepth,
          max_parallelism_per_execution: effectiveExecutionSettings.maxParallelismPerExecution,
          recursion_limit_default: effectiveExecutionSettings.recursionLimitDefault,
          recursion_limit_max: effectiveExecutionSettings.recursionLimitMax,
          max_hitl_rounds: effectiveExecutionSettings.maxHitlRounds,
          python_worker_pool_size: effectiveExecutionSettings.pythonWorkerPoolSize,
          python_worker_max_inflight: effectiveExecutionSettings.pythonWorkerMaxInflight,
          max_tool_iterations: effectiveExecutionSettings.maxToolIterations,
          graph_cache_enabled: effectiveExecutionSettings.graphCacheEnabled,
          graph_cache_max_entries: effectiveExecutionSettings.graphCacheMaxEntries,
          graph_cache_ttl_seconds: effectiveExecutionSettings.graphCacheTtlSeconds,
        } : undefined,
      },
      target_node_id: targetNodeId,
      target_iteration: targetIteration,
    };

    const call = this.runFromCheckpointRuntime(request);
    this.executionLeaseService?.startHeartbeat(executionId);
    let finalized = false;
    let completionEmitted = false;
    let lastHandlePromise = Promise.resolve();

    const releaseOnce = () => {
      if (finalized) return;
      finalized = true;
      this.scheduleQueueDrain(ownerId);
    };

    const waitForHandledEvents = async () => { await lastHandlePromise; };

    call.on('data', (event: Record<string, unknown>) => {
      lastHandlePromise = lastHandlePromise
        .then(() => this.handleRunEvent(executionId, event))
        .catch((err) => {
          this.logger.error(`Failed to handle checkpoint replay event for execution ${executionId}`, err instanceof Error ? err.stack : undefined);
        });
      const eventType = event.event_type as string;
      if (eventType === 'ExecutionCompleted' || eventType === 'ExecutionFailed') {
        completionEmitted = true;
      }
    });

    call.on('error', (err: Error) => {
      void (async () => {
        await waitForHandledEvents();
        this.logger.error(`gRPC RunFromCheckpoint stream error for execution ${executionId}: ${err.message}`, err.stack);
        if (!completionEmitted) {
          await this.getStreamFinalizer().finalizeErroredStream(executionId, err.message);
          completionEmitted = true;
        }
        releaseOnce();
      })().catch((updateErr) => {
        this.logger.error(`Failed to finalize errored checkpoint replay stream for execution ${executionId}`, updateErr instanceof Error ? updateErr.stack : undefined);
        releaseOnce();
      });
    });

    call.on('end', () => {
      void (async () => {
        this.logger.log(`gRPC RunFromCheckpoint stream ended for execution ${executionId}`);
        await waitForHandledEvents();
        if (!completionEmitted) {
          completionEmitted = await this.getStreamFinalizer().finalizeEndedStream(executionId);
        }
        releaseOnce();
      })().catch((err) => {
        this.logger.error(`Failed to finalize gRPC RunFromCheckpoint stream for execution ${executionId}`, err instanceof Error ? err.stack : undefined);
        releaseOnce();
      });
    });
  }
}
