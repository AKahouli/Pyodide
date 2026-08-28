import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { FlowExecution, FlowExecutionDocument } from '../schemas/playbook-flow-execution.schema';
import { FlowHitlMemory, FlowHitlMemoryDocument } from '../schemas/playbook-flow-hitl-memory.schema';
import {
  type FlowReplaySignalStatus,
  type FlowReplayRunReportDocument,
  type ReplaySignalEvaluationStatus,
} from '../schemas/playbook-flow-replay-run-report.schema';
import type { ReplayMode } from '../schemas/playbook-flow-validated-replay.schema';
import type {
  ReplayPlanToolStep,
  ReplayPlanningSummary,
  ReplayToolEnforcementAssessment,
} from '../interfaces/playbook-flow-replay-plan.interface';
import type {
  FlowReplayToolCall,
  FlowReplayHitlMemorySnapshot,
} from '../schemas/playbook-flow-validated-replay.schema';
import type {
  FlowTaskPublicReasoningTraceItem,
  FlowTaskSemanticMatch,
} from '../schemas/playbook-flow-task-result.schema';
import type { FlowToolTraceItem } from '../interfaces/playbook-flow-observability.interface';
import type {
  ReplayDriftPolicy,
  ReplayReasoningStage,
  ReplaySemanticChecklistItem,
} from '../interfaces/playbook-flow-replay-template.interface';
import type { ResolvedReplayArtifacts } from '../interfaces/playbook-flow-replay-artifact.interface';
import { PlaybookFlowReplayReportService } from './playbook-flow-replay-report.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { PlaybookFlowReplayPlanService } from './playbook-flow-replay-plan.service';
import { PlaybookFlowReplaySemanticEvaluatorService } from './playbook-flow-replay-semantic-evaluator.service';
import { PlaybookFlowReplaySemanticJudgeService } from './playbook-flow-replay-semantic-judge.service';
import { PlaybookFlowStreamEventsService } from './playbook-flow-stream-events.service';
import {
  averageReplayScores,
  deriveReplayFlexDriftAssessment,
  mergeReplayDriftFindings,
  normalizeReplayScore,
  uniqueReplayStrings,
} from '../utils/playbook-flow-replay-drift.util';
import {
  evaluateToolReplayEnforcement,
  scoreToolPolicyCompliance,
} from '../utils/playbook-flow-tool-policy.util';

export interface CreateReplayPreRunReportInput {
  executionId: string;
  flowId: string;
  taskId: string;
  iteration?: number;
  replayId: string;
  referenceExecutionId: string;
  validationVersion: number;
  mode: ReplayMode;
}

export interface RecordReplayCompletedTaskDriftInput {
  executionId: string;
  taskId: string;
  iteration?: number;
  output: unknown;
  toolTrace: FlowToolTraceItem[];
  reasoningChain: FlowTaskPublicReasoningTraceItem[];
  semanticMatch?: FlowTaskSemanticMatch | null;
  replayArtifacts: ResolvedReplayArtifacts;
  traceMetadata?: Record<string, unknown> | null;
}

interface UpdateReplayStructuralDriftInput {
  executionId: string;
  taskId: string;
  iteration?: number;
  replayId: string;
  referenceExecutionId: string;
  validationVersion: number;
  intentKey: string | null;
  observedIntentKey: string | null;
  toolPolicyScore: number | null;
  outputContractEvaluated: boolean;
  outputContractPassed: boolean;
  structuralDriftScore: number | null;
  structuralDriftReasons: string[];
  baselineToolCalls: FlowReplayToolCall[];
  observedToolTrace: FlowToolTraceItem[];
  expectedToolSteps?: ReplayPlanToolStep[];
  toolAssessment?: ReplayToolEnforcementAssessment | null;
  instantiatedSemanticChecklist?: ReplaySemanticChecklistItem[];
  driftPolicy: ReplayDriftPolicy | null;
  baselineReasoningOutline: ReplayReasoningStage[];
  baselineReasoningChain: FlowTaskPublicReasoningTraceItem[];
  observedReasoningChain: FlowTaskPublicReasoningTraceItem[];
  semanticMatch?: FlowTaskSemanticMatch | null;
  hitlMemorySnapshots?: FlowReplayHitlMemorySnapshot[];
}

type ReplayRunVerdict = 'pass' | 'warning' | 'fail' | 'unknown';
type ReplaySignalReason =
  | 'evaluation_pending'
  | 'intent_not_configured'
  | 'intent_not_evaluated'
  | 'intent_mismatch'
  | 'reasoning_not_configured'
  | 'reasoning_trace_missing'
  | 'reasoning_score_below_threshold'
  | 'tool_trace_not_configured'
  | 'tool_trace_missing'
  | 'tool_sequence_score_below_threshold'
  | 'missing_required_tool'
  | 'wrong_tool_order'
  | 'tool_purpose_mismatch'
  | 'argument_shape_not_captured'
  | 'argument_shape_score_below_threshold'
  | 'stale_context_value_in_tool_args'
  | 'output_contract_not_configured'
  | 'output_contract_failed'
  | 'semantic_evaluation_missing'
  | 'semantic_score_below_threshold'
  | 'semantic_stale_context_references'
  | 'semantic_unsupported_claims';
