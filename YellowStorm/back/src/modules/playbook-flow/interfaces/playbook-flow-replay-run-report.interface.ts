import type { FlowTaskSemanticMatch } from '../models/playbook-flow-task-result.model';
import type { ReplaySemanticChecklistItem } from './playbook-flow-replay-template.interface';
import type { ReplayMode } from './playbook-flow-validated-replay.interface';

/**
 * A replay run report (playbook.replay_run_reports, roadmap P5): what one replayed task produced
 * against its validated baseline. Ids are strings.
 */

export type ReplaySignalEvaluationStatus = 'not_evaluated' | 'not_applicable' | 'passed' | 'warning' | 'failed';

export type ReplayRunVerdict = 'pass' | 'warning' | 'fail' | 'unknown';

export interface FlowReplaySignalStatus {
  status: ReplaySignalEvaluationStatus;
  reason: string | null;
}

export interface FlowReplayDriftFinding {
  category: string;
  severity: 'info' | 'warning' | 'fail';
  reason: string;
}

export interface FlowReplayExpectedToolStep {
  stepIndex: number;
  toolName: string;
  purpose: string;
  required: boolean;
  argumentShape: Record<string, unknown>;
  argumentShapeKeys: string[];
  expectedArgs: Record<string, unknown>;
  sourceCallIndex?: number | null;
}

export interface FlowReplayObservedToolCall {
  callIndex: number;
  toolName: string;
  purpose?: string | null;
  args: Record<string, unknown>;
  outputSummary?: string | null;
  status?: 'completed' | 'failed' | 'skipped' | null;
}

export interface FlowReplayToolCallComparison {
  expectedStepIndex: number | null;
  expectedToolName: string | null;
  expectedPurpose: string | null;
  expectedArgs: Record<string, unknown>;
  observedCallIndex: number | null;
  observedToolName: string | null;
  observedPurpose?: string | null;
  observedArgs: Record<string, unknown>;
  status: 'matched' | 'warning' | 'failed' | 'missing' | 'extra';
  reasons: string[];
}

export interface FlowReplayPostRunEvaluation {
  judgeUsed: boolean;
  judgeModel: string | null;
  evaluatedAt: Date;
  verdict: 'match' | 'minor_drift' | 'major_drift' | 'not_comparable';
  overallScore: number | null;
  semanticMatchScore: number | null;
  outputFormatScore: number | null;
  toolSequenceScore: number | null;
  toolDefinitionScore: number | null;
  reasoningScore: number | null;
  summary: string;
  missingPoints: string[];
  changedPoints: string[];
  preservedPoints: string[];
  recommendedAction: 'accept' | 'review' | 'reject';
  rawJudgeResponse: Record<string, unknown> | null;
  failureReason: string | null;
}

export interface FlowReplayHitlFinding {
  severity: 'info' | 'warning' | 'fail';
  message: string;
  nodeId: string;
}

/**
 * Replay reports need compact HITL counts without loading the full execution audit trail. A type (not
 * an interface) so it can be handed on as a plain record to the stream event.
 */
export interface FlowReplayHitlSummary {
  baselineHitlCount: number;
  runtimeHitlCount: number;
  reusedMemoryCount: number;
  newClarificationCount: number;
  approvalReaskedCount: number;
  hitlContextDrift: boolean;
  findings: FlowReplayHitlFinding[];
}

/** The report document: the promoted columns and the report body kept in `doc`. */
export interface FlowReplayRunReport {
  executionId: string;
  flowId: string;
  taskId: string;
  iteration: number;
  replayId: string;
  validationVersion: number;
  mode: ReplayMode;
  outputContractEvaluated: boolean;
  outputContractPassed: boolean;
  structuralDriftScore: number | null;
  toolPolicyScore: number | null;
  verdict: ReplayRunVerdict | null;
  overallScore: number | null;
  verdictReasons: string[];
  structuralDriftReasons: string[];
  semanticMatch?: FlowTaskSemanticMatch | null;
  matchedBaselineId: string | null;
  matchedBaselineVersion: number | null;
  intentKey: string | null;
  replayConfidence: number | null;
  toolSequenceMatch: number | null;
  argumentShapeMatch: number | null;
  reasoningMatch: number | null;
  outputFormatMatch: number | null;
  contextDrift: number | null;
  dataDrift: number | null;
  driftFindings: FlowReplayDriftFinding[];
  blockedBy: string[];
  expectedToolSteps: FlowReplayExpectedToolStep[];
  observedToolCalls: FlowReplayObservedToolCall[];
  toolCallComparisons: FlowReplayToolCallComparison[];
  instantiatedSemanticChecklist: ReplaySemanticChecklistItem[];
  intentStatus: FlowReplaySignalStatus;
  reasoningStatus: FlowReplaySignalStatus;
  toolSequenceStatus: FlowReplaySignalStatus;
  argumentShapeStatus: FlowReplaySignalStatus;
  outputContractStatus: FlowReplaySignalStatus;
  semanticStatus: FlowReplaySignalStatus;
  contextSubstitutionStatus: FlowReplaySignalStatus;
  postRunEvaluation?: FlowReplayPostRunEvaluation | null;
  hitlSummary?: FlowReplayHitlSummary | null;
}
