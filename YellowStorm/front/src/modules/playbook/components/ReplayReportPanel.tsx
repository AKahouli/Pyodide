import { useEffect, useState } from 'react';
import { ChevronDown, Info, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useModuleTranslation } from '@/modules/localization';
import { getReplayReports } from '../api';
import type {
  PlaybookExecution,
  ReplayPostRunEvaluation,
  ReplayRunReport,
  ReplaySemanticFinding,
  ReplaySignalEvaluationStatus,
  ReplaySignalStatus,
  ReplayToolCallComparison,
} from '../types';
import { ReplayDriftFindingsList } from './ReplayDriftFindingsList';

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  playbookId: string;
  taskId: string;
  executionId: string;
  iteration?: number;
  execution?: PlaybookExecution | null;
}

interface SignalRow {
  label: string;
  status: ReplaySignalEvaluationStatus;
  reason: string | null;
}

interface ReferenceRunSummary {
  outcomeKey: string;
  description: string;
  score: number | null;
  recommendedActions: string[];
}

interface CheckedRuleItem {
  labelKey: string;
  statusKey: 'passed' | 'changed' | 'needsSetup' | 'notChecked';
  reason: string | null;
}

interface ReferenceCheckViewModel extends ReferenceRunSummary {
  trustLabelKey: string;
  trustTone: string;
  checkedRules: CheckedRuleItem[];
  maintenanceFix: string | null;
  humanInputSummary: string | null;
}

type PostRunScoreKey = 'semanticMatchScore' | 'outputFormatScore' | 'toolSequenceScore' | 'toolDefinitionScore' | 'reasoningScore';

interface PostRunScoreCard {
  scoreKey: PostRunScoreKey;
  labelKey: string;
  tooltipKey: string;
}

interface ScoreCardProps {
  cardKey: string;
  label: string;
  tooltip: string;
  score: number;
}

const REPLAY_MODES = new Set(['replay_strict', 'replay_flex', 'replay_adaptive']);
const ACTIVE_EXECUTION_STATUSES = new Set(['queued', 'running', 'pending_approval']);
const REPORT_POLL_INTERVAL_MS = 1500;
const REPORT_POLL_MAX_ATTEMPTS = 40;
const SCORE_WARNING_THRESHOLD = 80;
const SCORE_FAIL_THRESHOLD = 60;

const POST_RUN_SCORE_CARDS: PostRunScoreCard[] = [
  { scoreKey: 'semanticMatchScore', labelKey: 'replayReport.postRun.semanticMatch', tooltipKey: 'replayReport.postRun.tooltip.semanticMatch' },
  { scoreKey: 'outputFormatScore', labelKey: 'replayReport.postRun.outputFormat', tooltipKey: 'replayReport.postRun.tooltip.outputFormat' },
  { scoreKey: 'toolSequenceScore', labelKey: 'replayReport.postRun.toolSequence', tooltipKey: 'replayReport.postRun.tooltip.toolSequence' },
  { scoreKey: 'toolDefinitionScore', labelKey: 'replayReport.postRun.toolDefinition', tooltipKey: 'replayReport.postRun.tooltip.toolDefinition' },
  { scoreKey: 'reasoningScore', labelKey: 'replayReport.postRun.reasoning', tooltipKey: 'replayReport.postRun.tooltip.reasoning' },
];

function isReplayEnabledExecution(execution: PlaybookExecution | null | undefined, executionId: string, taskId: string): boolean {
  if (!execution || execution.id !== executionId) {
    return false;
  }
  const stepMode = execution.stepExecutionModes?.[taskId];
  if (typeof stepMode === 'string') {
    return REPLAY_MODES.has(stepMode);
  }
  return typeof execution.executionMode === 'string' && REPLAY_MODES.has(execution.executionMode);
}

const REPLAY_REASON_SUBJECT_KEYS: Record<string, string> = {
  input_context: 'replayReport.reasonSubject.inputContext',
  flow_snapshot: 'replayReport.reasonSubject.flowSnapshot',
  node_snapshot: 'replayReport.reasonSubject.nodeSnapshot',
  agent_config: 'replayReport.reasonSubject.agentConfig',
  model_config: 'replayReport.reasonSubject.modelConfig',
  tool_config: 'replayReport.reasonSubject.toolConfig',
  output_contract: 'replayReport.reasonSubject.outputContract',
};