type ReplayVerdictReason =
  | 'evaluation_pending'
  | 'output_contract_failed'
  | 'strict_tool_policy_failed'
  | 'semantic_score_below_fail_threshold'
  | 'semantic_score_below_pass_threshold'
  | 'structural_score_below_fail_threshold'
  | 'structural_drift_detected'
  | 'tool_policy_warning'
  | 'semantic_missing_points'
  | 'semantic_changed_points';

const SEMANTIC_FAIL_THRESHOLD = 60;
const SEMANTIC_PASS_THRESHOLD = 80;
const STRUCTURAL_FAIL_THRESHOLD = 60;
const SCORE_WARNING_THRESHOLD = 80;

interface ReplaySignalStatuses {
  intentStatus: FlowReplaySignalStatus;
  reasoningStatus: FlowReplaySignalStatus;
  toolSequenceStatus: FlowReplaySignalStatus;
  argumentShapeStatus: FlowReplaySignalStatus;
  outputContractStatus: FlowReplaySignalStatus;
  semanticStatus: FlowReplaySignalStatus;
  contextSubstitutionStatus: FlowReplaySignalStatus;
}

@Injectable()
export class PlaybookFlowReplayDriftService {
  private readonly replaySemanticEvaluator = new PlaybookFlowReplaySemanticEvaluatorService();

  constructor(
    @InjectModel(FlowExecution.name)
    private readonly executionModel: Model<FlowExecutionDocument>,
    private readonly replayReportService: PlaybookFlowReplayReportService,
    private readonly outputContractService: PlaybookFlowOutputContractService,
    private readonly replayPlanService: PlaybookFlowReplayPlanService,
    private readonly logger: LoggerService,
    @Optional() private readonly semanticJudge?: PlaybookFlowReplaySemanticJudgeService,
    @Optional()
    @InjectModel(FlowHitlMemory.name)
    private readonly hitlMemoryModel?: Model<FlowHitlMemoryDocument>,
    @Optional() private readonly streamEvents?: PlaybookFlowStreamEventsService,
  ) {
    this.logger.setContext('PlaybookFlowReplayDriftService');
  }

  async createPreRunReport(params: CreateReplayPreRunReportInput): Promise<FlowReplayRunReportDocument> {
    const iteration = params.iteration ?? 0;
    const hitlSummary = await this.buildReplayHitlSummary({
      referenceExecutionId: params.referenceExecutionId,
      executionId: params.executionId,
      taskId: params.taskId,
      flowId: params.flowId,
    });
    const report = await this.replayReportService.createReport({
      executionId: params.executionId,
      flowId: params.flowId,
      taskId: params.taskId,
      iteration,
      replayId: params.replayId,
      validationVersion: params.validationVersion,
      mode: params.mode,
      outputContractEvaluated: false,
      outputContractPassed: false,
      structuralDriftScore: null,
      toolPolicyScore: null,
      verdict: 'unknown',
      overallScore: null,
      verdictReasons: ['evaluation_pending'],
      structuralDriftReasons: [],
      semanticMatch: null,
      matchedBaselineId: params.replayId,
      matchedBaselineVersion: params.validationVersion,
      intentKey: null,
      replayConfidence: null,
      toolSequenceMatch: null,
      argumentShapeMatch: null,
      reasoningMatch: null,
      outputFormatMatch: null,
      contextDrift: null,
      dataDrift: null,
      driftFindings: [],
      blockedBy: [],
      hitlSummary,
    });

    this.emitReplayHitlSummaryUpdated({
      executionId: params.executionId,
      flowId: params.flowId,
      taskId: params.taskId,
      hitlSummary,
      reportId: String((report as unknown as { _id?: string })._id ?? ''),
      executionMode: params.mode,
    });
    return report;
  }

  async ensureIterationReportMaterialized(
    executionId: string,
    taskId: string,
    iteration: number,
  ): Promise<void> {
    await this.ensureIterationReport({ executionId, taskId }, iteration);
  }

