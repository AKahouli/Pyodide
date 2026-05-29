import { forwardRef, Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'node:path';
import * as fs from 'node:fs';
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
import { RESERVED_LABELS } from '../constants/reserved-labels';
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
import type { ReplayEligibilityResult } from '../interfaces/playbook-flow-replay-eligibility.interface';
import type { ResolvedReplayArtifacts } from '../interfaces/playbook-flow-replay-artifact.interface';
import type { ReplayPlanningSummary } from '../interfaces/playbook-flow-replay-plan.interface';
import type { ReplayRunReportLookup } from './playbook-flow-replay-report.service';
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

export function toGrpcValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    // Match the working chatbot/playbook gRPC path: proto-loader expects camelCase
    // Value selectors here, otherwise Struct map entries arrive as empty/null values.
    return { nullValue: 'NULL_VALUE', kind: 'nullValue' };
  }
  if (Array.isArray(value)) {
    return {
      listValue: { values: value.map((item) => toGrpcValue(item)) },
      kind: 'listValue',
    };
  }
  switch (typeof value) {
    case 'string':
      return { stringValue: value, kind: 'stringValue' };
    case 'number':
      return { numberValue: value, kind: 'numberValue' };
    case 'boolean':
      return { boolValue: value, kind: 'boolValue' };
    case 'object':
      return {
        structValue: toGrpcStruct(value as Record<string, unknown>),
        kind: 'structValue',
      };
    default:
      return { stringValue: String(value), kind: 'stringValue' };
  }
}

export function toGrpcStruct(value?: Record<string, unknown>): Record<string, unknown> {
  const fields = Object.entries(value || {}).reduce<Record<string, unknown>>((acc, [key, entry]) => {
    acc[key] = toGrpcValue(entry);
    return acc;
  }, {});
  return { fields };
}

export function buildGrpcHumanApprovalConfig(config?: { promptTemplate?: string; timeoutSeconds?: number | null } | null) {
  if (!config) return undefined;
  return {
    prompt_template: config.promptTemplate || '',
    ...(config.timeoutSeconds == null || config.timeoutSeconds === 0 ? {} : { timeout_seconds: config.timeoutSeconds }),
  };
}

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

export function shouldFinalizeStreamAsCompleted(
  completionEmitted: boolean,
  awaitingApproval: boolean,
  status: string,
): boolean {
  return !completionEmitted
    && !awaitingApproval
    && status !== 'cancelled'
    && status !== 'pending_approval'
    && status !== 'failed'
    && status !== 'completed';
}

export function shouldEmitFailureOnStreamError(completionEmitted: boolean): boolean {
  return !completionEmitted;
}