function humanizeFallback(value: string): string {
  return value
    .split(/[_:]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatReplaySubject(value: string, t: Translate): string {
  const key = REPLAY_REASON_SUBJECT_KEYS[value];
  return key ? t(key) : humanizeFallback(value);
}

function formatReplayReason(value: string, t: Translate): string {
  const directKeys: Record<string, string> = {
    missing_replay_baseline: 'replayReport.reason.missingReplayBaseline',
    baseline_fingerprints_missing: 'replayReport.reason.baselineFingerprintsMissing',
    intent_not_evaluated: 'replayReport.reason.intentNotEvaluated',
    intent_mismatch: 'replayReport.reason.intentMismatch',
    additional_tools_not_allowed: 'replayReport.reason.additionalToolsNotAllowed',
    citation_required: 'replayReport.reason.citationRequired',
    citation_forbidden: 'replayReport.reason.citationForbidden',
    json_object_required: 'replayReport.reason.jsonObjectRequired',
    missing_required_tool: 'replayReport.reason.missingRequiredTool',
    wrong_tool_order: 'replayReport.reason.wrongToolOrder',
    tool_purpose_mismatch: 'replayReport.reason.toolPurposeMismatch',
    argument_shape_mismatch: 'replayReport.reason.argumentShapeMismatch',
    stale_context_value_in_tool_args: 'replayReport.reason.staleContextValueInToolArgs',
  };
  const directKey = directKeys[value];
  if (directKey) {
    return t(directKey);
  }

  const currentMissing = /^current_(.+)_missing$/.exec(value);
  if (currentMissing) {
    return t('replayReport.reason.currentMissing', { subject: formatReplaySubject(currentMissing[1], t) });
  }
  const baselineMissing = /^baseline_(.+)_missing$/.exec(value);
  if (baselineMissing) {
    return t('replayReport.reason.baselineMissing', { subject: formatReplaySubject(baselineMissing[1], t) });
  }
  const mismatch = /^(.+)_mismatch$/.exec(value);
  if (mismatch) {
    return t('replayReport.reason.mismatch', { subject: formatReplaySubject(mismatch[1], t) });
  }
  const missingSection = /^missing_required_section:(.+)$/.exec(value);
  if (missingSection) {
    return t('replayReport.reason.missingRequiredSection', { section: missingSection[1] });
  }
  const forbiddenSection = /^forbidden_section_present:(.+)$/.exec(value);
  if (forbiddenSection) {
    return t('replayReport.reason.forbiddenSectionPresent', { section: forbiddenSection[1] });
  }
  const invalidType = /^invalid_type:([^:]+):(.+)$/.exec(value);
  if (invalidType) {
    return t('replayReport.reason.invalidType', { field: invalidType[1], type: invalidType[2] });
  }
  const missingRequiredKey = /^missing_required_key:(.+)$/.exec(value);
  if (missingRequiredKey) {
    return t('replayReport.reason.missingRequiredKey', { field: missingRequiredKey[1] });
  }
  return humanizeFallback(value);
}

function formatVerdictReason(value: string, t: Translate): string {
  const keys: Record<string, string> = {
    evaluation_pending: 'replayReport.verdictReason.evaluationPending',
    output_contract_failed: 'replayReport.verdictReason.outputContractFailed',
    strict_tool_policy_failed: 'replayReport.verdictReason.strictToolPolicyFailed',
    semantic_score_below_fail_threshold: 'replayReport.verdictReason.semanticScoreBelowFailThreshold',
    semantic_score_below_pass_threshold: 'replayReport.verdictReason.semanticScoreBelowPassThreshold',
    structural_score_below_fail_threshold: 'replayReport.verdictReason.structuralScoreBelowFailThreshold',
    structural_drift_detected: 'replayReport.verdictReason.structuralDriftDetected',
    tool_policy_warning: 'replayReport.verdictReason.toolPolicyWarning',
    semantic_missing_points: 'replayReport.verdictReason.semanticMissingPoints',
    semantic_changed_points: 'replayReport.verdictReason.semanticChangedPoints',
  };
  return keys[value] ? t(keys[value]) : humanizeFallback(value);
}

function formatDriftFindingReason(value: string, t: Translate): string {
  const keys: Record<string, string> = {
    confidence_below_threshold: 'replayReport.finding.confidenceBelowThreshold',
    reasoning_match_below_threshold: 'replayReport.finding.reasoningMatchBelowThreshold',
    tool_sequence_match_below_threshold: 'replayReport.finding.toolSequenceMatchBelowThreshold',
    argument_shape_match_below_threshold: 'replayReport.finding.argumentShapeMatchBelowThreshold',
    semantic_match_below_threshold: 'replayReport.finding.semanticMatchBelowThreshold',
    intent_not_evaluated: 'replayReport.finding.intentNotEvaluated',
    intent_mismatch: 'replayReport.finding.intentMismatch',
    additional_tools_not_allowed: 'replayReport.finding.additionalToolsNotAllowed',
    output_contract_failed: 'replayReport.verdictReason.outputContractFailed',
    semantic_missing_points: 'replayReport.verdictReason.semanticMissingPoints',
    semantic_changed_points: 'replayReport.verdictReason.semanticChangedPoints',
    missing_required_tool: 'replayReport.reason.missingRequiredTool',
    wrong_tool_order: 'replayReport.reason.wrongToolOrder',
    tool_purpose_mismatch: 'replayReport.reason.toolPurposeMismatch',
    argument_shape_mismatch: 'replayReport.reason.argumentShapeMismatch',
    stale_context_value_in_tool_args: 'replayReport.reason.staleContextValueInToolArgs',
  };
  return keys[value] ? t(keys[value]) : formatReplayReason(value, t);
}

function formatHitlFindingMessage(value: string, t: Translate): string {
  const keys: Record<string, string> = {
    baseline_hitl_reused_or_not_needed: 'replayReport.hitl.finding.baselineReused',
    hitl_context_drift: 'replayReport.hitl.finding.contextDrift',
    additional_runtime_hitl_required: 'replayReport.hitl.finding.additionalRuntimeHitl',
  };
  return keys[value] ? t(keys[value]) : humanizeFallback(value);
}

function formatObjectPreview(value: Record<string, unknown> | null | undefined): string {
  if (!value || Object.keys(value).length === 0) {
    return '-';
  }
  return JSON.stringify(value);
}

function comparisonTone(status: ReplayToolCallComparison['status']): string {
  switch (status) {
    case 'matched':
      return 'bg-emerald-100 text-emerald-700';
    case 'warning':
      return 'bg-amber-100 text-amber-700';
    case 'failed':
    case 'missing':
    case 'extra':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function formatSignalReason(value: string | null | undefined, t: Translate): string | null {
  if (!value) {
    return null;
  }
  const keys: Record<string, string> = {
    evaluation_pending: 'replayReport.signalReason.evaluationPending',
    intent_not_configured: 'replayReport.signalReason.intentNotConfigured',
    intent_not_evaluated: 'replayReport.signalReason.intentNotEvaluated',
    intent_mismatch: 'replayReport.signalReason.intentMismatch',
    reasoning_not_configured: 'replayReport.signalReason.reasoningNotConfigured',
    reasoning_trace_missing: 'replayReport.signalReason.reasoningTraceMissing',
    reasoning_score_below_threshold: 'replayReport.signalReason.reasoningScoreBelowThreshold',
    tool_trace_not_configured: 'replayReport.signalReason.toolTraceNotConfigured',
    tool_trace_missing: 'replayReport.signalReason.toolTraceMissing',
    argument_shape_not_captured: 'replayReport.signalReason.argumentShapeNotCaptured',
    tool_sequence_score_below_threshold: 'replayReport.signalReason.toolSequenceScoreBelowThreshold',
    argument_shape_score_below_threshold: 'replayReport.signalReason.argumentShapeScoreBelowThreshold',
    output_contract_not_configured: 'replayReport.signalReason.outputContractNotConfigured',
    output_contract_failed: 'replayReport.signalReason.outputContractFailed',
    semantic_evaluation_missing: 'replayReport.signalReason.semanticEvaluationMissing',
    semantic_score_below_threshold: 'replayReport.signalReason.semanticScoreBelowThreshold',
    semantic_stale_context_references: 'replayReport.signalReason.semanticStaleContextReferences',
    semantic_unsupported_claims: 'replayReport.signalReason.semanticUnsupportedClaims',
  };
  return keys[value] ? t(keys[value]) : formatReplayReason(value, t);
}

function renderSemanticFindingText(finding: ReplaySemanticFinding): string {
  const parts = [finding.key, finding.expected, finding.observed].filter(Boolean);
  return parts.length > 0 ? parts.join(' | ') : '-';
}

function formatScore(value: number | null): string {
  if (value === null || value === undefined) return '-';
  const normalized = value > 0 && value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

function normalizeScore(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value > 0 && value <= 1 ? value * 100 : value;
}

function formatJsonPreview(value: Record<string, unknown> | null): string {
  if (!value) {
    return '-';
  }
  return JSON.stringify(value, null, 2);
}

function verdictTone(verdict: ReplayRunReport['verdict']): string {
  switch (verdict) {
    case 'pass':
      return 'bg-emerald-100 text-emerald-700';
    case 'warning':
      return 'bg-amber-100 text-amber-700';
    case 'fail':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function getOutcomeKey(verdict: ReplayRunReport['verdict']): string {
  if (verdict === 'pass') return 'consistent';
  if (verdict === 'warning') return 'needsReview';
  if (verdict === 'fail') return 'blocked';
  return 'pending';
}

function buildReferenceRunSummary(params: {
  report: ReplayRunReport;
  verdict: ReplayRunReport['verdict'];
  statuses: Record<string, ReplaySignalStatus>;
  verdictReasons: string[];
  t: Translate;
}): ReferenceRunSummary {
  const { report, verdict, statuses, verdictReasons, t } = params;
  const outcomeKey = getOutcomeKey(verdict);
  const recommendedActions = new Set<string>();

  if (statuses.outputContract.status === 'failed' || statuses.outputContract.reason === 'output_contract_not_configured') {
    recommendedActions.add(t('replayReport.action.createExpectedFormat'));
  }
  if (verdict === 'warning') {
    recommendedActions.add(t('replayReport.action.reviewChanges'));
  }
  if (verdict === 'fail') {
    recommendedActions.add(t('replayReport.action.updateReference'));
  }
  if (recommendedActions.size === 0) {
    recommendedActions.add(t('replayReport.action.keepReference'));
  }

  return {
    outcomeKey,
    description: t(`replayReport.outcome.${outcomeKey}.description`),
    score: report.overallScore ?? null,
    recommendedActions: [...recommendedActions].slice(0, 3),
  };
}

function mapRuleStatus(status: ReplaySignalEvaluationStatus): CheckedRuleItem['statusKey'] {
  if (status === 'passed') return 'passed';
  if (status === 'warning' || status === 'failed') return 'changed';
  if (status === 'not_applicable') return 'needsSetup';
  return 'notChecked';
}

function buildHumanInputSummary(report: ReplayRunReport, t: Translate): string | null {
  const hitlSummary = report.hitlSummary;
  if (!hitlSummary) return null;
  const total = hitlSummary.baselineHitlCount
    + hitlSummary.runtimeHitlCount
    + hitlSummary.reusedMemoryCount
    + hitlSummary.newClarificationCount
    + hitlSummary.approvalReaskedCount;
  if (total === 0 && !hitlSummary.hitlContextDrift && hitlSummary.findings.length === 0) {
    return null;
  }
  if (hitlSummary.newClarificationCount > 0) {
    return t('replayReport.humanInput.newClarifications', { count: hitlSummary.newClarificationCount });
  }
  if (hitlSummary.hitlContextDrift) {
    return t('replayReport.humanInput.contextChanged');
  }
  return t('replayReport.humanInput.used');
}

function buildReferenceCheckViewModel(params: {
  report: ReplayRunReport;
  summary: ReferenceRunSummary;
  statuses: Record<string, ReplaySignalStatus>;
  t: Translate;
}): ReferenceCheckViewModel {
  const { report, summary, statuses, t } = params;
  const checkedRules: CheckedRuleItem[] = [
    { labelKey: 'replayReport.rule.sameContext', statusKey: mapRuleStatus(statuses.contextSubstitution.status), reason: formatSignalReason(statuses.contextSubstitution.reason, t) },
    { labelKey: 'replayReport.rule.sameIntent', statusKey: mapRuleStatus(statuses.intent.status), reason: formatSignalReason(statuses.intent.reason, t) },
    { labelKey: 'replayReport.rule.sameReasoning', statusKey: mapRuleStatus(statuses.reasoning.status), reason: formatSignalReason(statuses.reasoning.reason, t) },
    { labelKey: 'replayReport.rule.requiredEvidenceSteps', statusKey: mapRuleStatus(statuses.toolSequence.status), reason: formatSignalReason(statuses.toolSequence.reason, t) },
    { labelKey: 'replayReport.rule.expectedAnswerFormat', statusKey: mapRuleStatus(statuses.outputContract.status), reason: formatSignalReason(statuses.outputContract.reason, t) },
    { labelKey: 'replayReport.rule.sameAnswerMeaning', statusKey: mapRuleStatus(statuses.semantic.status), reason: formatSignalReason(statuses.semantic.reason, t) },
  ];
  const maintenanceFix = statuses.outputContract.status === 'not_applicable' || statuses.outputContract.reason === 'output_contract_not_configured'
    ? t('replayReport.fix.createExpectedFormat')
    : summary.outcomeKey === 'needsReview'
      ? t('replayReport.fix.reviewChanges')
      : summary.outcomeKey === 'blocked'
        ? t('replayReport.fix.updateReference')
        : null;

  return {
    ...summary,
    trustLabelKey: `replayReport.trust.${summary.outcomeKey}`,
    trustTone: summary.outcomeKey === 'consistent'
      ? 'border-emerald-500/30 bg-emerald-500/10'
      : summary.outcomeKey === 'blocked'
        ? 'border-red-500/30 bg-red-500/10'
        : 'border-amber-500/30 bg-amber-500/10',
    checkedRules,
    maintenanceFix,
    humanInputSummary: buildHumanInputSummary(report, t),
  };
}

function ruleTone(status: CheckedRuleItem['statusKey']): string {
  if (status === 'passed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'changed') return 'bg-amber-100 text-amber-700';
  if (status === 'needsSetup') return 'bg-blue-100 text-blue-700';
  return 'bg-slate-100 text-slate-700';
}

function findingTone(severity: 'info' | 'warning' | 'fail'): string {
  if (severity === 'fail') return 'bg-red-100 text-red-700';
  if (severity === 'warning') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
}

function signalTone(status: ReplaySignalEvaluationStatus): string {
  switch (status) {
    case 'passed':
      return 'bg-emerald-100 text-emerald-700';
    case 'warning':
      return 'bg-amber-100 text-amber-700';
    case 'failed':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function isEvaluated(status: ReplaySignalStatus | null | undefined): boolean {
  return status?.status === 'passed' || status?.status === 'warning' || status?.status === 'failed';
}

function postRunVerdictTone(verdict: ReplayPostRunEvaluation['verdict']): string {
  switch (verdict) {
    case 'match':
      return 'bg-emerald-100 text-emerald-700';
    case 'minor_drift':
      return 'bg-amber-100 text-amber-700';
    case 'major_drift':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function postRunActionTone(action: ReplayPostRunEvaluation['recommendedAction']): string {
  switch (action) {
    case 'accept':
      return 'bg-emerald-100 text-emerald-700';
    case 'review':
      return 'bg-amber-100 text-amber-700';
    case 'reject':
      return 'bg-red-100 text-red-700';
  }
}

function postRunScoreTone(score: number | null | undefined): string {
  const normalized = normalizeScore(score);
  if (normalized === null) return 'bg-muted';
  if (normalized >= SCORE_WARNING_THRESHOLD) return 'bg-emerald-500';
  if (normalized >= SCORE_FAIL_THRESHOLD) return 'bg-amber-500';
  return 'bg-red-500';
}

function deriveFallbackScoreStatus(score: number | null | undefined, failReason: string): ReplaySignalStatus {
  if (score === null || score === undefined) {
    return { status: 'not_evaluated', reason: 'evaluation_pending' };
  }
  if (score < SCORE_FAIL_THRESHOLD) {
    return { status: 'failed', reason: failReason };
  }
  if (score < SCORE_WARNING_THRESHOLD) {
    return { status: 'warning', reason: failReason };
  }
  return { status: 'passed', reason: null };
}

function deriveSignalStatuses(report: ReplayRunReport): Record<string, ReplaySignalStatus> {
  const semanticScore = report.semanticMatch?.matchScore ?? null;

  return {
    contextSubstitution: report.contextSubstitutionStatus ?? {
      status: 'not_evaluated',
      reason: 'evaluation_pending',
    },
    intent: report.intentStatus ?? (report.intentKey
      ? { status: 'not_evaluated', reason: 'intent_not_evaluated' }
      : { status: 'not_applicable', reason: 'intent_not_configured' }),
    reasoning: report.reasoningStatus ?? deriveFallbackScoreStatus(report.reasoningMatch ?? null, 'reasoning_score_below_threshold'),
    toolSequence: report.toolSequenceStatus ?? (
      report.toolSequenceMatch !== null && report.toolSequenceMatch !== undefined
        ? deriveFallbackScoreStatus(report.toolSequenceMatch, 'tool_sequence_score_below_threshold')
        : { status: 'not_evaluated', reason: 'tool_trace_missing' }
    ),
    argumentShape: report.argumentShapeStatus ?? (
      report.argumentShapeMatch !== null && report.argumentShapeMatch !== undefined
        ? deriveFallbackScoreStatus(report.argumentShapeMatch, 'argument_shape_score_below_threshold')
        : { status: 'not_evaluated', reason: 'argument_shape_not_captured' }
    ),
    outputContract: report.outputContractStatus ?? (
      report.outputContractEvaluated
        ? { status: report.outputContractPassed ? 'passed' : 'failed', reason: report.outputContractPassed ? null : 'output_contract_failed' }
        : { status: 'not_applicable', reason: 'output_contract_not_configured' }
    ),
    semantic: report.semanticStatus ?? (
      !report.semanticMatch
        ? { status: 'not_evaluated', reason: 'semantic_evaluation_missing' }
        : deriveFallbackScoreStatus(semanticScore, 'semantic_score_below_threshold')
    ),
  };
}

function ScoreCard({ cardKey, label, tooltip, score }: ScoreCardProps) {
  const normalizedScore = normalizeScore(score) ?? 0;

  return (
    <div key={cardKey} className="rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={tooltip}>
              <Info className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs leading-relaxed">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="mt-1 text-lg font-semibold text-foreground">{formatScore(score)}</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${postRunScoreTone(score)}`}
          style={{ width: `${Math.max(0, Math.min(100, normalizedScore))}%` }}
        />
      </div>
    </div>
  );
}

export function ReplayReportPanel({ playbookId, taskId, executionId, iteration = 0, execution }: Props) {
  const { t } = useModuleTranslation('playbook');
  const translate: Translate = (key, options) => t(key as any, options as any);
  const [report, setReport] = useState<ReplayRunReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollingExhausted, setPollingExhausted] = useState(false);
  const [postRunPending, setPostRunPending] = useState(false);
  const executionStepMode = execution?.stepExecutionModes?.[taskId];
  const replayEnabled = isReplayEnabledExecution(execution, executionId, taskId);
  const replayExecutionActive = Boolean(execution && replayEnabled && ACTIVE_EXECUTION_STATUSES.has(execution.status));

  useEffect(() => {
    setReport(null);
    setLoading(true);
    setError(null);
    setPollingExhausted(false);
    setPostRunPending(false);
  }, [playbookId, taskId, executionId, iteration]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const shouldPollForReport = () => replayExecutionActive;
    const shouldPollForReportAfterCompletion = (nextReport: ReplayRunReport | null) =>
      !nextReport && !replayExecutionActive && replayEnabled;
    const shouldPollForPostRunEvaluation = (nextReport: ReplayRunReport | null) => Boolean(
      nextReport && !nextReport.postRunEvaluation,
    );

    const loadReport = (silent = false) => {
      let pendingRetry = false;
      let receivedVisibleReport = false;
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      getReplayReports(playbookId, taskId, { executionId, iteration, limit: 1 })
        .then((reports) => {
          if (cancelled) return;
          const nextReport = reports[0] ?? null;
          setReport(nextReport);
          receivedVisibleReport = Boolean(nextReport);
          const waitingForReport = shouldPollForReport() || shouldPollForReportAfterCompletion(nextReport);
          const waitingForPostRun = shouldPollForPostRunEvaluation(nextReport);

          if ((waitingForReport || waitingForPostRun) && attempts < REPORT_POLL_MAX_ATTEMPTS) {
            attempts += 1;
            pendingRetry = true;
            setPostRunPending(waitingForPostRun || waitingForReport);
            timeoutId = setTimeout(() => loadReport(true), REPORT_POLL_INTERVAL_MS);
          } else if (waitingForReport || waitingForPostRun) {
            setPostRunPending(waitingForPostRun || waitingForReport);
            setPollingExhausted(true);
          } else {
            setPostRunPending(false);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report');
        })
        .finally(() => {
          if (!cancelled && (!pendingRetry || receivedVisibleReport)) setLoading(false);
        });
    };

    loadReport(report !== null);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [playbookId, taskId, executionId, iteration, execution?.status, execution?.executionMode, executionStepMode, replayExecutionActive]);

  if (loading) {
    return (
      <div className="rounded-md border border-muted bg-muted/20 p-6">
        <div className="flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin" />
          <span>{t('replayReport.loading' as any)}</span>
        </div>
      </div>
    );
  }
  if (error) {
    return <div className="rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground">{t('replayReport.loadFailed' as any)}</div>;
  }
  if (!report) {
    if (execution && !isReplayEnabledExecution(execution, executionId, taskId)) {
      return <div className="rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground">{t('replayReport.notApplicable' as any)}</div>;
    }
    if (execution && isReplayEnabledExecution(execution, executionId, taskId) && ACTIVE_EXECUTION_STATUSES.has(execution.status)) {
      if (pollingExhausted) {
        return <div className="rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground">{t('replayReport.pending' as any)}</div>;
      }
      return (
        <div className="rounded-md border border-muted bg-muted/20 p-6">
          <div className="flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin" />
            <span>{t('replayReport.loading' as any)}</span>
          </div>
        </div>
      );
    }
    return <div className="rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground">{t('replayReport.empty' as any)}</div>;
  }

  const verdict = report.verdict ?? 'unknown';
  const statuses = deriveSignalStatuses(report);
  const semanticMatch = report.semanticMatch ?? null;
  const semanticEvaluated = Boolean(semanticMatch);
  const hasSemanticObservations = Boolean(
    semanticMatch?.reason
    || semanticMatch?.missingPoints?.length
    || semanticMatch?.changedPoints?.length
    || semanticMatch?.preservedPoints?.length
    || semanticMatch?.missingPointFindings?.length
    || semanticMatch?.changedPointFindings?.length
    || semanticMatch?.extraPointFindings?.length
    || semanticMatch?.staleContextReferenceFindings?.length
    || semanticMatch?.unsupportedClaimFindings?.length,
  );
  const preservedPoints = semanticMatch?.preservedPoints ?? [];
  const missingPointFindings = semanticMatch?.missingPointFindings ?? [];
  const changedPointFindings = semanticMatch?.changedPointFindings ?? [];
  const extraPointFindings = semanticMatch?.extraPointFindings ?? [];
  const staleContextReferenceFindings = semanticMatch?.staleContextReferenceFindings ?? [];
  const unsupportedClaimFindings = semanticMatch?.unsupportedClaimFindings ?? [];
  const structuralDriftReasons = report.structuralDriftReasons.map((reason) => formatReplayReason(reason, translate));
  const verdictReasons = (report.verdictReasons ?? []).map((reason) => formatVerdictReason(reason, translate));
  const driftFindings = (report.driftFindings ?? []).map((finding) => ({ ...finding, label: formatDriftFindingReason(finding.reason, translate) }));
  const signalRows: SignalRow[] = [
    { label: t('replayReport.signal.contextSubstitution' as any), status: statuses.contextSubstitution.status, reason: formatSignalReason(statuses.contextSubstitution.reason, translate) },
    { label: t('replayReport.signal.intent' as any), status: statuses.intent.status, reason: formatSignalReason(statuses.intent.reason, translate) },
    { label: t('replayReport.signal.reasoning' as any), status: statuses.reasoning.status, reason: formatSignalReason(statuses.reasoning.reason, translate) },
    { label: t('replayReport.signal.toolSequence' as any), status: statuses.toolSequence.status, reason: formatSignalReason(statuses.toolSequence.reason, translate) },
    { label: t('replayReport.signal.argumentShape' as any), status: statuses.argumentShape.status, reason: formatSignalReason(statuses.argumentShape.reason, translate) },
    { label: t('replayReport.signal.outputContract' as any), status: statuses.outputContract.status, reason: formatSignalReason(statuses.outputContract.reason, translate) },
    { label: t('replayReport.signal.semantic' as any), status: statuses.semantic.status, reason: formatSignalReason(statuses.semantic.reason, translate) },
  ];
  const referenceSummary = buildReferenceRunSummary({
    report,
    verdict,
    statuses,
    verdictReasons,
    t: translate,
  });
  const showFlexScores = report.mode === 'replay_flex' && (
    report.contextDrift !== null && report.contextDrift !== undefined
    || report.reasoningMatch !== null && report.reasoningMatch !== undefined
    || report.toolSequenceMatch !== null && report.toolSequenceMatch !== undefined
    || report.argumentShapeMatch !== null && report.argumentShapeMatch !== undefined
    || report.outputFormatMatch !== null && report.outputFormatMatch !== undefined
    || report.dataDrift !== null && report.dataDrift !== undefined
    || driftFindings.length > 0
    || (report.blockedBy?.length ?? 0) > 0
  );
  const showStructuralSignals = structuralDriftReasons.length > 0 || isEvaluated(statuses.outputContract) || report.toolPolicyScore !== null;
  const toolCallComparisons = report.toolCallComparisons ?? [];
  const showToolCallEvidence = (report.expectedToolSteps?.length ?? 0) > 0 || toolCallComparisons.length > 0;
  const postRunEvaluation = report.postRunEvaluation;
  const hitlSummary = report.hitlSummary ?? null;
  const referenceCheck = buildReferenceCheckViewModel({
    report,
    summary: referenceSummary,
    statuses,
    t: translate,
  });
  const businessScoreCards = [
    referenceCheck.score !== null ? {
      cardKey: 'trustLevel',
      label: t('replayReport.outcome.trustLevel' as any),
      tooltip: t('replayReport.outcome.tooltip.trustLevel' as any),
      score: referenceCheck.score,
    } : null,
    ...(postRunEvaluation
      ? POST_RUN_SCORE_CARDS
        .map(({ scoreKey, labelKey, tooltipKey }) => {
          const score = postRunEvaluation[scoreKey];
          if (score === null) {
            return null;
          }

          return {
            cardKey: scoreKey,
            label: t(labelKey as any),
            tooltip: t(tooltipKey as any),
            score,
          };
        })
      : []),
  ].filter((card): card is { cardKey: string; label: string; tooltip: string; score: number } => card !== null);

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
      <div className="font-medium">{t('replayReport.title' as any)}</div>

      <div className={`space-y-3 rounded-md border p-4 ${referenceCheck.trustTone}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={verdictTone(verdict)}>
            {t(referenceCheck.trustLabelKey as any)}
          </Badge>
        </div>
        <div className="text-sm text-muted-foreground">{referenceCheck.description}</div>
      </div>

      {businessScoreCards.length > 0 && (
        <TooltipProvider delayDuration={200}>
          <div className="grid gap-3 sm:grid-cols-2">
            {businessScoreCards.map((card) => (
              <ScoreCard key={card.cardKey} {...card} />
            ))}
          </div>
        </TooltipProvider>
      )}

      {postRunEvaluation ? (
        <div className="space-y-3 rounded-md border bg-background p-3">
          {postRunEvaluation.summary && (
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('replayReport.postRun.summary' as any)}
              </div>
              <div className="mt-2 text-sm text-foreground">{postRunEvaluation.summary}</div>
            </div>
          )}

          <div className="grid gap-3 xl:grid-cols-3">
            {[
              ['preservedPoints', 'replayReport.postRun.preserved'],
              ['missingPoints', 'replayReport.postRun.missing'],
              ['changedPoints', 'replayReport.postRun.changed'],
            ].map(([pointsKey, labelKey]) => {
              const points = postRunEvaluation[pointsKey as keyof ReplayPostRunEvaluation] as string[];
              return (
                <div key={pointsKey} className="rounded-md border bg-muted/10 p-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(labelKey as any)}</div>
                  {points.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs text-foreground">
                      {points.map((point, index) => (
                        <li key={`${pointsKey}-${index}`} className="leading-relaxed">{point}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">-</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-muted bg-muted/20 p-6">
          <div className="flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin" />
            <span>{postRunPending && !pollingExhausted ? t('replayReport.postRun.loading' as any) : t('replayReport.postRun.notAvailable' as any)}</span>
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-md border bg-background p-3">
        <div className="font-medium">{t('replayReport.recommendedActions' as any)}</div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {referenceCheck.recommendedActions.map((action) => (
            <Badge key={action} variant="outline" className="bg-muted/40 text-foreground">
              {action}
            </Badge>
          ))}
        </div>
      </div>

      <div className="space-y-2 rounded-md border bg-background p-3">
        <div className="font-medium">{t('replayReport.rulesChecked' as any)}</div>
        <div className="space-y-2">
          {referenceCheck.checkedRules.map((rule) => (
            <div key={rule.labelKey} className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <div className="font-medium text-foreground">{t(rule.labelKey as any)}</div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <Badge variant="outline" className={ruleTone(rule.statusKey)}>
                  {t(`replayReport.ruleStatus.${rule.statusKey}` as any)}
                </Badge>
                {rule.reason && <span>{rule.reason}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {referenceCheck.humanInputSummary && (
        <div className="space-y-1 rounded-md border bg-background p-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">{t('replayReport.humanInput.title' as any)}</div>
          <div>{referenceCheck.humanInputSummary}</div>
        </div>
      )}

      {referenceCheck.maintenanceFix && (
        <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">{t('replayReport.recommendedFix' as any)}</div>
          <div>{referenceCheck.maintenanceFix}</div>
        </div>
      )}

      <Collapsible defaultOpen={false} className="rounded-md border bg-background p-3">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 text-left">
          <div>
            <div className="font-medium">{t('replayReport.postRun.detailsTitle' as any)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t('replayReport.advancedHint' as any)}</div>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-2 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          {hitlSummary && (
            <div className="space-y-2 rounded-md border bg-background p-3">
              <div className="font-medium">{t('replayReport.hitl.title' as any)}</div>
              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-5">
                <div><div className="font-medium">{t('replayReport.hitl.baselineCount' as any)}</div><div className="mt-1 text-sm text-foreground">{hitlSummary.baselineHitlCount}</div></div>
                <div><div className="font-medium">{t('replayReport.hitl.runtimeCount' as any)}</div><div className="mt-1 text-sm text-foreground">{hitlSummary.runtimeHitlCount}</div></div>
                <div><div className="font-medium">{t('replayReport.hitl.reusedMemoryCount' as any)}</div><div className="mt-1 text-sm text-foreground">{hitlSummary.reusedMemoryCount}</div></div>
                <div><div className="font-medium">{t('replayReport.hitl.newClarificationCount' as any)}</div><div className="mt-1 text-sm text-foreground">{hitlSummary.newClarificationCount}</div></div>
                <div><div className="font-medium">{t('replayReport.hitl.approvalReaskedCount' as any)}</div><div className="mt-1 text-sm text-foreground">{hitlSummary.approvalReaskedCount}</div></div>
              </div>
              {hitlSummary.hitlContextDrift && (
                <Badge variant="outline" className="bg-amber-100 text-amber-700">
                  {t('replayReport.hitl.contextDrift' as any)}
                </Badge>
              )}
              {hitlSummary.findings.length > 0 && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {hitlSummary.findings.map((finding, index) => (
                    <div key={`${finding.nodeId}-${index}`} className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={findingTone(finding.severity)}>
                        {t(`replayReport.findingSeverity.${finding.severity}` as any)}
                      </Badge>
                      <span>{formatHitlFindingMessage(finding.message, translate)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {postRunEvaluation && (
            <div className="space-y-3 rounded-md border bg-muted/10 p-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('replayReport.postRun.metadataTitle' as any)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('replayReport.postRun.metadataHint' as any)}
                </div>
              </div>
              <div className="font-medium text-foreground">{t('replayReport.postRun.title' as any)}</div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={postRunVerdictTone(postRunEvaluation.verdict)}>
                  {t(`replayReport.postRun.verdict.${postRunEvaluation.verdict}` as any)}
                </Badge>
                <Badge variant="outline" className={postRunActionTone(postRunEvaluation.recommendedAction)}>
                  {t(`replayReport.postRun.action.${postRunEvaluation.recommendedAction}` as any)}
                </Badge>
              </div>
              {postRunEvaluation.overallScore !== null && (
                <TooltipProvider delayDuration={200}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ScoreCard
                      cardKey="postRunOverallScore"
                      label={t('replayReport.postRun.overallScore' as any)}
                      tooltip={t('replayReport.postRun.tooltip.overallScore' as any)}
                      score={postRunEvaluation.overallScore}
                    />
                  </div>
                </TooltipProvider>
              )}
              <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  <div className="font-medium text-foreground">{t('replayReport.postRun.evaluatedBy' as any)}</div>
                  <div className="mt-1">{postRunEvaluation.judgeModel ?? '-'}</div>
                </div>
                <div>
                  <div className="font-medium text-foreground">{t('replayReport.postRun.evaluatedAt' as any)}</div>
                  <div className="mt-1">{postRunEvaluation.evaluatedAt ? new Date(postRunEvaluation.evaluatedAt).toLocaleString() : '-'}</div>
                </div>
              </div>
              {postRunEvaluation.failureReason && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                  <div className="font-medium">{t('replayReport.postRun.failureReason' as any)}</div>
                  <div className="mt-1">{postRunEvaluation.failureReason}</div>
                </div>
              )}
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('replayReport.postRun.rawJudgeResponse' as any)}
                </div>
                <pre className="mt-2 overflow-x-auto rounded-md border bg-background p-3 text-[11px] leading-relaxed text-foreground">{formatJsonPreview(postRunEvaluation.rawJudgeResponse)}</pre>
              </div>
            </div>
          )}

      <div className="space-y-2 rounded-md border bg-background p-3">
        <div className="font-medium">{t('replayReport.section.verdict' as any)}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={verdictTone(verdict)}>
            {t('replayReport.verdict' as any)}: {t(`replayReport.verdictValue.${verdict}` as any)}
          </Badge>
        </div>
        {report.overallScore !== null && report.overallScore !== undefined && (
          <TooltipProvider delayDuration={200}>
            <div className="grid gap-3 sm:grid-cols-2">
              <ScoreCard
                cardKey="technicalOverallScore"
                label={t('replayReport.overallScore' as any)}
                tooltip={t('replayReport.overallScoreTooltip' as any)}
                score={report.overallScore}
              />
            </div>
          </TooltipProvider>
        )}
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <div className="font-medium">{t('replayReport.mode' as any)}</div>
            <div className="mt-1 text-sm text-foreground">{t(`replayReport.modeValue.${report.mode}` as any)}</div>
          </div>
          <div>
            <div className="font-medium">{t('replayReport.baselineVersion' as any)}</div>
            <div className="mt-1 text-sm text-foreground">v{report.validationVersion}</div>
          </div>
          {report.replayConfidence !== null && report.replayConfidence !== undefined && (
            <div>
              <div className="font-medium">{t('replayReport.replayConfidence' as any)}</div>
              <div className="mt-1 text-sm text-foreground">{formatScore(report.replayConfidence)}</div>
            </div>
          )}
        </div>
        {verdictReasons.length > 0 && <div className="text-xs text-muted-foreground"><span className="font-medium">{t('replayReport.verdictReasons' as any)}:</span> {verdictReasons.join(', ')}</div>}
      </div>

      <div className="space-y-2 rounded-md border bg-background p-3">
        <div className="font-medium">{t('replayReport.section.signalStatuses' as any)}</div>
        <div className="space-y-2">
          {signalRows.map((signal) => (
            <div key={signal.label} className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <div className="font-medium text-foreground">{signal.label}</div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <Badge variant="outline" className={signalTone(signal.status)}>
                  {t(`replayReport.signalStatus.${signal.status}` as any)}
                </Badge>
                {signal.reason && <span>{signal.reason}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {(semanticMatch || statuses.semantic.reason) && (
        <div className="space-y-2 rounded-md border bg-background p-3">
          <div className="font-medium">{t('replayReport.section.semantic' as any)}</div>
          {semanticMatch ? (
            <>
              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                <div><div className="font-medium">{t('replayReport.semanticOverall' as any)}</div><div className="mt-1 text-sm text-foreground">{formatScore(semanticMatch?.matchScore ?? null)}</div></div>
                <div><div className="font-medium">{t('replayReport.semanticSimilarity' as any)}</div><div className="mt-1 text-sm text-foreground">{formatScore(semanticMatch?.semanticSimilarityScore ?? null)}</div></div>
                <div><div className="font-medium">{t('replayReport.semanticEvidence' as any)}</div><div className="mt-1 text-sm text-foreground">{formatScore(semanticMatch?.evidenceConsistencyScore ?? null)}</div></div>
                <div><div className="font-medium">{t('replayReport.semanticJudge' as any)}</div><div className="mt-1 text-sm text-foreground">{formatScore(semanticMatch?.judgeScore ?? null)}</div></div>
              </div>
              {hasSemanticObservations && (
                <div className="space-y-2 text-xs text-muted-foreground">
                  {semanticMatch?.reason && <div><span className="font-medium">{t('replayReport.semanticReason' as any)}:</span> {semanticMatch.reason}</div>}
                  {preservedPoints.length > 0 && <div><span className="font-medium">{t('replayReport.semanticPreserved' as any)}:</span> {preservedPoints.join(', ')}</div>}
                  {(semanticMatch?.missingPoints?.length ?? 0) > 0 && <div><span className="font-medium">{t('replayReport.semanticMissing' as any)}:</span> {semanticMatch?.missingPoints?.join(', ')}</div>}
                  {(semanticMatch?.changedPoints?.length ?? 0) > 0 && <div><span className="font-medium">{t('replayReport.semanticChanged' as any)}:</span> {semanticMatch?.changedPoints?.join(', ')}</div>}
                  {missingPointFindings.length > 0 && <div><span className="font-medium">{t('replayReport.semanticMissingStructured' as any)}:</span> {missingPointFindings.map(renderSemanticFindingText).join('; ')}</div>}
                  {changedPointFindings.length > 0 && <div><span className="font-medium">{t('replayReport.semanticChangedStructured' as any)}:</span> {changedPointFindings.map(renderSemanticFindingText).join('; ')}</div>}
                  {extraPointFindings.length > 0 && <div><span className="font-medium">{t('replayReport.semanticExtra' as any)}:</span> {extraPointFindings.map(renderSemanticFindingText).join('; ')}</div>}
                  {staleContextReferenceFindings.length > 0 && <div><span className="font-medium">{t('replayReport.semanticStaleContext' as any)}:</span> {staleContextReferenceFindings.map(renderSemanticFindingText).join('; ')}</div>}
                  {unsupportedClaimFindings.length > 0 && <div><span className="font-medium">{t('replayReport.semanticUnsupportedClaims' as any)}:</span> {unsupportedClaimFindings.map(renderSemanticFindingText).join('; ')}</div>}
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-muted-foreground">{formatSignalReason(statuses.semantic.reason, translate) ?? t('replayReport.semanticEmpty' as any)}</div>
          )}
        </div>
      )}

      {showFlexScores && (
        <div className="space-y-2 rounded-md border bg-background p-3">
          <div className="font-medium">{t('replayReport.section.driftPolicy' as any)}</div>
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
            {isEvaluated(statuses.contextSubstitution) && <div><div className="font-medium">{t('replayReport.contextDrift' as any)}</div><div className="mt-1 text-sm text-foreground">{formatScore(report.contextDrift ?? null)}</div></div>}
            {isEvaluated(statuses.reasoning) && <div><div className="font-medium">{t('replayReport.reasoningMatch' as any)}</div><div className="mt-1 text-sm text-foreground">{formatScore(report.reasoningMatch ?? null)}</div></div>}
            {isEvaluated(statuses.toolSequence) && <div><div className="font-medium">{t('replayReport.toolSequenceMatch' as any)}</div><div className="mt-1 text-sm text-foreground">{formatScore(report.toolSequenceMatch ?? null)}</div></div>}
            {isEvaluated(statuses.argumentShape) && <div><div className="font-medium">{t('replayReport.argumentShapeMatch' as any)}</div><div className="mt-1 text-sm text-foreground">{formatScore(report.argumentShapeMatch ?? null)}</div></div>}
            {report.outputFormatMatch !== null && report.outputFormatMatch !== undefined && <div><div className="font-medium">{t('replayReport.outputFormatMatch' as any)}</div><div className="mt-1 text-sm text-foreground">{formatScore(report.outputFormatMatch ?? null)}</div></div>}
            {isEvaluated(statuses.semantic) && <div><div className="font-medium">{t('replayReport.dataDrift' as any)}</div><div className="mt-1 text-sm text-foreground">{formatScore(report.dataDrift ?? null)}</div></div>}
          </div>
          {driftFindings.length > 0 && (
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="font-medium">{t('replayReport.driftFindings' as any)}</div>
              <ReplayDriftFindingsList findings={driftFindings} findingTone={findingTone} />
            </div>
          )}
          {(report.blockedBy?.length ?? 0) > 0 && <div className="text-xs text-muted-foreground"><span className="font-medium">{t('replayReport.blockedBy' as any)}:</span> {(report.blockedBy ?? []).map((reason) => formatDriftFindingReason(reason, translate)).join(', ')}</div>}
        </div>
      )}

      {showStructuralSignals && (
        <div className="space-y-2 rounded-md border bg-background p-3">
          <div className="font-medium">{t('replayReport.section.structuralTooling' as any)}</div>
          <div className="space-y-2 text-xs text-muted-foreground">
            {structuralDriftReasons.length > 0 && <div><span className="font-medium">{t('replayReport.driftReasons' as any)}:</span> {structuralDriftReasons.join(', ')}{report.structuralDriftScore !== null && ` (${formatScore(report.structuralDriftScore)})`}</div>}
            {isEvaluated(statuses.outputContract) && (
              <div>
                <span className="font-medium">{t('replayReport.outputContract' as any)}:</span>{' '}
                <Badge variant={report.outputContractPassed ? 'default' : 'destructive'} className="px-1 py-0 text-[10px]">
                  {report.outputContractPassed ? t('replayReport.pass' as any) : t('replayReport.fail' as any)}
                </Badge>
              </div>
            )}
            {report.toolPolicyScore !== null && <div><span className="font-medium">{t('replayReport.toolPolicy' as any)}:</span> {formatScore(report.toolPolicyScore)}</div>}
          </div>
        </div>
      )}

      {showToolCallEvidence && (
        <div className="space-y-2 rounded-md border bg-background p-3">
          <div className="font-medium">{t('replayReport.section.toolCalls' as any)}</div>
          <div className="space-y-2 text-xs text-muted-foreground">
            {toolCallComparisons.map((comparison, index) => (
              <div key={`${comparison.expectedStepIndex ?? 'extra'}:${comparison.observedCallIndex ?? index}`} className="rounded border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={comparisonTone(comparison.status)}>
                    {t(`replayReport.toolComparisonStatus.${comparison.status}` as any)}
                  </Badge>
                  <span className="font-medium text-foreground">
                    {comparison.expectedToolName ?? comparison.observedToolName ?? t('replayReport.toolComparison.unknownTool' as any)}
                  </span>
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2 rounded-md bg-muted/20 p-2">
                    <div className="font-medium text-foreground">{t('replayReport.toolComparison.expected' as any)}</div>
                    <div><span className="font-medium text-foreground">{t('replayReport.toolComparison.index' as any)}:</span> {comparison.expectedStepIndex !== null ? `#${comparison.expectedStepIndex}` : '-'}</div>
                    <div>
                      <div className="font-medium text-foreground">{t('replayReport.toolComparison.capturedText' as any)}</div>
                      <div className="mt-1 whitespace-pre-wrap break-words">{comparison.expectedPurpose ?? '-'}</div>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{t('replayReport.toolComparison.arguments' as any)}</div>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded border bg-background p-2 text-[11px] text-foreground">{formatObjectPreview(comparison.expectedArgs)}</pre>
                    </div>
                  </div>
                  <div className="space-y-2 rounded-md bg-muted/20 p-2">
                    <div className="font-medium text-foreground">{t('replayReport.toolComparison.observed' as any)}</div>
                    <div><span className="font-medium text-foreground">{t('replayReport.toolComparison.index' as any)}:</span> {comparison.observedCallIndex !== null ? `#${comparison.observedCallIndex}` : '-'}</div>
                    <div>
                      <div className="font-medium text-foreground">{t('replayReport.toolComparison.capturedText' as any)}</div>
                      <div className="mt-1 whitespace-pre-wrap break-words">{comparison.observedPurpose ?? '-'}</div>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{t('replayReport.toolComparison.arguments' as any)}</div>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded border bg-background p-2 text-[11px] text-foreground">{formatObjectPreview(comparison.observedArgs)}</pre>
                    </div>
                  </div>
                </div>
                {comparison.reasons.length > 0 && (
                  <div className="mt-2">
                    <span className="font-medium text-foreground">{t('replayReport.toolComparison.reasons' as any)}:</span>{' '}
                    {comparison.reasons.map((reason) => formatDriftFindingReason(reason, translate)).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