  async recordCompletedTaskDrift(params: RecordReplayCompletedTaskDriftInput): Promise<void> {
    const baselineToolCalls = params.replayArtifacts.toolCalls ?? [];
    const baselineReasoningOutline = params.replayArtifacts.reasoningOutline ?? [];
    const baselineReasoningChain = params.replayArtifacts.reasoningChain ?? [];
    const driftPolicy = params.replayArtifacts.driftPolicy ?? null;
    const intentKey = params.replayArtifacts.intentKey ?? null;
    const hasFlexDriftInputs = params.replayArtifacts.mode === 'replay_flex'
      && (
        baselineToolCalls.length > 0
        || baselineReasoningOutline.length > 0
        || baselineReasoningChain.length > 0
        || driftPolicy !== null
      );
    const hasEvaluationInputs = Boolean(params.replayArtifacts.outputContract)
      || Boolean(params.replayArtifacts.toolPolicy)
      || Boolean(params.semanticMatch)
      || hasFlexDriftInputs;

    if (!hasEvaluationInputs) {
      this.logger.warn(
        `No evaluation inputs for replay drift on execution=${params.executionId} task=${params.taskId}: `
        + `outputContract=${Boolean(params.replayArtifacts.outputContract)}, `
        + `toolPolicy=${Boolean(params.replayArtifacts.toolPolicy)}, `
        + `semanticMatch=${Boolean(params.semanticMatch)}, `
        + `flexDrift=${hasFlexDriftInputs}, `
        + `toolTraceCount=${params.toolTrace.length}, `
        + `reasoningChainLength=${params.reasoningChain.length}`,
      );
      const latestReport = await this.ensureIterationReport(
        { executionId: params.executionId, taskId: params.taskId },
        params.iteration ?? 0,
      );
      if (latestReport?._id) {
        const hitlSummary = await this.buildReplayHitlSummary({
          referenceExecutionId: params.replayArtifacts.referenceExecutionId,
          executionId: params.executionId,
          taskId: params.taskId,
          flowId: params.replayArtifacts.flowId ?? String(latestReport.flowId ?? ''),
          hitlMemorySnapshots: params.replayArtifacts.hitlMemorySnapshots,
        });
        await this.replayReportService.updateReport(latestReport._id as string, {
          verdict: 'unknown',
          overallScore: null,
          verdictReasons: ['evaluation_pending'],
          observedToolCalls: params.toolTrace,
          hitlSummary,
        });
        this.emitReplayHitlSummaryUpdated({
          executionId: params.executionId,
          flowId: String(params.replayArtifacts.flowId ?? latestReport.flowId ?? ''),
          taskId: params.taskId,
          hitlSummary,
          reportId: String(latestReport._id),
          executionMode: String(latestReport.mode ?? params.replayArtifacts.mode),
        });
      }
      return;
    }

    const replayPlanning = await this.loadReplayPlanning(params.executionId, params.taskId);
    const observedIntentKey = this.resolveObservedIntentKeyFromTraceMetadata(params.traceMetadata)
      ?? this.inferObservedIntentKey(intentKey, params.toolTrace, params.semanticMatch);
    const semanticMatch = await this.evaluateSemanticMatch(
      stringifyReplayOutput(params.output),
      replayPlanning,
      params.semanticMatch,
    );
    const validation = this.outputContractService.validateOutputContract({
      output: params.output,
      outputContract: params.replayArtifacts.outputContract ?? null,
    });
    const toolPolicy = scoreToolPolicyCompliance({
      toolPolicy: params.replayArtifacts.toolPolicy ?? null,
      toolTrace: params.toolTrace,
    });
    const toolAssessment = replayPlanning
      ? evaluateToolReplayEnforcement({
          mode: params.replayArtifacts.mode,
          expectedSteps: replayPlanning.executionPlan.plannedToolSteps,
          observedToolTrace: params.toolTrace,
          contextMapping: replayPlanning.contextMapping,
          allowAdditionalTools: params.replayArtifacts.mode === 'replay_adaptive'
            ? true
            : (params.replayArtifacts.driftPolicy?.allowAdditionalTools ?? true),
        })
      : null;

    await this.updateStructuralDrift({
      executionId: params.executionId,
      taskId: params.taskId,
      iteration: params.iteration ?? 0,
      replayId: params.replayArtifacts.replayId,
      referenceExecutionId: params.replayArtifacts.referenceExecutionId,
      validationVersion: params.replayArtifacts.validationVersion,
      intentKey,
      observedIntentKey,
      toolPolicyScore: toolPolicy.score,
      outputContractEvaluated: validation.evaluated,
      outputContractPassed: validation.passed,
      structuralDriftScore: validation.score,
      structuralDriftReasons: validation.reasons,
      baselineToolCalls,
      observedToolTrace: params.toolTrace,
      expectedToolSteps: replayPlanning?.executionPlan.plannedToolSteps ?? [],
      toolAssessment,
      driftPolicy,
      baselineReasoningOutline,
      baselineReasoningChain,
      observedReasoningChain: params.reasoningChain,
      instantiatedSemanticChecklist: replayPlanning?.executionPlan.semanticChecklist ?? [],
      semanticMatch,
      hitlMemorySnapshots: params.replayArtifacts.hitlMemorySnapshots,
    });
  }

  async backfillSemanticMatch(
    executionId: string,
    taskId: string,
    iteration: number,
    semanticMatch: FlowTaskSemanticMatch,
  ): Promise<void> {
    const latestReport = await this.ensureIterationReport({ executionId, taskId }, iteration);
    if (!latestReport?._id) {
      return;
    }

    const outcome = this.deriveReplayOutcome({
      mode: latestReport.mode as ReplayMode,
      outputContractEvaluated: Boolean(latestReport.outputContractEvaluated),
      outputContractPassed: Boolean(latestReport.outputContractPassed),
      structuralDriftScore: normalizeReplayScore(asNumberOrNull(latestReport.structuralDriftScore)),
      toolPolicyScore: normalizeReplayScore(asNumberOrNull(latestReport.toolPolicyScore)),
      structuralDriftReasons: asStringArray(latestReport.structuralDriftReasons),
      semanticMatch,
      replayConfidence: normalizeReplayScore(asNumberOrNull(latestReport.replayConfidence)),
      toolSequenceMatch: normalizeReplayScore(asNumberOrNull(latestReport.toolSequenceMatch)),
      argumentShapeMatch: normalizeReplayScore(asNumberOrNull(latestReport.argumentShapeMatch)),
      reasoningMatch: normalizeReplayScore(asNumberOrNull(latestReport.reasoningMatch)),
      outputFormatMatch: normalizeReplayScore(asNumberOrNull(latestReport.outputFormatMatch)),
      contextDrift: normalizeReplayScore(asNumberOrNull(latestReport.contextDrift)),
      dataDrift: normalizeReplayScore(asNumberOrNull(latestReport.dataDrift)),
      driftFindings: asReplayFindings(latestReport.driftFindings),
      blockedBy: asStringArray(latestReport.blockedBy),
    });

    await this.replayReportService.updateReport(latestReport._id, {
      semanticMatch,
      verdict: outcome.verdict,
      overallScore: outcome.overallScore,
      verdictReasons: outcome.verdictReasons,
      semanticStatus: this.buildSemanticStatus(semanticMatch),
    });

    const latestHitlSummary = this.resolveHitlSummaryFromReport(latestReport);
    if (latestHitlSummary) {
      this.emitReplayHitlSummaryUpdated({
        executionId,
        flowId: String(latestReport.flowId ?? ''),
        taskId,
        hitlSummary: latestHitlSummary,
        reportId: String(latestReport._id ?? ''),
        executionMode: String(latestReport.mode ?? 'replay'),
      });
    }
  }

