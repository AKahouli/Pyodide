import { forwardRef, Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
import { PlaybookFlowReplayBaselineService } from './playbook-flow-replay-baseline.service';
import { PlaybookFlowReplayEligibilityService } from './playbook-flow-replay-eligibility.service';
import { PlaybookFlowReplayReportService } from './playbook-flow-replay-report.service';
import { PlaybookFlowReplayDriftService } from './playbook-flow-replay-drift.service';
import { PlaybookFlowReplayPlanService } from './playbook-flow-replay-plan.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { PlaybookFlowOutputFormatService } from './playbook-flow-output-format.service';
import { ModelsService } from '@modules/models/models.service';
import { SystemService } from '@modules/system/system.service';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import type { ReplayEligibilityResult } from '../interfaces/playbook-flow-replay-eligibility.interface';
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
  FlowCompletedResultPayload,
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
import { FlowHitlMemory, FlowHitlMemoryDocument } from '../schemas/playbook-flow-hitl-memory.schema';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;
const RUNTIME_AGENT_METADATA_KEYS = [
  'agent_name',
  'agent_description',
  'agent_model',
  'agent_prompt',
  'agent_type',
  'agent_tools',
  'agent_params',
  'connector_bindings',
  'brain_context',
] as const;

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

function stripRuntimeAgentMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitizedMetadata = { ...metadata };
  for (const key of RUNTIME_AGENT_METADATA_KEYS) {
    delete sanitizedMetadata[key];
  }
  return sanitizedMetadata;
}

function isNodeEnabled(node: Pick<FlowNode, 'metadata'>): boolean {
  return node.metadata?.enabled !== false;
}

export function buildGrpcNodeMetadata(node: Record<string, unknown>, snapshot: Record<string, unknown>): Record<string, unknown> {
  const metadata = node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
    ? node.metadata as Record<string, unknown>
    : {};
  const flowHitlPolicy = snapshot.hitlPolicy;
  const nodeHitlPolicy = node.hitlPolicy ?? metadata.hitlPolicy ?? metadata.hitl_policy;
  const hitlBlockers = snapshot.hitlBlockers;

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
    ...(hitlBlockers ? { hitl_blockers: hitlBlockers } : {}),
  };
}

const SINGLE_STEP_UNSUPPORTED_MESSAGE = 'Single-step execution only supports step nodes outside iterators. Dependent nodes require completed upstream results.';