export function shouldEmitCompletedAfterUpdate(modifiedCount?: number): boolean {
  return Boolean(modifiedCount);
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

const SINGLE_STEP_UNSUPPORTED_MESSAGE = 'Single-step execution only supports step nodes outside iterators. Dependent nodes require completed upstream results.';

interface SeededTaskOutput {
  nodeId: string;
  iteration: number;
  payload: FlowCompletedResultPayload;
}

@Injectable()
export class PlaybookFlowExecutionService implements OnModuleInit {
  private readonly logger = new Logger(PlaybookFlowExecutionService.name);
  private playbookFlowClient: any;
  private isGrpcAvailable = false;
  private readonly selectedReplayArtifactsByExecution = new Map<
    string,
    Map<string, ResolvedReplayArtifacts>
  >();
  private readonly trackedReplayTasksByExecution = new Map<string, Set<string>>();

  constructor(
    @InjectModel(FlowExecution.name)
    private readonly executionModel: Model<FlowExecutionDocument>,
    @InjectModel(FlowTaskResult.name)
    private readonly taskResultModel: Model<FlowTaskResultDocument>,
    @InjectModel(FlowRouterDecision.name)
    private readonly routerDecisionModel: Model<FlowRouterDecisionDocument>,
    private readonly configService: ConfigService,
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
  ) {}

  private getReplayDriftService(): PlaybookFlowReplayDriftService {
    return this.replayDriftService
      ?? new PlaybookFlowReplayDriftService(
        this.executionModel,
        this.replayReportService,
        this.outputContractService,
        this.replayPlanService ?? new PlaybookFlowReplayPlanService(),
        { setContext: () => undefined, warn: () => undefined, log: () => undefined, error: () => undefined } as any,
      );
  }

  onModuleInit() {
    this.initGrpcClient();
    if (this.isGrpcAvailable) {
      this.recoverQueuedExecutions()
        .catch((err) => {
          this.logger.error('Failed to recover queued executions', err instanceof Error ? err.stack : undefined);
        });
    }
  }

  private async reconcileOrphanedExecutions(): Promise<void> {
    // This remains disabled until execution ownership is persisted and validated.
  }

  private buildReplayComparableFlowSnapshot(snapshot: FlowSnapshot): Record<string, unknown> {
    return {
      nodes: Array.isArray(snapshot.nodes)
        ? snapshot.nodes.map((node) => this.buildReplayComparableNode(node as unknown as Record<string, unknown>))
        : [],
      controlEdges: snapshot.controlEdges || [],
      dataBindings: snapshot.dataBindings || [],
      settings: snapshot.settings || {},
      workspaces: (snapshot as any).workspaces || [],
    };
  }

  private buildReplayComparableNode(node: Record<string, unknown>): Record<string, unknown> {
    const metadata = node.metadata && typeof node.metadata === 'object'
      ? stripRuntimeAgentMetadata(node.metadata as Record<string, unknown>)
      : {};

    return {
      ...node,
      metadata,
    };
  }

  private async persistReplayPreRunReport(params: {
    executionId: string;
    flowId: string;
    taskId: string;
    iteration?: number;
    replayId: string;
    validationVersion: number;
    mode: 'replay_strict' | 'replay_flex' | 'replay_adaptive';
    eligibility: ReplayEligibilityResult;
  }): Promise<void> {
    try {
      await this.getReplayDriftService().createPreRunReport({
        executionId: params.executionId,
        flowId: params.flowId,
        taskId: params.taskId,
        iteration: params.iteration ?? 0,
        replayId: params.replayId,
        validationVersion: params.validationVersion,
        mode: params.mode,
        eligibility: params.eligibility,
      });
    } catch (err) {
      this.logger.warn(`Failed to persist replay report for task ${params.taskId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async persistReplayStructuralDrift(params: {
    executionId: string;
    taskId: string;
    iteration?: number;
    output: unknown;
    toolTrace: FlowToolTraceItem[];
    reasoningChain: PublicReasoningTraceItem[];
    semanticMatch?: FlowSemanticMatchSummary | null;
    replayArtifacts: ResolvedReplayArtifacts;
    traceMetadata?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      let traceMetadata = params.traceMetadata ?? {};
      if (params.replayArtifacts.intentKey && !traceMetadata['observed_intent_key']) {
        const hasExecutionEvidence = params.toolTrace.length > 0
          || params.semanticMatch != null
          || (params.output != null && String(params.output).length > 0);
        if (hasExecutionEvidence) {
          traceMetadata = { ...traceMetadata, observed_intent_key: params.replayArtifacts.intentKey };
        }
      }

      await this.getReplayDriftService().recordCompletedTaskDrift({
        executionId: params.executionId,
        taskId: params.taskId,
        iteration: params.iteration ?? 0,
        output: params.output,
        toolTrace: params.toolTrace,
        reasoningChain: params.reasoningChain,
        semanticMatch: params.semanticMatch ?? null,
        replayArtifacts: params.replayArtifacts,
        traceMetadata,
      });
    } catch (err) {
      this.logger.warn(`Failed to persist replay structural drift for task ${params.taskId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async triggerPostRunEvaluation(
    executionId: string,
    replayArtifacts: ResolvedReplayArtifacts,
    taskId: string,
    iteration: number,
    resultPayload: { output?: unknown; toolTrace?: unknown[]; reasoningChain?: unknown[] },
  ): Promise<void> {
    if (!this.postRunEvaluationService) return;

    const REPLAY_MODES = new Set(['replay_strict', 'replay_flex', 'replay_adaptive']);
    if (!REPLAY_MODES.has(replayArtifacts.mode)) return;

    const report = await this.replayReportService.findLatestReportForExecutionTask(executionId, taskId, iteration);
    if (!report || !report.replayId) return;

    const taskNode = await this.executionModel.findById(executionId).select('+snapshot').lean();
    let taskTitle = taskId;
    let taskDescription: string | null = null;
    if (taskNode?.snapshot) {
      const nodes = (taskNode.snapshot as Record<string, unknown>)?.nodes;
      if (Array.isArray(nodes)) {
        const matched = nodes.find((n: Record<string, unknown>) => n.id === taskId) as Record<string, unknown> | undefined;
        if (matched) {
          taskTitle = typeof matched.label === 'string' && matched.label.trim() ? matched.label.trim() : taskId;
          const metadata = matched.metadata as Record<string, unknown> | undefined;
          if (metadata?.description && typeof metadata.description === 'string') {
            taskDescription = metadata.description.trim() || null;
          }
        }
      }
    }

    await this.postRunEvaluationService.evaluateCompletedReplayRun({
      executionId,
      flowId: replayArtifacts.flowId ?? '',
      taskId,
      iteration,
      replayReportId: report._id,
      baselineOutput: replayArtifacts.referenceOutput ?? null,
      newOutput: resultPayload.output != null ? String(resultPayload.output) : null,
      baselineReasoningChain: replayArtifacts.reasoningChain ?? null,
      newReasoningChain: resultPayload.reasoningChain ?? null,
      baselineToolCalls: replayArtifacts.toolCalls ?? null,
      newToolCalls: resultPayload.toolTrace ?? null,
      outputFormatGuide: replayArtifacts.outputFormatGuide ?? null,
      replayPlanningSummary: null,
      taskTitle,
      taskDescription,
      replayMode: replayArtifacts.mode,
    });
  }

  private cacheSelectedReplayArtifacts(
    executionId: string,
    taskId: string,
    artifacts: ResolvedReplayArtifacts,
  ): void {
    const byTask = this.selectedReplayArtifactsByExecution.get(executionId) ?? new Map();
    byTask.set(taskId, artifacts);
    this.selectedReplayArtifactsByExecution.set(executionId, byTask);
  }

  private trackReplayTask(executionId: string, taskId: string): void {
    const trackedTasks = this.trackedReplayTasksByExecution.get(executionId) ?? new Set<string>();
    trackedTasks.add(taskId);
    this.trackedReplayTasksByExecution.set(executionId, trackedTasks);
  }

  private getSelectedReplayArtifacts(
    executionId: string,
    taskId: string,
  ): ResolvedReplayArtifacts | null {
    return this.selectedReplayArtifactsByExecution.get(executionId)?.get(taskId) ?? null;
  }

  private async resolveReplayArtifactsForCompletedTask(
    executionId: string,
    taskId: string,
    iteration: number,
  ): Promise<ResolvedReplayArtifacts | null> {
    const cachedArtifacts = this.getSelectedReplayArtifacts(executionId, taskId);
    if (cachedArtifacts) {
      return cachedArtifacts;
    }

    const trackedTasks = this.trackedReplayTasksByExecution.get(executionId);
    if (!trackedTasks?.has(taskId)) {
      return null;
    }

    const replayReport = await this.replayReportService.findLatestReportForExecutionTask(executionId, taskId, iteration);
    if (!replayReport?.applied) {
      return null;
    }

    this.logger.warn(`Replay artifacts cache miss for execution ${executionId} task ${taskId}; resolving persisted replay artifacts from storage`);

    const taskArtifacts = await this.replayArtifactService.resolveReplayArtifactByIdentity({
      flowId: replayReport.flowId,
      taskId,
      replayId: replayReport.replayId,
      validationVersion: replayReport.validationVersion,
    });
    if (!taskArtifacts) {
      this.logger.warn(`Replay artifacts cache miss for execution ${executionId} task ${taskId}; persisted replay artifacts unavailable`);
      return null;
    }

    this.cacheSelectedReplayArtifacts(executionId, taskId, taskArtifacts);
    return taskArtifacts;
  }

  private clearSelectedReplayArtifacts(executionId: string): void {
    this.selectedReplayArtifactsByExecution.delete(executionId);
    this.trackedReplayTasksByExecution.delete(executionId);
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

  private async recoverQueuedExecutions(): Promise<void> {
    const owners = await this.executionModel.distinct('ownerId', { status: 'queued' });
    for (const ownerId of owners as string[]) {
      while (true) {
        const queuedCount = await this.executionModel.countDocuments({ ownerId, status: 'queued' });
        const runningCount = await this.queueService.getRunningCount(ownerId);
        const maxConcurrent = this.configService.get<number>('playbook-flow.maxConcurrentPerUser', 10);
        if (queuedCount === 0 || runningCount >= maxConcurrent) {
          break;
        }
        await this.drainQueue(ownerId);
      }
    }
  }

  private initGrpcClient() {
    try {
      const protoPath = this.resolvePlaybookFlowProtoPath();
      const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
      const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
      const pfPackage = protoDescriptor.playbook_flow as any;
      const grpcUrl = this.configService.get<string>('playbook-flow.grpcUrl', 'localhost:50051');
      this.playbookFlowClient = new pfPackage.PlaybookFlowRuntime(
        grpcUrl,
        grpc.credentials.createInsecure(),
      );
      this.isGrpcAvailable = true;
      this.logger.log(`Playbook flow gRPC client initialized at ${grpcUrl}`);
    } catch (err) {
      this.isGrpcAvailable = false;
      this.logger.error('Failed to initialize playbook flow gRPC client', err instanceof Error ? err.stack : undefined);
    }
  }

  private resolvePlaybookFlowProtoPath(): string {
    const candidates = [
      path.join(__dirname, '..', 'proto', 'playbook-flow.proto'),
      path.join(__dirname, '..', '..', 'playbook-flow', 'proto', 'playbook-flow.proto'),
      path.join(process.cwd(), 'dist', 'modules', 'playbook-flow', 'proto', 'playbook-flow.proto'),
      path.join(process.cwd(), 'src', 'modules', 'playbook-flow', 'proto', 'playbook-flow.proto'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return candidates[2];
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
    const flow = await this.flowService.findOneForExecutionStart(flowId, ownerId);
    this.logger.log(
      `playbook_execution_start_preflight_ms flowId=${flowId} nodeCount=${flow.nodes?.length ?? 0} edgeCount=${flow.controlEdges?.length ?? 0} durationMs=${Date.now() - preflightStartedAt}`,
    );

    const nodeIds = new Set(flow.nodes.map((n) => n.id));
    const cleanedEdges = flow.controlEdges.filter((e) => {
      const valid = nodeIds.has(e.source) && nodeIds.has(e.target);
      if (!valid) {
        this.logger.warn(`Cleaning orphaned edge ${e.id}: source=${e.source} target=${e.target}`);
      }
      return valid;
    });
    const cleanedBindings = flow.dataBindings.filter((b) => {
      const valid = nodeIds.has(b.targetNode)
        && (b.sourceNode ? nodeIds.has(b.sourceNode) : true);
      if (!valid) {
        this.logger.warn(`Cleaning orphaned data binding ${b.id}: targetNode=${b.targetNode} sourceNode=${b.sourceNode}`);
      }
      return valid;
    });

    const nodesById = new Map(flow.nodes.map((n) => [n.id, n]));
    const portCleanedBindings = cleanedBindings.filter((b) => {
      const targetNode = nodesById.get(b.targetNode);
      if (!targetNode) return true;
      const targetPortExists = targetNode.input?.ports?.some((p) => p.id === b.targetPort);
      if (!targetPortExists) {
        this.logger.warn(`Cleaning stale data binding ${b.id}: target port ${b.targetNode}.${b.targetPort} no longer exists`);
        return false;
      }
      if (b.sourceKind === 'node-output' && b.sourceNode) {
        const sourceNode = nodesById.get(b.sourceNode);
        if (sourceNode) {
          const sourcePortExists = sourceNode.output?.ports?.some((p) => p.id === b.sourcePort);
          if (!sourcePortExists) {
            this.logger.warn(`Cleaning stale data binding ${b.id}: source port ${b.sourceNode}.${b.sourcePort} no longer exists`);
            return false;
          }
        }
      }
      return true;
    });

    if (cleanedEdges.length !== flow.controlEdges.length || portCleanedBindings.length !== flow.dataBindings.length) {
      this.logger.warn(
        `Cleaned ${flow.controlEdges.length - cleanedEdges.length} orphaned edge(s) and ${flow.dataBindings.length - portCleanedBindings.length} orphaned binding(s) for flow ${flowId}`,
      );
      const doc = await this.flowService.findById(flowId);
      doc.controlEdges = cleanedEdges as any;
      doc.dataBindings = portCleanedBindings as any;
      await doc.save();
      flow.controlEdges = cleanedEdges as any;
      flow.dataBindings = portCleanedBindings as any;
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

    await this.drainQueue(ownerId);

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
      const replayComparableRuntimeFlowSnapshot = this.buildReplayComparableFlowSnapshot({
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
      const replayInputContext = inputContext || {};
      const runtimeInputContext = {
        ...replayInputContext,
        __playbook_workspace_ids: ((snapshotOverride || snapshot) as any).workspaces || [],
        __playbook_default_workspace_id: (((snapshotOverride || snapshot) as any).workspaces || [])[0] || '',
      };
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
        await this.persistReplayPreRunReport({
          executionId,
          flowId,
          taskId,
          replayId: artifacts.replayId,
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
        this.logger.warn(`Skipping gRPC start for execution ${executionId} because it is no longer runnable`);
        return;
      }

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
          metadata: toGrpcStruct(n.metadata),
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
        data_bindings: (snapshot.dataBindings as any[]).map((b) => ({
          id: b.id,
          target_node: b.targetNode,
          target_port: b.targetPort,
          source_kind: b.sourceKind,
          source_node: b.sourceNode || '',
          source_port: b.sourcePort || '',
          iteration: b.iteration || '',
          trigger_path: b.triggerPath || '',
          state_path: b.statePath || '',
          constant_value: toGrpcValue(b.constantValue),
          expression: b.expression || '',
        })),
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
    const call = this.playbookFlowClient.Run(request);
    let finalized = false;
    let completionEmitted = false;
    let lastHandlePromise = Promise.resolve();
    const releaseOnce = () => {
      if (finalized) return;
      finalized = true;
      this.clearSelectedReplayArtifacts(executionId);
      this.drainQueue(ownerId);
    };
    const waitForHandledEvents = async () => {
      await lastHandlePromise;
    };
    call.on('data', (event: Record<string, unknown>) => {
      lastHandlePromise = lastHandlePromise
        .then(() => this.handleRunEvent(executionId, event))
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
        await this.executionModel
          .findByIdAndUpdate(executionId, { status: 'failed', endedAt: new Date(), error: err.message })
          .exec();
        if (!completionEmitted) {
          this.streamEvents.emitExecutionComplete(executionId, 'failed', err.message);
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
          const execution = await this.executionModel.findById(executionId).lean();
          const status = String((execution as Record<string, unknown> | null)?.status || '');
          if (shouldFinalizeStreamAsCompleted(false, false, status)) {
            const failedTask = await this.taskResultModel
              .findOne({ executionId, status: 'failed' })
              .sort({ endedAt: -1 })
              .lean();

            if (failedTask) {
              const errorMessage = String(failedTask.error || 'Execution failed');
              const result = await this.executionModel
                .updateOne(
                  { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
                  { status: 'failed', error: errorMessage, endedAt: new Date() },
                )
                .exec();
              if ((result as { modifiedCount?: number }).modifiedCount) {
                completionEmitted = true;
                this.streamEvents.emitExecutionComplete(executionId, 'failed', errorMessage);
              }
            } else {
              const result = await this.executionModel
                .updateOne(
                  { _id: executionId, status: { $in: ['queued', 'running'] } },
                  { status: 'completed', endedAt: new Date() },
                )
                .exec();
              if ((result as { modifiedCount?: number }).modifiedCount) {
                completionEmitted = true;
                this.streamEvents.emitExecutionComplete(executionId, 'completed');
              }
            }
          }
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
      this.streamEvents.emitExecutionComplete(executionId, 'failed', err instanceof Error ? err.message : String(err));
      await this.drainQueue(ownerId);
    }
  }

  private unwrapGrpcValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;

    if (Array.isArray(value)) return value.map((v) => this.unwrapGrpcValue(v));

    const obj = value as Record<string, unknown>;

    // Selector-less protobuf Struct: { fields: { … } }
    if (!obj.kind && typeof obj.fields === 'object' && obj.fields !== null && !Array.isArray(obj.fields)) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj.fields as Record<string, unknown>)) {
        result[k] = this.unwrapGrpcValue(v);
      }
      return result;
    }

    // Selector-less protobuf Value: { stringValue, numberValue, … }
    if (!obj.kind && 'stringValue' in obj) return obj.stringValue ?? '';
    if (!obj.kind && 'numberValue' in obj) return obj.numberValue ?? 0;
    if (!obj.kind && 'boolValue' in obj) return Boolean(obj.boolValue);
    if (!obj.kind && 'nullValue' in obj) return null;
    if (!obj.kind && 'listValue' in obj && typeof obj.listValue === 'object' && obj.listValue !== null) {
      const values = (obj.listValue as Record<string, unknown>).values;
      if (Array.isArray(values)) return values.map((v) => this.unwrapGrpcValue(v));
    }
    if (!obj.kind && 'structValue' in obj && typeof obj.structValue === 'object' && obj.structValue !== null) {
      const fields = (obj.structValue as Record<string, unknown>).fields;
      if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
          result[k] = this.unwrapGrpcValue(v);
        }
        return result;
      }
    }

    // Kind-tagged protobuf Value: { kind: "structValue", … }
    if (obj.kind === 'structValue' && typeof obj.structValue === 'object' && obj.structValue !== null) {
      const fields = (obj.structValue as Record<string, unknown>).fields;
      if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
          result[k] = this.unwrapGrpcValue(v);
        }
        return result;
      }
    }

    if (obj.kind === 'listValue' && typeof obj.listValue === 'object' && obj.listValue !== null) {
      const values = (obj.listValue as Record<string, unknown>).values;
      if (Array.isArray(values)) return values.map((v) => this.unwrapGrpcValue(v));
    }

    if (obj.kind === 'numberValue') return obj.numberValue ?? 0;
    if (obj.kind === 'stringValue') return obj.stringValue ?? '';
    if (obj.kind === 'boolValue') return Boolean(obj.boolValue);
    if (obj.kind === 'nullValue') return null;

    // Already a plain object (proto-loader auto-unwrapped) — recurse children
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = this.unwrapGrpcValue(v);
    }
    return result;
  }

  private async handleRunEvent(executionId: string, event: Record<string, unknown>): Promise<void> {
    const eventType = event.event_type as string;
    const rawPayload = (event.payload as Record<string, unknown>) || {};
    const payload = (this.unwrapGrpcValue(rawPayload) as Record<string, unknown>) || {};
    const taskNodeId = event.node_id as string;
    const iteration = Number(event.iteration ?? payload.iteration ?? 0);

    this.logger.debug(`Received playbook flow event ${eventType} for execution ${executionId}`);

    if (eventType === 'NodeStarted') {
      if (this.trackedReplayTasksByExecution.get(executionId)?.has(taskNodeId)) {
        try {
          await this.getReplayDriftService().ensureIterationReportMaterialized(executionId, taskNodeId, iteration);
        } catch (err) {
          this.logger.warn(`Failed to materialize replay report for execution ${executionId} task ${taskNodeId} iteration ${iteration}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      await this.taskResultModel.updateOne(
        { executionId, taskId: taskNodeId, iteration },
        {
          $set: {
            status: 'running',
            startedAt: new Date(),
          },
          $setOnInsert: {
            executionId,
            taskId: taskNodeId,
            iteration,
          },
        },
        { upsert: true },
      );
      this.streamEvents.emitStepStart(executionId, taskNodeId);
    } else if (eventType === 'NodeToken') {
      const token = String(payload.token ?? '');
      if (token) {
        await this.taskResultModel.updateOne(
          { executionId, taskId: taskNodeId, iteration },
          [
            {
              $set: {
                status: 'running',
                output: {
                  $concat: [{ $ifNull: ['$output', ''] }, token],
                },
              },
            },
          ],
          { upsert: true },
        );
        this.streamEvents.emitStepUpdate(executionId, taskNodeId, token);
      }
    } else if (eventType === 'NodeCompleted') {
      const resultPayload = this.observabilityService.extractCompletedResultPayload(payload, {
        executionId,
        taskId: taskNodeId,
      });

      await this.taskResultModel.updateOne(
        { executionId, taskId: taskNodeId, iteration },
        {
          $set: {
            status: 'completed',
            output: resultPayload.output,
            displayText: resultPayload.displayText,
            outputs: resultPayload.outputs,
            artifacts: resultPayload.artifacts,
            components: resultPayload.components,
            toolTrace: resultPayload.toolTrace,
            reasoningChain: resultPayload.reasoningChain ?? [],
            llmPromptTrace: resultPayload.llmPromptTrace,
            usage: resultPayload.usage,
            semanticMatch: resultPayload.semanticMatch,
            traceMetadata: resultPayload.traceMetadata,
            error: null,
            endedAt: new Date(),
          },
          $setOnInsert: {
            executionId,
            taskId: taskNodeId,
            iteration,
            startedAt: new Date(),
          },
        },
        { upsert: true },
      );
      try {
        const replayArtifacts = await this.resolveReplayArtifactsForCompletedTask(executionId, taskNodeId, iteration);
        if (replayArtifacts) {
          await this.persistReplayStructuralDrift({
            executionId,
            taskId: taskNodeId,
            iteration,
            output: resultPayload.output,
            toolTrace: resultPayload.toolTrace ?? [],
            reasoningChain: resultPayload.reasoningChain ?? [],
            semanticMatch: resultPayload.semanticMatch ?? null,
            replayArtifacts,
            traceMetadata: resultPayload.traceMetadata,
          });
          this.triggerPostRunEvaluation(executionId, replayArtifacts, taskNodeId, iteration, resultPayload).catch((postErr) => {
            this.logger.warn(`Post-run evaluation failed for ${executionId}:${taskNodeId}: ${postErr instanceof Error ? postErr.message : String(postErr)}`);
          });
        } else if (resultPayload.semanticMatch) {
          try {
            await this.getReplayDriftService().backfillSemanticMatch(executionId, taskNodeId, iteration, resultPayload.semanticMatch);
          } catch (smErr) {
            this.logger.warn(`Failed to backfill semanticMatch for non-applied replay task ${taskNodeId}: ${smErr instanceof Error ? smErr.message : String(smErr)}`);
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to resolve replay artifacts for task ${taskNodeId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.streamEvents.emitStepComplete(
        executionId,
        taskNodeId,
        resultPayload.displayText ?? resultPayload.output,
        undefined,
        iteration,
        resultPayload.artifacts,
        resultPayload.components,
        this.observabilityService.toStreamPayload(resultPayload),
      );

      const execDoc = await this.executionModel.findById(executionId, 'ownerId advisorAutopilotEnabled reflectionEnabled advisorScoringMode').lean().exec();
      if (execDoc?.ownerId && (execDoc.advisorAutopilotEnabled || execDoc.reflectionEnabled)) {
        this.advisorService.runTaskEvaluation(executionId, taskNodeId, String(execDoc.ownerId), {
          iteration,
          advisorScoringMode: execDoc.advisorScoringMode,
        }).catch((err) => {
          this.logger.warn(`Auto-advisor evaluation failed for ${executionId}:${taskNodeId}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    } else if (eventType === 'NodeFailed') {
      const errorMessage = String(payload.error || 'Node execution failed');
      await this.taskResultModel.updateOne(
        { executionId, taskId: taskNodeId, iteration },
        {
          $set: {
            status: 'failed',
            error: errorMessage,
            endedAt: new Date(),
          },
          $setOnInsert: {
            executionId,
            taskId: taskNodeId,
            iteration,
            startedAt: new Date(),
          },
        },
        { upsert: true },
      );
      this.streamEvents.emitStepComplete(executionId, taskNodeId, undefined, errorMessage, iteration);
    } else if (eventType === 'NodeSkipped') {
      await this.taskResultModel.updateOne(
        { executionId, taskId: taskNodeId, iteration },
        {
          $set: {
            status: 'skipped',
            endedAt: new Date(),
          },
          $setOnInsert: {
            executionId,
            taskId: taskNodeId,
            iteration,
            startedAt: new Date(),
          },
        },
        { upsert: true },
      );
      this.streamEvents.emitStepComplete(executionId, taskNodeId, undefined, undefined, iteration);
    } else if (eventType === 'NodeSuspended') {
      const interruptType = String(payload.type || 'human_approval');
      const interruptMessage = String(payload.message || '');
      const interruptId = String(payload.interrupt_id || payload.interruptId || '');
      const taskDescription = String(payload.task_description || '');
      const result = String(payload.result || '');
      const payloadJson = String(payload.conversation_json || payload.payloadJson || '');
      const resumableActions: string[] = Array.isArray(payload.resumable_actions || payload.resumableActions)
        ? (payload.resumable_actions || payload.resumableActions) as string[]
        : [];

      await this.taskResultModel.updateOne(
        { executionId, taskId: taskNodeId, iteration },
        {
          $set: {
            status: 'interrupted',
          },
          $setOnInsert: {
            executionId,
            taskId: taskNodeId,
            iteration,
            startedAt: new Date(),
          },
        },
        { upsert: true },
      );

      await this.executionModel
        .updateOne(
          { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
          {
            status: 'pending_approval',
            pendingApproval: {
              nodeId: taskNodeId,
              iteration,
              prompt: interruptMessage,
              requestedAt: new Date(),
              interruptType,
              interruptId,
              taskTitle: String(payload.task_title || payload.taskTitle || ''),
              taskDescription,
              result,
              payloadJson,
              resumableActions,
            },
          },
        )
        .exec();

      this.streamEvents.emitInterrupt(
        executionId,
        taskNodeId,
        interruptMessage,
        iteration,
        executionId,
        {
          interruptType,
          interruptId,
          taskDescription,
          result,
          payloadJson,
          resumableActions,
        },
      );
    } else if (eventType === 'RouterDecision') {
      const label = String(payload.label || '');
      await this.routerDecisionModel.create({
        executionId,
        routerNodeId: taskNodeId,
        iteration,
        label,
        decidedAt: new Date(),
      });
      this.streamEvents.emitRouterDecision(executionId, taskNodeId, label, iteration);

      if (RESERVED_LABELS.includes(label as any)) {
        this.logger.warn(
          `Execution ${executionId} reached reserved label '${label}' via router ${taskNodeId} iteration ${iteration}`,
        );

        const terminalStatus = label === '__error__' ? 'failed' : 'cancelled';
        const errorMsg = label === '__error__' ? `Router ${taskNodeId} returned __error__` : `Router ${taskNodeId} returned __cancelled__`;

        const result = await this.executionModel
          .updateOne(
            { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
            { status: terminalStatus, error: errorMsg, endedAt: new Date() },
          )
          .exec();

        if ((result as { modifiedCount?: number }).modifiedCount) {
          this.streamEvents.emitExecutionComplete(executionId, terminalStatus, errorMsg);

          const execution = await this.executionModel.findById(executionId, { ownerId: 1 }).lean();
          const owner = execution ? (execution as unknown as Record<string, unknown>).ownerId as string : undefined;
          if (owner) {
            this.drainQueue(owner).catch((err) => {
              this.logger.error(`Failed to drain queue after ${label} for owner ${owner}`, err instanceof Error ? err.stack : undefined);
            });
          }
        }
      }
    } else if (eventType === 'ApprovalRequested') {
      const result = await this.executionModel
        .updateOne(
          { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
          {
            status: 'pending_approval',
            pendingApproval: {
              nodeId: String(payload.node_id || taskNodeId),
              iteration,
              prompt: String(payload.prompt || ''),
              requestedAt: new Date(),
              interruptType: 'approval_request',
              resumableActions: ['approve', 'reject'],
            },
          },
        )
        .exec();
      if ((result as { modifiedCount?: number }).modifiedCount) {
        this.streamEvents.emitInterrupt(
          executionId,
          String(payload.node_id || taskNodeId),
          String(payload.prompt || ''),
          iteration,
          executionId,
          {
            interruptType: 'approval_request',
            resumableActions: ['approve', 'reject'],
          },
        );
      }
    } else if (eventType === 'ExecutionCompleted') {
      const result = await this.executionModel
        .updateOne(
          { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
          { status: 'completed', endedAt: new Date() },
        )
        .exec();
      await this.taskResultModel.updateMany(
        { executionId, status: { $in: ['pending', 'running', 'interrupted'] } },
        { status: 'completed' },
      );
      if (shouldEmitCompletedAfterUpdate((result as { modifiedCount?: number }).modifiedCount)) {
        this.streamEvents.emitExecutionComplete(executionId, 'completed');
      }
    } else if (eventType === 'ExecutionFailed') {
      const errorMessage = String(payload.error || 'Execution failed');
      const result = await this.executionModel
        .updateOne(
          { _id: executionId, status: { $nin: TERMINAL_STATUSES as unknown as string[] } },
          { status: 'failed', error: errorMessage, endedAt: new Date() },
        )
        .exec();
      await this.taskResultModel.updateMany(
        { executionId, status: { $in: ['pending', 'running', 'interrupted'] } },
        { status: 'failed' },
      );
      if ((result as { modifiedCount?: number }).modifiedCount) {
        this.streamEvents.emitExecutionComplete(executionId, 'failed', errorMessage);
      }
    }
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
    if (!this.isGrpcAvailable) return;

    while (true) {
      const next = await this.queueService.release(ownerId, maxConcurrent);
      if (!next) return;

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
    await execution.save();

    await this.taskResultModel.updateMany(
      { executionId, status: { $in: ['pending', 'running', 'interrupted'] } },
      { status: 'cancelled' },
    );

    this.streamEvents.emitExecutionCancelled(executionId);

    if (this.isGrpcAvailable) {
      this.playbookFlowClient.Cancel({ execution_id: executionId }, (err: Error | null) => {
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
    if (execution.status !== 'pending_approval') {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_APPROVAL_NOT_FOUND,
        'No pending approval for this execution',
      );
    }

    if (!this.isGrpcAvailable) {
      throw new ServiceUnavailableException(
        ErrorCode.PLAYBOOK_FLOW_GRPC_UNAVAILABLE,
        'Flow runtime is currently unavailable',
      );
    }

    const resumed = await new Promise<boolean>((resolve, reject) => {
      this.playbookFlowClient.ResumeApproval(
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
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Execution could not be resumed because the runtime no longer has the pending approval state.',
      );
    }

    const resumeUpdate = await this.executionModel.updateOne(
      { _id: executionId, status: 'pending_approval' },
      {
        status: 'running',
        pendingApproval: null,
      },
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

    execution.pendingApproval = null;
    execution.status = 'running';
    return execution.toJSON() as unknown as IFlowExecutionResponse;
  }

  async resumeFromStep(
    executionId: string,
    ownerId: string,
    payload: IResumeFromStepPayload,
  ): Promise<IFlowExecutionResponse> {
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

    if (!this.isGrpcAvailable) {
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
    };

    const resumed = await new Promise<boolean>((resolve, reject) => {
      this.playbookFlowClient.ResumeFromStep(
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
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Execution could not be resumed because the runtime no longer has the pending step interrupt state.',
      );
    }

    const resumeUpdate = await this.executionModel.updateOne(
      { _id: executionId, status: 'pending_approval' },
      {
        status: 'running',
        pendingApproval: null,
      },
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

    execution.pendingApproval = null;
    execution.status = 'running';
    return execution.toJSON() as unknown as IFlowExecutionResponse;
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
    void this.drainQueue(ownerId);

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
        metadata: toGrpcStruct(n.metadata),
      })),
      control_edges: (snapshot.controlEdges as any[]).map((e) => ({
        id: e.id, kind: e.kind, source: e.source, target: e.target,
        router_label: e.routerLabel || '', priority: e.priority || 0,
        source_output_port_id: e.sourceOutputPortId || '', target_input_port_id: e.targetInputPortId || '',
      })),
      data_bindings: (snapshot.dataBindings as any[]).map((b) => ({
        id: b.id, target_node: b.targetNode, target_port: b.targetPort,
        source_kind: b.sourceKind, source_node: b.sourceNode || '', source_port: b.sourcePort || '',
        iteration: b.iteration || '', trigger_path: b.triggerPath || '', state_path: b.statePath || '',
        constant_value: toGrpcValue(b.constantValue), expression: b.expression || '',
      })),
      settings: { recursion_limit: recursionLimit, max_parallelism: maxParallelism },
    };

    const request = {
      execution_id: executionId,
      source_execution_id: sourceExecutionId,
      flow_id: flowId,
      owner_id: normalizedOwnerId,
      snapshot: snapshotProto,
      input_context: toGrpcStruct(inputContext || {}),
      settings: { recursion_limit: recursionLimit, max_parallelism: maxParallelism },
      target_node_id: targetNodeId,
      target_iteration: targetIteration,
    };

    const call = this.playbookFlowClient.RunFromCheckpoint(request);
    let finalized = false;
    let completionEmitted = false;
    let lastHandlePromise = Promise.resolve();

    const releaseOnce = () => {
      if (finalized) return;
      finalized = true;
      this.drainQueue(ownerId);
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
        await this.executionModel
          .findByIdAndUpdate(executionId, { status: 'failed', endedAt: new Date(), error: err.message })
          .exec();
        if (!completionEmitted) {
          this.streamEvents.emitExecutionComplete(executionId, 'failed', err.message);
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
          const execution = await this.executionModel.findById(executionId).lean();
          const status = String((execution as Record<string, unknown> | null)?.status || '');
          if (shouldFinalizeStreamAsCompleted(false, false, status)) {
            const result = await this.executionModel
              .updateOne(
                { _id: executionId, status: { $in: ['queued', 'running'] } },
                { status: 'completed', endedAt: new Date() },
              )
              .exec();
            if ((result as { modifiedCount?: number }).modifiedCount) {
              completionEmitted = true;
              this.streamEvents.emitExecutionComplete(executionId, 'completed');
            }
          }
        }
        releaseOnce();
      })().catch((err) => {
        this.logger.error(`Failed to finalize gRPC RunFromCheckpoint stream for execution ${executionId}`, err instanceof Error ? err.stack : undefined);
        releaseOnce();
      });
    });
  }
}