  private async updateStructuralDrift(params: UpdateReplayStructuralDriftInput): Promise<void> {
    const latestReport = await this.ensureIterationReport(
      {
        executionId: params.executionId,
        taskId: params.taskId,
        replayId: params.replayId,
        validationVersion: params.validationVersion,
      },
      params.iteration ?? 0,
    );
    if (!latestReport?._id) {
      return;
    }

    if (params.baselineToolCalls.length > 0 && params.observedToolTrace.length === 0) {
      this.logger.warn(`Tool trace missing for execution=${params.executionId} task=${params.taskId}: ${params.baselineToolCalls.length} baseline tools configured but no observed tool trace captured`);
    }
    if ((params.baselineReasoningChain.length > 0 || params.baselineReasoningOutline.length > 0) && params.observedReasoningChain.length === 0) {
      this.logger.warn(`Reasoning chain missing for execution=${params.executionId} task=${params.taskId}: baseline reasoning configured but no observed reasoning chain captured`);
    }

    const flexAssessment = latestReport.mode === 'replay_flex'
      ? deriveReplayFlexDriftAssessment({
          driftPolicy: params.driftPolicy,
          baselineIntentKey: params.intentKey,
          observedIntentKey: params.observedIntentKey,
          baselineToolCalls: params.baselineToolCalls,
          observedToolTrace: params.observedToolTrace,
          baselineReasoningOutline: params.baselineReasoningOutline,
          baselineReasoningChain: params.baselineReasoningChain,
          observedReasoningChain: params.observedReasoningChain,
          outputContractEvaluated: params.outputContractEvaluated,
          outputContractPassed: params.outputContractPassed,
          outputFormatMatch: params.structuralDriftScore,
          structuralDriftReasons: params.structuralDriftReasons,
          semanticMatch: params.semanticMatch ?? null,
        })
      : null;
    const outcome = this.deriveReplayOutcome({
      mode: latestReport.mode as ReplayMode,
      outputContractEvaluated: params.outputContractEvaluated,
      outputContractPassed: params.outputContractPassed,
      structuralDriftScore: params.structuralDriftScore,
      toolPolicyScore: params.toolAssessment?.toolPolicyScore ?? params.toolPolicyScore,
      structuralDriftReasons: params.structuralDriftReasons,
      semanticMatch: params.semanticMatch ?? null,
      replayConfidence: flexAssessment?.replayConfidence ?? null,
      toolSequenceMatch: flexAssessment?.toolSequenceMatch ?? params.toolAssessment?.toolSequenceMatch ?? null,
      argumentShapeMatch: flexAssessment?.argumentShapeMatch ?? params.toolAssessment?.argumentShapeMatch ?? null,
      reasoningMatch: flexAssessment?.reasoningMatch ?? null,
      outputFormatMatch: flexAssessment?.outputFormatMatch ?? normalizeReplayScore(params.structuralDriftScore),
      contextDrift: null,
      dataDrift: flexAssessment?.dataDrift ?? normalizeReplayScore(params.semanticMatch?.matchScore ?? null),
      driftFindings: mergeReplayDriftFindings(flexAssessment?.driftFindings ?? [], params.toolAssessment?.findings ?? []),
      blockedBy: uniqueReplayStrings([...(flexAssessment?.blockedBy ?? []), ...(params.toolAssessment?.blockedBy ?? [])]),
    });
    const signalStatuses = this.buildStructuralSignalStatuses(latestReport, params, flexAssessment);
    const hitlSummary = await this.buildReplayHitlSummary({
      referenceExecutionId: params.referenceExecutionId,
      executionId: params.executionId,
      taskId: params.taskId,
      flowId: String(latestReport.flowId ?? ''),
      hitlMemorySnapshots: params.hitlMemorySnapshots,
    });

    await this.replayReportService.updateReport(latestReport._id, {
      outputContractEvaluated: params.outputContractEvaluated,
      outputContractPassed: params.outputContractPassed,
      structuralDriftScore: params.structuralDriftScore,
      toolPolicyScore: params.toolAssessment?.toolPolicyScore ?? params.toolPolicyScore,
      matchedBaselineId: params.replayId,
      matchedBaselineVersion: params.validationVersion,
      intentKey: params.intentKey,
      verdict: outcome.verdict,
      overallScore: outcome.overallScore,
      verdictReasons: outcome.verdictReasons,
      structuralDriftReasons: params.structuralDriftReasons,
      semanticMatch: params.semanticMatch ?? null,
      replayConfidence: flexAssessment?.replayConfidence ?? null,
      toolSequenceMatch: flexAssessment?.toolSequenceMatch ?? params.toolAssessment?.toolSequenceMatch ?? null,
      argumentShapeMatch: flexAssessment?.argumentShapeMatch ?? params.toolAssessment?.argumentShapeMatch ?? null,
      reasoningMatch: flexAssessment?.reasoningMatch ?? null,
      outputFormatMatch: flexAssessment?.outputFormatMatch ?? normalizeReplayScore(params.structuralDriftScore),
      contextDrift: null,
      dataDrift: flexAssessment?.dataDrift ?? normalizeReplayScore(params.semanticMatch?.matchScore ?? null),
      driftFindings: mergeReplayDriftFindings(flexAssessment?.driftFindings ?? [], params.toolAssessment?.findings ?? []),
      blockedBy: uniqueReplayStrings([...(flexAssessment?.blockedBy ?? []), ...(params.toolAssessment?.blockedBy ?? [])]),
      expectedToolSteps: params.expectedToolSteps ?? [],
      observedToolCalls: params.observedToolTrace,
      toolCallComparisons: params.toolAssessment?.comparisons ?? [],
      instantiatedSemanticChecklist: params.instantiatedSemanticChecklist ?? [],
      hitlSummary,
      ...signalStatuses,
    });

    this.emitReplayHitlSummaryUpdated({
      executionId: params.executionId,
      flowId: String(latestReport.flowId ?? ''),
      taskId: params.taskId,
      hitlSummary,
      reportId: String(latestReport._id ?? ''),
      executionMode: String(latestReport.mode ?? 'replay'),
    });
  }

