import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FlowExecution, FlowExecutionDocument } from '../../schemas/playbook-flow-execution.schema';
import type { FlowSnapshot } from '../../mappers/flow-to-snapshot.mapper';
import type { ResolvedReplayArtifacts } from '../../interfaces/playbook-flow-replay-artifact.interface';
import type {
  FlowSemanticMatchSummary,
  FlowToolTraceItem,
} from '../../interfaces/playbook-flow-observability.interface';
import type { PublicReasoningTraceItem } from '../../interfaces/playbook-flow-reasoning.interface';
import { PlaybookFlowOutputContractService } from '../../services/playbook-flow-output-contract.service';
import { PlaybookFlowReplayArtifactService } from '../../services/playbook-flow-replay-artifact.service';
import { PlaybookFlowReplayDriftService } from '../../services/playbook-flow-replay-drift.service';
import { PlaybookFlowReplayPlanService } from '../../services/playbook-flow-replay-plan.service';
import { PlaybookFlowReplayPostRunEvaluationService } from '../../services/playbook-flow-replay-post-run-evaluation.service';
import { PlaybookFlowReplayReportService } from '../../services/playbook-flow-replay-report.service';

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

function stripRuntimeAgentMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitizedMetadata = { ...metadata };
  for (const key of RUNTIME_AGENT_METADATA_KEYS) {
    delete sanitizedMetadata[key];
  }
  return sanitizedMetadata;
}

@Injectable()
export class PlaybookExecutionReplayRuntimeService {
  private readonly logger = new Logger(PlaybookExecutionReplayRuntimeService.name);
  private readonly selectedReplayArtifactsByExecution = new Map<
    string,
    Map<string, ResolvedReplayArtifacts>
  >();
  private readonly trackedReplayTasksByExecution = new Map<string, Set<string>>();

  constructor(
    @InjectModel(FlowExecution.name)
    private readonly executionModel: Model<FlowExecutionDocument>,
    private readonly replayArtifactService: PlaybookFlowReplayArtifactService,
    private readonly replayReportService: PlaybookFlowReplayReportService,
    private readonly outputContractService: PlaybookFlowOutputContractService,
    @Optional() private readonly replayPlanService?: PlaybookFlowReplayPlanService,
    @Optional() private readonly replayDriftService?: PlaybookFlowReplayDriftService,
    @Optional() private readonly postRunEvaluationService?: PlaybookFlowReplayPostRunEvaluationService,
  ) {}

  buildComparableFlowSnapshot(snapshot: FlowSnapshot): Record<string, unknown> {
    return {
      nodes: Array.isArray(snapshot.nodes)
        ? snapshot.nodes.map((node) => this.buildComparableNode(node as unknown as Record<string, unknown>))
        : [],
      controlEdges: snapshot.controlEdges || [],
      dataBindings: snapshot.dataBindings || [],
      settings: snapshot.settings || {},
      workspaces: (snapshot as any).workspaces || [],
    };
  }

  async persistPreRunReport(params: {
    executionId: string;
    flowId: string;
    taskId: string;
    iteration?: number;
    replayId: string;
    referenceExecutionId: string;
    validationVersion: number;
    mode: 'replay_strict' | 'replay_flex' | 'replay_adaptive';
  }): Promise<void> {
    try {
      await this.getReplayDriftService().createPreRunReport({
        executionId: params.executionId,
        flowId: params.flowId,
        taskId: params.taskId,
        iteration: params.iteration ?? 0,
        replayId: params.replayId,
        referenceExecutionId: params.referenceExecutionId,
        validationVersion: params.validationVersion,
        mode: params.mode,
      });
    } catch (err) {
      this.logger.warn(`Failed to persist replay report for task ${params.taskId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async persistStructuralDrift(params: {
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

  async triggerPostRunEvaluation(
    executionId: string,
    replayArtifacts: ResolvedReplayArtifacts,
    taskId: string,
    iteration: number,
    resultPayload: { output?: unknown; toolTrace?: unknown[]; reasoningChain?: unknown[] },
  ): Promise<void> {
    if (!this.postRunEvaluationService) return;

    const replayModes = new Set(['replay_strict', 'replay_flex', 'replay_adaptive']);
    if (!replayModes.has(replayArtifacts.mode)) return;

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

  cacheSelectedArtifacts(
    executionId: string,
    taskId: string,
    artifacts: ResolvedReplayArtifacts,
  ): void {
    const byTask = this.selectedReplayArtifactsByExecution.get(executionId) ?? new Map();
    byTask.set(taskId, artifacts);
    this.selectedReplayArtifactsByExecution.set(executionId, byTask);
  }

  trackTask(executionId: string, taskId: string): void {
    const trackedTasks = this.trackedReplayTasksByExecution.get(executionId) ?? new Set<string>();
    trackedTasks.add(taskId);
    this.trackedReplayTasksByExecution.set(executionId, trackedTasks);
  }

  hasTrackedTask(executionId: string, taskId: string): boolean {
    return this.trackedReplayTasksByExecution.get(executionId)?.has(taskId) === true;
  }

  getSelectedArtifacts(
    executionId: string,
    taskId: string,
  ): ResolvedReplayArtifacts | null {
    return this.selectedReplayArtifactsByExecution.get(executionId)?.get(taskId) ?? null;
  }

  async resolveArtifactsForCompletedTask(
    executionId: string,
    taskId: string,
    iteration: number,
  ): Promise<ResolvedReplayArtifacts | null> {
    const cachedArtifacts = this.getSelectedArtifacts(executionId, taskId);
    if (cachedArtifacts) {
      return cachedArtifacts;
    }

    if (!this.hasTrackedTask(executionId, taskId)) {
      return null;
    }

    const replayReport = await this.replayReportService.findLatestReportForExecutionTask(executionId, taskId, iteration);
    if (!replayReport?.replayId) {
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

    this.cacheSelectedArtifacts(executionId, taskId, taskArtifacts);
    return taskArtifacts;
  }

  clear(executionId: string): void {
    this.selectedReplayArtifactsByExecution.delete(executionId);
    this.trackedReplayTasksByExecution.delete(executionId);
  }

  async ensureIterationReportMaterialized(executionId: string, taskId: string, iteration: number): Promise<void> {
    await this.getReplayDriftService().ensureIterationReportMaterialized(executionId, taskId, iteration);
  }

  async backfillSemanticMatch(
    executionId: string,
    taskId: string,
    iteration: number,
    semanticMatch: FlowSemanticMatchSummary,
  ): Promise<void> {
    await this.getReplayDriftService().backfillSemanticMatch(executionId, taskId, iteration, semanticMatch);
  }

  private buildComparableNode(node: Record<string, unknown>): Record<string, unknown> {
    const metadata = node.metadata && typeof node.metadata === 'object'
      ? stripRuntimeAgentMetadata(node.metadata as Record<string, unknown>)
      : {};

    return {
      ...node,
      metadata,
    };
  }

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
}