interface SeededTaskOutput {
  nodeId: string;
  iteration: number;
  payload: FlowCompletedResultPayload;
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
    private readonly replayBaselineService: PlaybookFlowReplayBaselineService,
    private readonly replayEligibilityService: PlaybookFlowReplayEligibilityService,
    private readonly replayReportService: PlaybookFlowReplayReportService,
    private readonly outputContractService: PlaybookFlowOutputContractService,
    private readonly modelsService: ModelsService,
    @Optional() private readonly outputFormatService?: PlaybookFlowOutputFormatService,
    @Optional() private readonly replayPlanService?: PlaybookFlowReplayPlanService,
    @Optional() private readonly replayDriftService?: PlaybookFlowReplayDriftService,
    @Optional() private readonly postRunEvaluationService?: PlaybookFlowReplayPostRunEvaluationService,
    @Optional() private readonly systemService?: SystemService,
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
  ) {}

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

  private applyReplayPlanningEligibility(
    mode: 'replay_strict' | 'replay_flex' | 'replay_adaptive',
    eligibility: ReplayEligibilityResult,
    planning: ReplayPlanningSummary | null,
  ): ReplayEligibilityResult {
    if (!planning || !this.hasUnresolvedRequiredContext(planning)) {
      return eligibility;
    }

    const invalidationReasons = Array.from(new Set([
      ...eligibility.invalidationReasons,
      'required_context_unresolved',
    ]));

    return {
      ...eligibility,
      applied: false,
      invalidationReasons,
      skippedSections: Array.from(new Set([
        ...eligibility.skippedSections,
        'decision_invariants',
        'reasoning_chain',
        'tool_policy',
        'tool_trace',
        'output_contract',
        'output_format',
        'quality_checks',
        'known_failure_modes',
      ])),
      appliedSections: mode === 'replay_adaptive' ? eligibility.appliedSections : [],
    };
  }

  private hasUnresolvedRequiredContext(planning: ReplayPlanningSummary): boolean {
    const replayPlanService = this.replayPlanService ?? new PlaybookFlowReplayPlanService();
    return replayPlanService.hasUnresolvedRequiredContext(planning.contextMapping);
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

  private buildCurrentHitlContextFingerprints(params: {
    artifacts: ResolvedReplayArtifacts;
    inputContext: Record<string, unknown>;
    nodeSnapshot: Record<string, unknown>;
  }): Record<string, string> {
    const result: Record<string, string> = {};
    for (const snapshot of params.artifacts.hitlMemorySnapshots ?? []) {
      result[snapshot.interruptId] = this.replayBaselineService.buildHitlContextFingerprint({
        inputContext: params.inputContext,
        nodeSnapshot: params.nodeSnapshot,
        reasonCode: snapshot.reasonCode,
        prompt: snapshot.prompt,
        downstreamNodeIds: snapshot.downstreamNodeIds,
      });
    }
    return result;
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

  private resumeApprovalRuntime(request: Record<string, unknown>, callback: (err: Error | null) => void): void {
    this.playbookFlowClient?.ResumeApproval?.(request, callback) ?? this.runtimeClient.resumeApproval(request, callback);
  }

  private resumeFromStepRuntime(request: Record<string, unknown>, callback: (err: Error | null) => void): void {
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

    this.validatorService.validate(flow.nodes, flow.controlEdges, flow.dataBindings);

    if (singleStepTaskId) {
      this.assertSingleStepSupported(flow.nodes, singleStepTaskId);
      this.assertSingleStepControlDependenciesSupported(flow.nodes, flow.controlEdges, singleStepTaskId);
    }

    const maxConcurrent = this.configService.get<number>('playbook-flow.maxConcurrentPerUser', 10);
    const maxDepth = this.configService.get<number>('playbook-flow.executionQueueMaxDepth', 50);
    const recursionLimit = flow.settings?.recursionLimit || 25;
    const maxParallelism = flow.settings?.maxParallelism || 5;

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
        return existingExecution.toJSON() as unknown as IFlowExecutionResponse;
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

    return saved.toJSON() as unknown as IFlowExecutionResponse;
  }

  private assertSingleStepSupported(
    nodes: FlowNode[],
    singleStepTaskId: string,
  ): void {
    const targetNode = nodes.find((node) => node.id === singleStepTaskId);
    if (!targetNode) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        `Single-step target node ${singleStepTaskId} not found`,
      );
    }

    if (!isNodeEnabled(targetNode)) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        `Single-step target node ${singleStepTaskId} is disabled`,
      );
    }

    const kind = targetNode.kind;
    const containerConfig = (targetNode.metadata as { containerConfig?: { parentIteratorId?: string | null } } | undefined)?.containerConfig;

    if (kind !== 'step' || containerConfig?.parentIteratorId) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        SINGLE_STEP_UNSUPPORTED_MESSAGE,
      );
    }
  }

  private buildExecutableSnapshot(snapshot: FlowSnapshot, flowId: string): FlowSnapshot {
    const nodes = snapshot.nodes ?? [];
    const controlEdges = snapshot.controlEdges ?? [];
    const dataBindings = snapshot.dataBindings ?? [];

    const enabledNodes = nodes.filter((node) => {
      const enabled = isNodeEnabled(node);
      if (!enabled) {
        this.logger.warn(`Dropping disabled node ${node.id} from execution snapshot for flow ${flowId}`);
      }
      return enabled;
    });

    if (enabledNodes.length === nodes.length) {
      return snapshot;
    }

    const enabledNodeIds = new Set(enabledNodes.map((node) => node.id));
    const executableControlEdges = controlEdges.filter((edge) => {
      const keep = enabledNodeIds.has(edge.source) && enabledNodeIds.has(edge.target);
      if (!keep) {
        this.logger.warn(`Dropping control edge ${edge.id} from execution snapshot because it references a disabled node`);
      }
      return keep;
    });
    const executableDataBindings = dataBindings.filter((binding) => {
      const keep = enabledNodeIds.has(binding.targetNode)
        && (binding.sourceNode ? enabledNodeIds.has(binding.sourceNode) : true);
      if (!keep) {
        this.logger.warn(`Dropping data binding ${binding.id} from execution snapshot because it references a disabled node`);
      }
      return keep;
    });

    return {
      ...snapshot,
      nodes: enabledNodes,
      controlEdges: executableControlEdges,
      dataBindings: executableDataBindings,
    };
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
    const incomingEdges = controlEdges.filter((edge) => edge.target === singleStepTaskId);
    const unsupportedEdge = incomingEdges.find((edge) => {
      if (edge.kind !== 'sequential') {
        return true;
      }

      const sourceNode = nodes.find((node) => node.id === edge.source);
      return !sourceNode || sourceNode.kind !== 'step';
    });

    if (unsupportedEdge) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        'Single-step execution only supports nodes reached by sequential step dependencies.',
      );
    }
  }

  private async buildSeededTaskOutputsForSingleStep(
    flowId: string,
    ownerId: string,
    singleStepTaskId: string,
    currentSnapshot: FlowSnapshot,
    bindings: DataBinding[],
  ): Promise<SeededTaskOutput[]> {
    const requiredBindingHistory = new Map<string, number>();
    for (const binding of bindings) {
      if (binding.sourceKind !== 'node-output' || typeof binding.sourceNode !== 'string' || !binding.sourceNode.trim()) {
        continue;
      }

      const sourceNodeId = binding.sourceNode.trim();
      const requiredCount = binding.iteration === 'previous' ? 2 : 1;
      requiredBindingHistory.set(sourceNodeId, Math.max(requiredBindingHistory.get(sourceNodeId) ?? 0, requiredCount));
    }

    const requiredSourceNodeIds = [...requiredBindingHistory.keys()];

    if (requiredSourceNodeIds.length === 0) {
      return [];
    }

    const currentSnapshotNodes = Array.isArray(currentSnapshot.nodes)
      ? currentSnapshot.nodes as unknown as Array<Record<string, unknown>>
      : [];

    const completedExecutions = await this.executionModel.find({
      flowId,
      ownerId,
      status: 'completed',
    }).select('+snapshot').sort({ createdAt: -1 }).limit(20).lean().exec();

    let matchingExecution: Record<string, unknown> | null = null;
    for (const exec of completedExecutions) {
      const execSnapshot = (exec as Record<string, unknown>).snapshot;
      const execSnapshotNodes = Array.isArray(execSnapshot && (execSnapshot as Record<string, unknown>).nodes)
        ? ((execSnapshot as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
        : [];
      const allUpstreamMatch = requiredSourceNodeIds.every((sourceNodeId) => {
        const priorNode = execSnapshotNodes.find((node) => node.id === sourceNodeId);
        const currentNode = currentSnapshotNodes.find((node) => node.id === sourceNodeId);
        return priorNode && currentNode && JSON.stringify(priorNode) === JSON.stringify(currentNode);
      });
      if (allUpstreamMatch) {
        matchingExecution = exec as unknown as Record<string, unknown>;
        break;
      }
    }

    if (!matchingExecution) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        `Single-step execution for node ${singleStepTaskId} requires a previous completed execution with matching upstream node snapshots.`,
      );
    }

    const taskResults = await this.taskResultModel.find({
      executionId: matchingExecution._id?.toString() ?? matchingExecution.id,
      taskId: { $in: requiredSourceNodeIds },
      status: 'completed',
    }).sort({ iteration: -1, endedAt: -1 }).lean().exec();

    const resultsByTaskId = new Map<string, Array<Record<string, unknown>>>();
    for (const result of taskResults) {
      const existing = resultsByTaskId.get(result.taskId) ?? [];
      existing.push(result as unknown as Record<string, unknown>);
      resultsByTaskId.set(result.taskId, existing);
    }

    const missingSourceNodeIds = requiredSourceNodeIds.filter((taskId) => {
      const requiredCount = requiredBindingHistory.get(taskId) ?? 1;
      return (resultsByTaskId.get(taskId)?.length ?? 0) < requiredCount;
    });
    if (missingSourceNodeIds.length > 0) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        `Single-step execution for node ${singleStepTaskId} requires completed upstream results for: ${missingSourceNodeIds.join(', ')}`,
      );
    }

    return requiredSourceNodeIds.flatMap((taskId) => {
      const requiredCount = requiredBindingHistory.get(taskId) ?? 1;
      const results = (resultsByTaskId.get(taskId) ?? []).slice(0, requiredCount);
      return results.map((result) => ({
        nodeId: taskId,
        iteration: Number(result.iteration ?? 0),
        payload: this.mapTaskResultToSeedPayload(result),
      }));
    });
  }

  private mapTaskResultToSeedPayload(result: Record<string, unknown>): FlowCompletedResultPayload {
    const displayText = typeof result.displayText === 'string' ? result.displayText : undefined;
    const rawOutput = result.output;
    const output = typeof rawOutput === 'string'
      ? rawOutput
      : displayText && displayText.length > 0
        ? displayText
        : JSON.stringify(rawOutput ?? '');

    const outputRecord = rawOutput && typeof rawOutput === 'object'
      ? rawOutput as Record<string, unknown>
      : null;

    let outputs: Record<string, unknown> | undefined;
    if (result.outputs && typeof result.outputs === 'object') {
      outputs = result.outputs as Record<string, unknown>;
    } else if (outputRecord && typeof outputRecord.outputs === 'object' && outputRecord.outputs !== null) {
      outputs = outputRecord.outputs as Record<string, unknown>;
    } else if (typeof result.output === 'string') {
      try {
        const parsed = JSON.parse(result.output);
        if (parsed && typeof parsed === 'object' && parsed.outputs && typeof parsed.outputs === 'object') {
          outputs = parsed.outputs as Record<string, unknown>;
        }
      } catch { /* not JSON or no outputs field */ }
    }

    return {
      output,
      ...(displayText ? { displayText } : {}),
      ...(outputs ? { outputs } : {}),
      ...(Array.isArray(result.artifacts) ? { artifacts: result.artifacts as Array<Record<string, unknown>> } : {}),
      ...(Array.isArray(result.components) ? { components: result.components as Array<Record<string, unknown>> } : {}),
      ...(Array.isArray(result.toolTrace) ? { toolTrace: result.toolTrace as unknown as FlowToolTraceItem[] } : {}),
      ...(Array.isArray(result.reasoningChain) ? { reasoningChain: result.reasoningChain as PublicReasoningTraceItem[] } : {}),
      ...(Array.isArray(result.llmPromptTrace) ? { llmPromptTrace: result.llmPromptTrace as unknown as FlowLlmPromptTraceItem[] } : {}),
      ...(result.usage ? { usage: result.usage as FlowUsageSummary } : {}),
      ...(result.semanticMatch ? { semanticMatch: result.semanticMatch as FlowSemanticMatchSummary } : {}),
      ...(result.traceMetadata ? { traceMetadata: result.traceMetadata as Record<string, unknown> } : {}),
    };
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
            agent_params: agent.agent_params?.params || {},
            connector_bindings: agent.connector_bindings || [],
            brain_context: agent.brain_context || [],
          });
        }
      }
      // Merge resolved agent config into each node's metadata (flattened to avoid gRPC Struct nesting issues)
      const enrichedNodes = (snapshot.nodes as any[]).map((n) => {
        const assignedAgentId = n.metadata?.assignedAgentId;
        const resolvedAgent = typeof assignedAgentId === 'string' ? agentMap.get(assignedAgentId) : undefined;
        const baseMetadata = stripRuntimeAgentMetadata((n.metadata || {}) as Record<string, unknown>);
        const description = typeof n.description === 'string' && n.description.trim()
          ? n.description.trim()
          : typeof n.metadata?.description === 'string' && n.metadata.description.trim()
            ? n.metadata.description.trim()
            : '';
        return {
          ...n,
          modelId: n.modelId || (resolvedAgent?.agent_model as string) || '',
          metadata: {
            ...baseMetadata,
            ...(description ? { description } : {}),
            ...(resolvedAgent || {}),
          },
        };
      });

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
      const replayFingerprintNodes = ((snapshot.nodes as Array<Record<string, unknown>> | undefined) || []).map((node) => {
        if (!executionModelIdOverride || typeof executionModelIdOverride !== 'string') {
          return { ...node };
        }

        const metadata = node.metadata && typeof node.metadata === 'object'
          ? { ...(node.metadata as Record<string, unknown>), agent_model: executionModelIdOverride }
          : { agent_model: executionModelIdOverride };

        return {
          ...node,
          modelId: executionModelIdOverride,
          metadata,
        };
      });
      const replayComparableRuntimeFlowSnapshot = this.getReplayRuntime().buildComparableFlowSnapshot({
        ...(snapshot as FlowSnapshot),
        nodes: replayFingerprintNodes as unknown as FlowSnapshot['nodes'],
      });
      const nodesEligibleForReplay = singleStepTargetId
        ? [singleStepTargetId]
          : taskNodeIds;
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
      const replayFingerprintNodesById = new Map(
        replayFingerprintNodes.map((entry) => [String((entry as any).id || ''), entry]),
      );

      const replayPlanningByTask: Record<string, ReplayPlanningSummary> = {};
      const VALID_STEP_MODES = new Set(['live', 'replay_strict', 'replay_flex', 'replay_adaptive']);
      const REPLAY_MODES = new Set(['replay_strict', 'replay_flex', 'replay_adaptive']);
      for (const node of enrichedNodes) {
        const taskId = node.id;
        const rawStepMode = stepModes[taskId] || (globalExecMode === 'inherit' ? 'live' : globalExecMode);
        const stepMode = VALID_STEP_MODES.has(rawStepMode) ? rawStepMode : 'live';
        const isReplayMode = REPLAY_MODES.has(stepMode);
        node.metadata = { ...node.metadata, execution_mode: stepMode };
        if (!isReplayMode) continue;
        const artifacts = replayArtifacts.get(taskId);
        if (!artifacts) continue;
        const currentNodeSnapshot = replayFingerprintNodesById.get(taskId) ?? { ...node };
        const eligibilityThreshold = this.systemService
          ? (await this.systemService.getPlaybookSettings().catch(() => null))?.replayEligibilityConfidenceThreshold
          : undefined;
        const initialEligibility = this.replayEligibilityService.evaluateReplayEligibility({
          mode: stepMode as 'replay_strict' | 'replay_flex' | 'replay_adaptive',
          artifacts,
          isStale: artifacts.isStale,
          staleReasons: artifacts.staleReasons,
          eligibilityThreshold,
          currentHitlContextFingerprints: this.buildCurrentHitlContextFingerprints({
            artifacts,
            inputContext: replayInputContext,
            nodeSnapshot: currentNodeSnapshot,
          }),
          currentFingerprints: this.replayBaselineService.buildCurrentReplayFingerprints({
            inputContext: replayInputContext,
            flowSnapshot: replayComparableRuntimeFlowSnapshot,
            nodeSnapshot: currentNodeSnapshot,
            outputContract: this.buildCurrentReplayOutputContract({
              artifacts,
              currentFormatGuide: activeOutputFormatTemplates.get(taskId)?.formatGuide ?? null,
              hasActiveTemplate: activeOutputFormatTemplates.has(taskId),
            }),
          }),
        });
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
        const eligibility = this.applyReplayPlanningEligibility(
          stepMode as 'replay_strict' | 'replay_flex' | 'replay_adaptive',
          initialEligibility,
          replayPlanning,
        );
        await this.getReplayRuntime().persistPreRunReport({
          executionId,
          flowId,
          taskId,
          replayId: artifacts.replayId,
          referenceExecutionId: artifacts.referenceExecutionId,
          validationVersion: artifacts.validationVersion,
          mode: stepMode as 'replay_strict' | 'replay_flex' | 'replay_adaptive',
          eligibility,
        });
        this.trackReplayTask(executionId, taskId);
        if (!eligibility.applied) {
          this.logger.warn(`Replay skipped for task ${taskId}: ${eligibility.invalidationReasons.join(', ')}`);
          continue;
        }
        this.cacheSelectedReplayArtifacts(executionId, taskId, artifacts);
        const activeTemplate = activeOutputFormatTemplates.get(taskId);
        const mergedArtifacts = (!artifacts.outputFormatGuide && activeTemplate?.formatGuide && artifacts.replayConfig.replayOutputFormat)
          ? { ...artifacts, outputFormatGuide: activeTemplate.formatGuide }
          : artifacts;
        const replayPrompt = this.replayPromptService.buildReplayPromptSection({
          artifacts: mergedArtifacts,
          mode: stepMode as 'replay_strict' | 'replay_flex' | 'replay_adaptive',
          eligibility,
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
          recursion_limit: recursionLimit,
          max_parallelism: maxParallelism,
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
          completionEmitted = await this.getStreamFinalizer().finalizeEndedStream(executionId, true);
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

  private buildCurrentReplayOutputContract(params: {
    artifacts: Pick<ResolvedReplayArtifacts, 'outputContract' | 'referenceOutput' | 'replayConfig'>;
    currentFormatGuide: string | null;
    hasActiveTemplate: boolean;
  }) {
    if (typeof this.replayBaselineService.buildOutputContractFromReplay !== 'function') {
      return params.artifacts.outputContract;
    }

    return this.replayBaselineService.buildOutputContractFromReplay({
      output: params.artifacts.referenceOutput,
      preserveOutputFormat: params.hasActiveTemplate || params.artifacts.replayConfig.replayOutputFormat,
      outputFormatGuide: params.currentFormatGuide,
      existingOutputContract: params.artifacts.outputContract,
    });
  }

  async findAll(
    flowId: string,
    ownerId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<IFlowExecutionListResponse> {
    const filter: Record<string, unknown> = { flowId, ownerId };
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

  async findOne(executionId: string, ownerId: string): Promise<IFlowExecutionDetailResponse> {
    const execution = await this.findExecutionWithSnapshot(executionId);
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

    const taskResults = await this.taskResultModel
      .find({ executionId })
      .sort({ taskId: 1, iteration: 1 })
      .lean();

    const routerDecisions = await this.routerDecisionModel
      .find({ executionId })
      .sort({ decidedAt: 1 })
      .lean();

      return {
        ...(execution.toJSON() as unknown as IFlowExecutionResponse),
        replayPlanningByTask: ((execution.toJSON() as unknown as IFlowExecutionResponse).replayPlanningByTask ?? null),
        taskResults: taskResults.map((r): IFlowTaskResultResponse => {
        const doc = r as unknown as Record<string, unknown>;
        return {
          id: doc._id as string,
          executionId: r.executionId,
          taskId: r.taskId,
          iteration: r.iteration,
          status: r.status,
          output: r.output,
          displayText: r.displayText,
          outputs: (r as any).outputs,
          artifacts: r.artifacts,
          components: r.components,
          error: r.error,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          toolTrace: r.toolTrace as unknown as FlowToolTraceItem[] | undefined,
          reasoningChain: ((r as any).reasoningChain as PublicReasoningTraceItem[] | undefined) ?? [],
          llmPromptTrace: r.llmPromptTrace as unknown as FlowLlmPromptTraceItem[] | undefined,
          usage: r.usage as unknown as FlowUsageSummary | null | undefined,
          ...flattenUsage({ usage: r.usage as unknown as FlowUsageSummary | null | undefined }),
          semanticMatch: r.semanticMatch as unknown as FlowSemanticMatchSummary | null | undefined,
          traceMetadata: r.traceMetadata as Record<string, unknown> ?? {},
          judgeStatus: (r as any).judgeStatus ?? 'idle',
          judgeScoringMode: (r as any).judgeScoringMode ?? null,
          judgeResult: (r as any).judgeResult ?? null,
          judgeError: (r as any).judgeError ?? null,
          judgeHistory: Array.isArray((r as any).judgeHistory) ? (r as any).judgeHistory : [],
        };
      }),
      routerDecisions: routerDecisions.map((r) => ({
        id: (r as unknown as Record<string, unknown>)._id as string,
        executionId: r.executionId,
        routerNodeId: r.routerNodeId,
        iteration: r.iteration,
        label: r.label,
        decidedAt: r.decidedAt,
      })),
    };
  }

  private async drainQueue(ownerId: string): Promise<void> {
    const maxConcurrent = this.configService.get<number>('playbook-flow.maxConcurrentPerUser', 10);
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
        .select('+snapshot replaySource')
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

      if (replaySource) {
        this.logger.log(
          `Drain: dispatching replay execution ${next.id} from source ${replaySource.executionId} task ${replaySource.taskId} iteration ${replaySource.iteration ?? 0} via RunFromCheckpoint`,
        );
        this.callGrpcRunFromCheckpoint(
          next.id, next.flowId, ownerId,
          replaySource.executionId,
          snapshot || {},
          (executionRecord.inputContext as Record<string, unknown> | undefined) || next.inputContext || {},
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
          (executionRecord.inputContext as Record<string, unknown> | undefined) || next.inputContext,
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
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
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

    return execution.toJSON() as unknown as IFlowExecutionResponse;
  }

  async delete(executionId: string, ownerId: string): Promise<void> {
    const execution = await this.executionModel.findById(executionId);
    if (!execution || String(execution.ownerId) !== String(ownerId)) {
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
    const flow = await this.flowService.findOne(flowId, ownerId);

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
    const execution = await this.findExecutionWithSnapshot(executionId);
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
    if (execution.status !== 'pending_approval') {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_APPROVAL_NOT_FOUND,
        'No pending approval for this execution',
      );
    }

    if (!this.isRuntimeAvailable()) {
      throw new ServiceUnavailableException(
        ErrorCode.PLAYBOOK_FLOW_GRPC_UNAVAILABLE,
        'Flow runtime is currently unavailable',
      );
    }

    const resumed = await new Promise<boolean>((resolve, reject) => {
      this.resumeApprovalRuntime(
        {
          execution_id: executionId,
          decision: payload.decision,
          payload: toGrpcStruct(payload.payload || {}),
        },
        (err: Error | null, response?: { resumed?: boolean }) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(Boolean(response?.resumed));
        },
      );
    });

    if (!resumed) {
      const restarted = await this.restartDurableApprovalResume({
        execution,
        executionId,
        ownerId,
        resumePayload: { decision: payload.decision, payload: payload.payload || {} },
        response: {
          action: payload.decision,
          ...(payload.payload ?? {}),
        },
      });
      if (restarted) {
        return restarted;
      }
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Execution could not be resumed because the runtime no longer has the pending approval state.',
      );
    }

    const resumeUpdate = await this.executionModel.updateOne(
      { _id: executionId, status: 'pending_approval' },
      {
        $set: {
          status: 'running',
          pendingApproval: null,
          'hitlEvents.$[event].status': 'answered',
          'hitlEvents.$[event].response': {
            action: payload.decision,
            ...(payload.payload ?? {}),
          },
          'hitlEvents.$[event].respondedAt': new Date(),
        },
      },
      { arrayFilters: [{ 'event.interruptId': execution.pendingApproval?.interruptId ?? '' }] },
    ).exec();

    if (!(resumeUpdate as { modifiedCount?: number }).modifiedCount) {
      const latestExecution = await this.executionModel.findById(executionId);
      if (!latestExecution) {
        throw new NotFoundException(
          ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
          'Execution not found',
        );
      }
      return latestExecution.toJSON() as unknown as IFlowExecutionResponse;
    }

    const resolvedApproval = execution.pendingApproval;
    await this.createFutureHitlMemoryIfRequested({
      executionId,
      ownerId,
      flowId: String(execution.flowId),
      taskId: resolvedApproval?.nodeId ?? '',
      interruptId: resolvedApproval?.interruptId ?? '',
      interruptType: resolvedApproval?.interruptType ?? 'approval_request',
      taskTitle: resolvedApproval?.taskTitle,
      response: {
        action: payload.decision,
        message: typeof payload.payload?.message === 'string' ? payload.payload.message : null,
        feedback: typeof payload.payload?.feedback === 'string' ? payload.payload.feedback : null,
        reason: typeof payload.payload?.reason === 'string' ? payload.payload.reason : null,
        scope: typeof payload.payload?.scope === 'string'
          ? payload.payload.scope
          : resolvedApproval?.feedbackScopeDefault ?? 'step_only',
        remember: payload.payload?.remember === true,
      },
      riskLevel: resolvedApproval?.riskLevel,
    });
    execution.pendingApproval = null;
    execution.status = 'running';
    this.streamEvents.emitHitlInterruptResolved(executionId, resolvedApproval?.interruptId ?? '', {
      action: payload.decision,
      taskId: resolvedApproval?.nodeId,
      scope: typeof payload.payload?.scope === 'string' ? payload.payload.scope : undefined,
      remember: payload.payload?.remember === true ? true : undefined,
    });
    return execution.toJSON() as unknown as IFlowExecutionResponse;
  }

  async resumeFromStep(
    executionId: string,
    ownerId: string,
    payload: IResumeFromStepPayload,
  ): Promise<IFlowExecutionResponse> {
    const execution = await this.findExecutionWithSnapshot(executionId);
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
    if (execution.status !== 'pending_approval' || !execution.pendingApproval) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_APPROVAL_NOT_FOUND,
        'No pending approval for this execution',
      );
    }
    if (execution.pendingApproval.nodeId !== payload.taskId) {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Execution is waiting on a different step interrupt.',
      );
    }

    if (!this.isRuntimeAvailable()) {
      throw new ServiceUnavailableException(
        ErrorCode.PLAYBOOK_FLOW_GRPC_UNAVAILABLE,
        'Flow runtime is currently unavailable',
      );
    }

    const resumePayload = {
      ...(payload.payload || {}),
      ...(payload.action ? { action: payload.action } : {}),
      ...(payload.message ? { message: payload.message } : {}),
      ...(payload.approved !== undefined ? { approved: payload.approved } : {}),
      ...(payload.reason ? { reason: payload.reason } : {}),
      ...(payload.feedback ? { feedback: payload.feedback } : {}),
      ...(payload.scope ? { scope: payload.scope } : {}),
      ...(payload.remember !== undefined ? { remember: payload.remember } : {}),
    };

    const resumed = await new Promise<boolean>((resolve, reject) => {
      this.resumeFromStepRuntime(
        {
          execution_id: executionId,
          node_id: payload.taskId,
          iteration: payload.iteration ?? execution.pendingApproval?.iteration ?? 0,
          interrupt_id: payload.interruptId || '',
          action: payload.action || '',
          payload: toGrpcStruct(resumePayload),
        },
        (err: Error | null, response?: { resumed?: boolean }) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(Boolean(response?.resumed));
        },
      );
    });

    if (!resumed) {
      const restarted = await this.restartDurableStepResume({
        execution,
        executionId,
        ownerId,
        taskId: payload.taskId,
        interruptId: payload.interruptId || execution.pendingApproval.interruptId || '',
        resumePayload,
        response: {
          action: payload.action ?? 'reply',
          message: payload.message ?? null,
          approved: payload.approved ?? null,
          reason: payload.reason ?? null,
          feedback: payload.feedback ?? null,
          scope: payload.scope ?? execution.pendingApproval.feedbackScopeDefault ?? 'step_only',
          remember: payload.remember ?? false,
        },
      });
      if (restarted) {
        return restarted;
      }
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Execution could not be resumed because the runtime no longer has the pending step interrupt state.',
      );
    }

    const resumeUpdate = await this.executionModel.updateOne(
      { _id: executionId, status: 'pending_approval' },
      {
        $set: {
          status: 'running',
          pendingApproval: null,
          'hitlEvents.$[event].status': 'answered',
          'hitlEvents.$[event].response': {
            action: payload.action ?? 'reply',
            message: payload.message ?? null,
            approved: payload.approved ?? null,
            reason: payload.reason ?? null,
            feedback: payload.feedback ?? null,
            scope: payload.scope ?? execution.pendingApproval.feedbackScopeDefault ?? 'step_only',
            remember: payload.remember ?? false,
          },
          'hitlEvents.$[event].respondedAt': new Date(),
        },
      },
      { arrayFilters: [{ 'event.interruptId': payload.interruptId || execution.pendingApproval.interruptId || '' }] },
    ).exec();

    if (!(resumeUpdate as { modifiedCount?: number }).modifiedCount) {
      const latestExecution = await this.executionModel.findById(executionId);
      if (!latestExecution) {
        throw new NotFoundException(
          ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
          'Execution not found',
        );
      }
      return latestExecution.toJSON() as unknown as IFlowExecutionResponse;
    }

    const resolvedApproval = execution.pendingApproval;
    await this.createFutureHitlMemoryIfRequested({
      executionId,
      ownerId,
      flowId: String(execution.flowId),
      taskId: payload.taskId,
      interruptId: payload.interruptId || resolvedApproval?.interruptId || '',
      interruptType: resolvedApproval?.interruptType,
      taskTitle: resolvedApproval?.taskTitle,
      response: {
        action: payload.action ?? 'reply',
        message: payload.message ?? null,
        feedback: payload.feedback ?? null,
        reason: payload.reason ?? null,
        scope: payload.scope ?? resolvedApproval?.feedbackScopeDefault ?? 'step_only',
        remember: payload.remember ?? false,
      },
      riskLevel: resolvedApproval?.riskLevel,
    });
    execution.pendingApproval = null;
    execution.status = 'running';
    this.streamEvents.emitHitlInterruptResolved(executionId, payload.interruptId || resolvedApproval?.interruptId || '', {
      action: payload.action ?? 'reply',
      taskId: payload.taskId,
      scope: payload.scope,
      remember: payload.remember,
    });
    return execution.toJSON() as unknown as IFlowExecutionResponse;
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

  private async restartDurableApprovalResume(params: {
    execution: FlowExecutionDocument;
    executionId: string;
    ownerId: string;
    resumePayload: Record<string, unknown>;
    response: Record<string, unknown>;
  }): Promise<IFlowExecutionResponse | null> {
    const pendingApproval = params.execution.pendingApproval;
    if (!params.execution.snapshot || !pendingApproval) {
      return null;
    }
    const resumed = await this.persistDurableResume(params.executionId, pendingApproval.interruptId ?? '', params.response);
    if (!resumed) return null;

    await this.createFutureHitlMemoryIfRequested({
      executionId: params.executionId,
      ownerId: params.ownerId,
      flowId: String(params.execution.flowId),
      taskId: pendingApproval.nodeId ?? '',
      interruptId: pendingApproval.interruptId ?? '',
      interruptType: pendingApproval.interruptType ?? 'approval_request',
      taskTitle: pendingApproval.taskTitle,
      response: {
        action: String(params.response.action ?? ''),
        message: typeof params.response.message === 'string' ? params.response.message : null,
        feedback: typeof params.response.feedback === 'string' ? params.response.feedback : null,
        reason: typeof params.response.reason === 'string' ? params.response.reason : null,
        scope: typeof params.response.scope === 'string' ? params.response.scope : pendingApproval.feedbackScopeDefault ?? 'step_only',
        remember: params.response.remember === true,
      },
      riskLevel: pendingApproval.riskLevel,
    });
    this.startDurableResumeStream(params.execution, params.resumePayload);
    this.streamEvents.emitHitlInterruptResolved(params.executionId, pendingApproval.interruptId ?? '', {
      action: String(params.response.action ?? ''),
      taskId: pendingApproval.nodeId,
      scope: typeof params.response.scope === 'string' ? params.response.scope : undefined,
      remember: params.response.remember === true ? true : undefined,
    });
    params.execution.pendingApproval = null;
    params.execution.status = 'running';
    return params.execution.toJSON() as unknown as IFlowExecutionResponse;
  }

  private async restartDurableStepResume(params: {
    execution: FlowExecutionDocument;
    executionId: string;
    ownerId: string;
    taskId: string;
    interruptId: string;
    resumePayload: Record<string, unknown>;
    response: Record<string, unknown>;
  }): Promise<IFlowExecutionResponse | null> {
    const pendingApproval = params.execution.pendingApproval;
    if (!params.execution.snapshot || !pendingApproval) {
      return null;
    }
    const resumed = await this.persistDurableResume(params.executionId, params.interruptId, params.response);
    if (!resumed) return null;

    await this.createFutureHitlMemoryIfRequested({
      executionId: params.executionId,
      ownerId: params.ownerId,
      flowId: String(params.execution.flowId),
      taskId: params.taskId,
      interruptId: params.interruptId,
      interruptType: pendingApproval.interruptType,
      taskTitle: pendingApproval.taskTitle,
      response: {
        action: String(params.response.action ?? 'reply'),
        message: typeof params.response.message === 'string' ? params.response.message : null,
        feedback: typeof params.response.feedback === 'string' ? params.response.feedback : null,
        reason: typeof params.response.reason === 'string' ? params.response.reason : null,
        scope: typeof params.response.scope === 'string' ? params.response.scope : pendingApproval.feedbackScopeDefault ?? 'step_only',
        remember: params.response.remember === true,
      },
      riskLevel: pendingApproval.riskLevel,
    });
    this.startDurableResumeStream(params.execution, params.resumePayload);
    this.streamEvents.emitHitlInterruptResolved(params.executionId, params.interruptId, {
      action: String(params.response.action ?? 'reply'),
      taskId: params.taskId,
      scope: typeof params.response.scope === 'string' ? params.response.scope : undefined,
      remember: params.response.remember === true ? true : undefined,
    });
    params.execution.pendingApproval = null;
    params.execution.status = 'running';
    return params.execution.toJSON() as unknown as IFlowExecutionResponse;
  }

  private async persistDurableResume(
    executionId: string,
    interruptId: string,
    response: Record<string, unknown>,
  ): Promise<boolean> {
    const resumeUpdate = await this.executionModel.updateOne(
      { _id: executionId, status: 'pending_approval' },
      {
        $set: {
          status: 'running',
          pendingApproval: null,
          'hitlEvents.$[event].status': 'answered',
          'hitlEvents.$[event].response': response,
          'hitlEvents.$[event].respondedAt': new Date(),
        },
      },
      { arrayFilters: [{ 'event.interruptId': interruptId }] },
    ).exec();
    return Boolean((resumeUpdate as { modifiedCount?: number }).modifiedCount);
  }

  private startDurableResumeStream(
    execution: FlowExecutionDocument,
    resumePayload: Record<string, unknown>,
  ): void {
    this.callGrpcRun(
      String(execution._id),
      String(execution.flowId),
      String(execution.ownerId),
      null,
      {
        ...(execution.inputContext ?? {}),
        __playbook_resume: resumePayload,
      },
      execution.snapshot,
    ).catch((err) => {
      this.logger.error(`Durable HITL resume stream failed for execution ${String(execution._id)}: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private async createFutureHitlMemoryIfRequested(params: {
    executionId: string;
    ownerId: string;
    flowId: string;
    taskId: string;
    interruptId: string;
    interruptType?: string;
    taskTitle?: string;
    response: {
      action: string;
      message?: string | null;
      feedback?: string | null;
      reason?: string | null;
      scope: string;
      remember: boolean;
    };
    riskLevel?: string;
  }): Promise<void> {
    if (!this.hitlMemoryModel || !params.response.remember) {
      return;
    }
    if (params.response.scope !== 'future_node_runs' && params.response.scope !== 'future_workflow_runs') {
      return;
    }

    const content = params.response.feedback || params.response.message || params.response.reason || '';
    if (!content.trim()) {
      return;
    }

    await this.hitlMemoryModel.create({
      ownerId: params.ownerId,
      flowId: params.flowId,
      nodeId: params.response.scope === 'future_node_runs' ? params.taskId : null,
      memoryType: params.interruptType === 'approval_request' ? 'approval_policy' : 'procedural',
      source: 'hitl_feedback',
      title: this.buildHitlMemoryTitle(params.taskTitle, params.response.scope),
      content,
      normalizedInstruction: content,
      appliesTo: params.response.scope === 'future_node_runs' ? 'node' : 'workflow',
      status: 'active',
      sensitivity: params.interruptType === 'approval_request' || params.riskLevel === 'high' || params.riskLevel === 'critical'
        ? 'sensitive'
        : 'normal',
      createdFromExecutionId: params.executionId,
      createdFromInterruptId: params.interruptId || undefined,
    });
    this.streamEvents.emitHitlMemorySaved(params.executionId, {
      taskId: params.taskId,
      scope: params.response.scope,
      interruptId: params.interruptId,
    });
  }

  private buildHitlMemoryTitle(taskTitle: string | undefined, scope: string): string {
    const target = taskTitle?.trim() || 'workflow step';
    return scope === 'future_node_runs'
      ? `HITL guidance for ${target}`
      : 'Workflow HITL guidance';
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

    const snapshot = sourceExecution.snapshot as Record<string, unknown>;
    const nodes = (snapshot.nodes || []) as Array<Record<string, unknown>>;
    const targetNode = nodes.find((n) => n.id === payload.taskId);
    if (!targetNode || targetNode.kind !== 'step') {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Target must be a top-level step node',
      );
    }

    const iteration = payload.iteration ?? 0;

    const newExecution = new this.executionModel({
      flowId: sourceExecution.flowId,
      ownerId,
      status: 'queued',
      recursionLimit: sourceExecution.recursionLimit,
      maxParallelism: sourceExecution.maxParallelism,
      inputContext: sourceExecution.inputContext,
      snapshot: sourceExecution.snapshot,
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

    const maxConcurrent = this.configService.get<number>('playbook-flow.maxConcurrentPerUser', 10);
    const maxDepth = this.configService.get<number>('playbook-flow.executionQueueMaxDepth', 50);
    await this.queueService.admit(
      ownerId,
      (newExecution as any).id || (newExecution as any)._id?.toString(),
      maxConcurrent,
      maxDepth,
    );
    this.scheduleQueueDrain(ownerId);

    return newExecution.toJSON() as unknown as IFlowExecutionResponse;
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
          agent_params: agent.agent_params?.params || {},
          connector_bindings: agent.connector_bindings || [],
          brain_context: agent.brain_context || [],
        });
      }
    }

    const enrichedNodes = (snapshot.nodes as any[]).map((n) => {
      const assignedAgentId = n.metadata?.assignedAgentId;
      const resolvedAgent = typeof assignedAgentId === 'string' ? agentMap.get(assignedAgentId) : undefined;
      const baseMetadata = stripRuntimeAgentMetadata((n.metadata || {}) as Record<string, unknown>);
      return {
        ...n,
        metadata: { ...baseMetadata, ...(resolvedAgent || {}) },
      };
    });

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
      })),
      control_edges: (snapshot.controlEdges as any[]).map((e) => ({
        id: e.id, kind: e.kind, source: e.source, target: e.target,
        router_label: e.routerLabel || '', priority: e.priority || 0,
        source_output_port_id: e.sourceOutputPortId || '', target_input_port_id: e.targetInputPortId || '',
      })),
      data_bindings: dataBindingsProto,
      settings: { recursion_limit: recursionLimit, max_parallelism: maxParallelism },
    };

    const request = {
      execution_id: executionId,
      source_execution_id: sourceExecutionId,
      flow_id: flowId,
      owner_id: normalizedOwnerId,
      snapshot: snapshotProto,
      input_context: toGrpcStruct(runtimeInputContext),
      settings: { recursion_limit: recursionLimit, max_parallelism: maxParallelism },
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
          completionEmitted = await this.getStreamFinalizer().finalizeEndedStream(executionId, false);
        }
        releaseOnce();
      })().catch((err) => {
        this.logger.error(`Failed to finalize gRPC RunFromCheckpoint stream for execution ${executionId}`, err instanceof Error ? err.stack : undefined);
        releaseOnce();
      });
    });
  }
}