  private resolveHitlSummaryFromReport(report: Record<string, unknown>): Record<string, unknown> | null {
    if (!report || typeof report.hitlSummary !== 'object' || report.hitlSummary === null) {
      return null;
    }

    return report.hitlSummary as Record<string, unknown>;
  }

  private emitReplayHitlSummaryUpdated(params: {
    executionId: string;
    flowId: string;
    taskId: string;
    hitlSummary: Record<string, unknown> | null;
    reportId?: string;
    executionMode?: string;
  }): void {
    this.streamEvents?.emitReplayHitlSummaryUpdated(params.executionId, {
      taskId: params.taskId,
      flowId: params.flowId,
      reportId: params.reportId,
      executionMode: params.executionMode,
      hitlSummary: params.hitlSummary,
    });
  }

  private async loadReplayPlanning(
    executionId: string,
    taskId: string,
  ): Promise<ReplayPlanningSummary | null> {
    const execution = await this.executionModel.findById(executionId, 'replayPlanningByTask').lean().exec();
    const replayPlanningByTask = execution?.replayPlanningByTask;
    if (!replayPlanningByTask || typeof replayPlanningByTask !== 'object') {
      return null;
    }
    const planning = ((replayPlanningByTask as unknown) as Record<string, ReplayPlanningSummary | undefined>)[taskId];
    return planning ?? null;
  }

  private resolveObservedIntentKeyFromTraceMetadata(traceMetadata?: Record<string, unknown> | null): string | null {
    const observedIntentKey = traceMetadata?.['observed_intent_key'];
    return typeof observedIntentKey === 'string' && observedIntentKey !== '' ? observedIntentKey : null;
  }

  private async evaluateSemanticMatch(
    output: string,
    planning: ReplayPlanningSummary | null,
    fallbackSemanticMatch: FlowTaskSemanticMatch | null | undefined,
  ): Promise<FlowTaskSemanticMatch | null> {
    if (!planning || planning.executionPlan.semanticChecklist.length === 0) {
      return fallbackSemanticMatch ?? null;
    }

    if (this.semanticJudge) {
      const contextMappingJson = JSON.stringify(planning.contextMapping, null, 2);
      const judgeResult = await this.semanticJudge.evaluate({ output, planning, contextMappingJson });
      if (judgeResult) {
        return judgeResult;
      }
    }

    return this.replaySemanticEvaluator.evaluate({ output, planning }) ?? fallbackSemanticMatch ?? null;
  }

  private inferObservedIntentKey(
    intentKey: string | null,
    toolTrace: FlowToolTraceItem[],
    semanticMatch: FlowTaskSemanticMatch | null | undefined,
  ): string | null {
    if (!intentKey) return null;
    if (toolTrace.length > 0) return intentKey;
    if (semanticMatch && normalizeReplayScore(semanticMatch.matchScore ?? null) !== null) return intentKey;
    return null;
  }

  private buildSignalStatus(
    status: ReplaySignalEvaluationStatus,
    reason: ReplaySignalReason | null,
  ): FlowReplaySignalStatus {
    return { status, reason };
  }

  private buildSemanticStatus(semanticMatch: FlowTaskSemanticMatch | null): FlowReplaySignalStatus {
    if (!semanticMatch) {
      return this.buildSignalStatus('not_evaluated', 'semantic_evaluation_missing');
    }

    const semanticScore = normalizeReplayScore(semanticMatch.matchScore ?? null);
    if (semanticScore !== null && semanticScore < SEMANTIC_FAIL_THRESHOLD) {
      return this.buildSignalStatus('failed', 'semantic_score_below_threshold');
    }
    if (
      (semanticScore !== null && semanticScore < SEMANTIC_PASS_THRESHOLD)
      || (semanticMatch.missingPoints?.length ?? 0) > 0
      || (semanticMatch.changedPoints?.length ?? 0) > 0
      || (semanticMatch.staleContextReferenceFindings?.length ?? 0) > 0
      || (semanticMatch.unsupportedClaimFindings?.length ?? 0) > 0
    ) {
      if ((semanticMatch.staleContextReferenceFindings?.length ?? 0) > 0) {
        return this.buildSignalStatus('failed', 'semantic_stale_context_references');
      }
      if ((semanticMatch.unsupportedClaimFindings?.length ?? 0) > 0) {
        return this.buildSignalStatus('warning', 'semantic_unsupported_claims');
      }
      return this.buildSignalStatus('warning', semanticScore !== null && semanticScore < SEMANTIC_PASS_THRESHOLD ? 'semantic_score_below_threshold' : null);
    }
    return this.buildSignalStatus('passed', null);
  }

  private scoreToStatus(
    score: number | null,
    belowThresholdReason: ReplaySignalReason,
  ): FlowReplaySignalStatus {
    if (score === null) {
      return this.buildSignalStatus('not_evaluated', 'evaluation_pending');
    }
    if (score < STRUCTURAL_FAIL_THRESHOLD) {
      return this.buildSignalStatus('failed', belowThresholdReason);
    }
    if (score < SCORE_WARNING_THRESHOLD) {
      return this.buildSignalStatus('warning', belowThresholdReason);
    }
    return this.buildSignalStatus('passed', null);
  }

  private buildStructuralSignalStatuses(
    latestReport: Record<string, unknown>,
    params: UpdateReplayStructuralDriftInput,
    flexAssessment: ReturnType<typeof deriveReplayFlexDriftAssessment> | null,
  ): ReplaySignalStatuses {
    const baselineHasReasoning = params.baselineReasoningOutline.length > 0 || params.baselineReasoningChain.length > 0;
    const baselineHasTools = params.baselineToolCalls.length > 0;
    const semanticStatus = this.buildSemanticStatus(params.semanticMatch ?? null);
    const contextSubstitutionStatus = this.buildSignalStatus('not_evaluated', 'evaluation_pending');

    const intentStatus = !params.intentKey
      ? this.buildSignalStatus('not_applicable', 'intent_not_configured')
      : !params.observedIntentKey
        ? this.buildSignalStatus('not_evaluated', 'intent_not_evaluated')
        : params.intentKey === params.observedIntentKey
          ? this.buildSignalStatus('passed', null)
          : this.buildSignalStatus('failed', 'intent_mismatch');

    const reasoningStatus = !baselineHasReasoning
      ? this.buildSignalStatus('not_applicable', 'reasoning_not_configured')
      : params.observedReasoningChain.length === 0
        ? this.buildSignalStatus('not_evaluated', 'reasoning_trace_missing')
        : this.scoreToStatus(flexAssessment?.reasoningMatch ?? null, 'reasoning_score_below_threshold');

    const toolSequenceStatus = !baselineHasTools
      ? this.buildSignalStatus('not_applicable', 'tool_trace_not_configured')
      : params.observedToolTrace.length === 0
        ? this.buildSignalStatus('not_evaluated', 'tool_trace_missing')
        : this.scoreToStatus(
          flexAssessment?.toolSequenceMatch ?? normalizeReplayScore(params.toolPolicyScore),
          'tool_sequence_score_below_threshold',
        );

    const argumentShapeStatus = !baselineHasTools
      ? this.buildSignalStatus('not_applicable', 'tool_trace_not_configured')
      : params.observedToolTrace.length === 0
        ? this.buildSignalStatus('not_evaluated', 'argument_shape_not_captured')
        : this.scoreToStatus(flexAssessment?.argumentShapeMatch ?? null, 'argument_shape_score_below_threshold');

    const outputContractStatus = !params.outputContractEvaluated
      ? this.buildSignalStatus('not_applicable', 'output_contract_not_configured')
      : params.outputContractPassed
        ? this.buildSignalStatus('passed', null)
        : this.buildSignalStatus('failed', 'output_contract_failed');

    return {
      intentStatus,
      reasoningStatus,
      toolSequenceStatus,
      argumentShapeStatus,
      outputContractStatus,
      semanticStatus,
      contextSubstitutionStatus,
    };
  }

  private deriveReplayOutcome(
    report: {
      mode: ReplayMode;
      outputContractEvaluated: boolean;
      outputContractPassed: boolean;
      structuralDriftScore: number | null;
      toolPolicyScore: number | null;
      structuralDriftReasons: string[];
      semanticMatch: FlowTaskSemanticMatch | null;
      replayConfidence: number | null;
      toolSequenceMatch: number | null;
      argumentShapeMatch: number | null;
      reasoningMatch: number | null;
      outputFormatMatch: number | null;
      contextDrift: number | null;
      dataDrift: number | null;
      driftFindings: Array<{ category: string; severity: 'info' | 'warning' | 'fail'; reason: string }>;
      blockedBy: string[];
    },
  ): { verdict: ReplayRunVerdict; overallScore: number | null; verdictReasons: ReplayVerdictReason[] } {
    if (report.mode === 'replay_flex' && report.replayConfidence !== null) {
      const overallScore = normalizeReplayScore(report.replayConfidence);
      if (overallScore === null) {
        return {
          verdict: 'unknown',
          overallScore: null,
          verdictReasons: ['evaluation_pending'],
        };
      }
      if (report.blockedBy.length > 0) {
        const reasons = this.mapFlexReasons(report);
        return { verdict: 'fail', overallScore, verdictReasons: reasons.length > 0 ? reasons : ['structural_drift_detected'] };
      }

      const reasons = this.mapFlexReasons(report);
      if (reasons.length > 0 || report.driftFindings.some((finding) => finding.severity === 'warning')) {
        return { verdict: 'warning', overallScore, verdictReasons: reasons.length > 0 ? reasons : ['structural_drift_detected'] };
      }

      return { verdict: 'pass', overallScore, verdictReasons: [] };
    }

    const semanticScore = normalizeReplayScore(report.semanticMatch?.matchScore ?? null);
    const structuralScore = normalizeReplayScore(
      report.structuralDriftScore
      ?? (report.outputContractEvaluated ? (report.outputContractPassed ? 100 : 0) : null),
    );
    const toolScore = normalizeReplayScore(report.toolPolicyScore);
    const overallScore = averageReplayScores([semanticScore, structuralScore, toolScore]);
    const reasons: ReplayVerdictReason[] = [];

    if (report.outputContractEvaluated && !report.outputContractPassed) {
      reasons.push('output_contract_failed');
      return { verdict: 'fail', overallScore, verdictReasons: reasons };
    }
    if (report.mode === 'replay_strict' && toolScore !== null && toolScore < 100) {
      reasons.push('strict_tool_policy_failed');
      return { verdict: 'fail', overallScore, verdictReasons: reasons };
    }
    if (semanticScore !== null && semanticScore < SEMANTIC_FAIL_THRESHOLD) {
      reasons.push('semantic_score_below_fail_threshold');
      return { verdict: 'fail', overallScore, verdictReasons: reasons };
    }
    if (structuralScore !== null && structuralScore < STRUCTURAL_FAIL_THRESHOLD) {
      reasons.push('structural_score_below_fail_threshold');
      return { verdict: 'fail', overallScore, verdictReasons: reasons };
    }
    if (overallScore === null) {
      return {
        verdict: 'unknown',
        overallScore: null,
        verdictReasons: ['evaluation_pending'],
      };
    }

    if (semanticScore !== null && semanticScore < SEMANTIC_PASS_THRESHOLD) {
      reasons.push('semantic_score_below_pass_threshold');
    }
    if (report.structuralDriftReasons.length > 0) {
      reasons.push('structural_drift_detected');
    }
    if (toolScore !== null && toolScore < 100) {
      reasons.push('tool_policy_warning');
    }
    if (report.semanticMatch?.missingPoints?.length) {
      reasons.push('semantic_missing_points');
    }
    if (report.semanticMatch?.changedPoints?.length) {
      reasons.push('semantic_changed_points');
    }

    if (reasons.length > 0) {
      return { verdict: 'warning', overallScore, verdictReasons: reasons };
    }

    return { verdict: 'pass', overallScore, verdictReasons: [] };
  }

  private mapFlexReasons(report: {
    blockedBy: string[];
    driftFindings: Array<{ category: string; severity: 'info' | 'warning' | 'fail'; reason: string }>;
    semanticMatch: FlowTaskSemanticMatch | null;
    structuralDriftReasons: string[];
  }): ReplayVerdictReason[] {
    const reasons = new Set<ReplayVerdictReason>();
    for (const reason of report.blockedBy) {
      if (reason === 'output_contract_failed') {
        reasons.add('output_contract_failed');
      }
      if (reason === 'semantic_match_below_threshold') {
        reasons.add('semantic_score_below_fail_threshold');
      }
      if (reason === 'reasoning_match_below_threshold' || reason === 'tool_sequence_match_below_threshold' || reason === 'argument_shape_match_below_threshold') {
        reasons.add('structural_drift_detected');
      }
      if (reason === 'intent_mismatch' || reason === 'additional_tools_not_allowed') {
        reasons.add('structural_drift_detected');
      }
    }
    if (report.driftFindings.some((finding) => finding.reason === 'semantic_match_below_threshold' && finding.severity === 'warning')) {
      reasons.add('semantic_score_below_pass_threshold');
    }
    if (report.driftFindings.some((finding) => finding.category !== 'semantic')) {
      reasons.add('structural_drift_detected');
    }
    if (report.semanticMatch?.missingPoints?.length) {
      reasons.add('semantic_missing_points');
    }
    if (report.semanticMatch?.changedPoints?.length) {
      reasons.add('semantic_changed_points');
    }
    if (report.driftFindings.some((finding) => finding.category === 'tool_sequence' || finding.category === 'argument_shape')) {
      reasons.add('tool_policy_warning');
    }
    if (report.driftFindings.some((finding) => finding.reason.startsWith('missing_required_') || finding.reason === 'citation_required' || finding.reason === 'citation_forbidden' || finding.reason === 'json_object_required')) {
      reasons.add('structural_score_below_fail_threshold');
    }
    return Array.from(reasons);
  }

  private async ensureIterationReport(
    baseFilter: Record<string, unknown>,
    iteration: number,
  ): Promise<Record<string, unknown> | null> {
    const exactReport = await this.replayReportService.findLatestReportRecord({ ...baseFilter, iteration });
    if (exactReport?._id || iteration === 0) {
      return exactReport;
    }

    const sourceReport = await this.replayReportService.findLatestReportRecord(baseFilter);
    if (!sourceReport?._id) {
      return null;
    }

    const clone: Record<string, unknown> = {
      ...sourceReport,
      iteration,
      outputContractEvaluated: false,
      outputContractPassed: false,
      structuralDriftScore: null,
      toolPolicyScore: null,
      verdict: 'unknown',
      overallScore: null,
      verdictReasons: ['evaluation_pending'],
      structuralDriftReasons: [],
      semanticMatch: null,
      intentKey: null,
      replayConfidence: null,
      toolSequenceMatch: null,
      argumentShapeMatch: null,
      reasoningMatch: null,
      outputFormatMatch: null,
      contextDrift: null,
      dataDrift: null,
      driftFindings: [],
      blockedBy: [],
      hitlSummary: sourceReport.hitlSummary ?? null,
      expectedToolSteps: sourceReport.expectedToolSteps ?? [],
      observedToolCalls: [],
      toolCallComparisons: [],
      instantiatedSemanticChecklist: sourceReport.instantiatedSemanticChecklist ?? [],
    };
    delete clone._id;
    delete clone.id;
    delete clone.__v;
    delete clone.createdAt;
    delete clone.updatedAt;

    const createdReport = await this.replayReportService.createReport(clone);
    return typeof createdReport?.toJSON === 'function'
      ? (createdReport.toJSON() as Record<string, unknown>)
      : (createdReport as unknown as Record<string, unknown>);
  }

  private async buildReplayHitlSummary(params: {
    referenceExecutionId: string;
    executionId: string;
    taskId: string;
    flowId: string;
    hitlMemorySnapshots?: FlowReplayHitlMemorySnapshot[];
  }): Promise<Record<string, unknown>> {
    const [baselineEvents, runtimeEvents] = await Promise.all([
      this.findHitlEventsForTask(params.referenceExecutionId, params.taskId),
      this.findHitlEventsForTask(params.executionId, params.taskId),
    ]);
    const approvalReaskedCount = runtimeEvents.filter((event) => event.type === 'approval_request').length;
    const findings = this.buildHitlReplayFindings(params.taskId, baselineEvents.length, runtimeEvents.length);
    const reusedMemoryCount = Array.isArray(params.hitlMemorySnapshots)
      ? this.countReusableHitlSnapshots(params.hitlMemorySnapshots)
      : await this.countReusableHitlMemories({
        flowId: params.flowId,
        taskId: params.taskId,
        referenceExecutionId: params.referenceExecutionId,
      });
    return {
      baselineHitlCount: baselineEvents.length,
      runtimeHitlCount: runtimeEvents.length,
      reusedMemoryCount,
      newClarificationCount: runtimeEvents.filter((event) => event.type === 'clarification').length,
      approvalReaskedCount,
      hitlContextDrift: baselineEvents.length > 0 && runtimeEvents.length === 0,
      findings,
    };
  }

  private countReusableHitlSnapshots(snapshots: FlowReplayHitlMemorySnapshot[]): number {
    return snapshots.filter((snapshot) => snapshot.reusableInReplay === true).length;
  }

  private async countReusableHitlMemories(params: {
    flowId: string;
    taskId: string;
    referenceExecutionId: string;
  }): Promise<number> {
    if (!this.hitlMemoryModel || !params.referenceExecutionId) {
      return 0;
    }

    return this.hitlMemoryModel.countDocuments({
      flowId: params.flowId,
      status: 'active',
      createdFromExecutionId: params.referenceExecutionId,
      $or: [{ nodeId: params.taskId }, { nodeId: null }, { nodeId: { $exists: false } }],
    }).exec();
  }

  private async findHitlEventsForTask(executionId: string, taskId: string): Promise<Array<{ type?: string }>> {
    if (!executionId) return [];
    const execution = await this.executionModel.findById(executionId, 'hitlEvents').lean().exec();
    const events = Array.isArray(execution?.hitlEvents) ? execution.hitlEvents : [];
    return events.filter((event: { nodeId?: string; status?: string }) => event.nodeId === taskId && event.status === 'answered');
  }

  private buildHitlReplayFindings(
    taskId: string,
    baselineCount: number,
    runtimeCount: number,
  ): Array<{ severity: 'info' | 'warning' | 'fail'; message: string; nodeId: string }> {
    if (baselineCount > 0 && runtimeCount === 0) {
      return [{
        severity: 'info',
        message: 'baseline_hitl_reused_or_not_needed',
        nodeId: taskId,
      }];
    }
    if (runtimeCount > baselineCount) {
      return [{ severity: 'warning', message: 'additional_runtime_hitl_required', nodeId: taskId }];
    }
    return [];
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

function asReplayFindings(value: unknown): Array<{ category: string; severity: 'info' | 'warning' | 'fail'; reason: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is { category: string; severity: 'info' | 'warning' | 'fail'; reason: string } => (
      Boolean(entry)
      && typeof entry === 'object'
      && typeof (entry as { category?: unknown }).category === 'string'
      && typeof (entry as { severity?: unknown }).severity === 'string'
      && typeof (entry as { reason?: unknown }).reason === 'string'
    ),
  );
}

function stringifyReplayOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value ?? '');
}
