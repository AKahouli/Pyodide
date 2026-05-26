import { useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import { ReplayConfidenceBadge } from './ReplayConfidenceBadge';
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

const REPLAY_MODES = new Set(['replay_strict', 'replay_flex', 'replay_adaptive']);
const ACTIVE_EXECUTION_STATUSES = new Set(['queued', 'running', 'pending_approval']);
const REPORT_POLL_INTERVAL_MS = 1500;
const REPORT_POLL_MAX_ATTEMPTS = 40;
const SCORE_WARNING_THRESHOLD = 80;
const SCORE_FAIL_THRESHOLD = 60;

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
    replay_marked_stale: 'replayReport.reason.replayMarkedStale',
    replay_stale_high_risk: 'replayReport.reason.replayStaleHighRisk',
    confidence_below_threshold: 'replayReport.reason.confidenceBelowThreshold',
    required_context_unresolved: 'replayReport.reason.requiredContextUnresolved',
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
    replay_not_applied: 'replayReport.verdictReason.replayNotApplied',
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
    replay_not_applied: 'replayReport.signalReason.replayNotApplied',
    evaluation_pending: 'replayReport.signalReason.evaluationPending',
    confidence_below_threshold: 'replayReport.signalReason.confidenceBelowThreshold',
    required_context_unresolved: 'replayReport.signalReason.requiredContextUnresolved',
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

function confidenceTone(score: number): string {
  if (score >= SCORE_WARNING_THRESHOLD) return 'bg-emerald-100 text-emerald-700';
  if (score >= SCORE_FAIL_THRESHOLD) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

function verdictTone(verdict: ReplayRunReport['verdict']): string {
  switch (verdict) {
    case 'pass':
      return 'bg-emerald-100 text-emerald-700';
    case 'warning':
      return 'bg-amber-100 text-amber-700';
    case 'fail':
      return 'bg-red-100 text-red-700';
    case 'skipped':
      return 'bg-slate-100 text-slate-700';
    default:
      return 'bg-muted text-muted-foreground';
  }
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
  const replayNotAppliedReason = report.invalidationReasons.includes('confidence_below_threshold')
    ? 'confidence_below_threshold'
    : 'replay_not_applied';
  const semanticScore = report.semanticMatch?.matchScore ?? null;

  return {
    contextSubstitution: report.contextSubstitutionStatus ?? {
      status: !report.applied ? 'failed' : report.confidenceScore >= SCORE_WARNING_THRESHOLD ? 'passed' : 'warning',
      reason: !report.applied ? replayNotAppliedReason : null,
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

  const verdict = report.verdict ?? (report.applied ? 'unknown' : 'skipped');
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
  const invalidationReasons = report.invalidationReasons.map((reason) => formatReplayReason(reason, translate));
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
  const skippedSummary = verdict === 'skipped'
    ? formatSignalReason(statuses.contextSubstitution.reason, translate) ?? verdictReasons[0] ?? t('replayReport.verdictReason.replayNotApplied' as any)
    : null;
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

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
      <div className="font-medium">{t('replayReport.title' as any)}</div>

      {postRunEvaluation ? (
        <div className="space-y-3 rounded-md border bg-background p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="font-medium">{t('replayReport.postRun.title' as any)}</div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={postRunVerdictTone(postRunEvaluation.verdict)}>
                  {t(`replayReport.postRun.verdict.${postRunEvaluation.verdict}` as any)}
                </Badge>
                {postRunEvaluation.overallScore !== null && (
                  <ReplayConfidenceBadge
                    label={t('replayReport.postRun.overallScore' as any)}
                    value={formatScore(postRunEvaluation.overallScore)}
                  />
                )}
                <Badge variant="outline" className={postRunActionTone(postRunEvaluation.recommendedAction)}>
                  {t(`replayReport.postRun.action.${postRunEvaluation.recommendedAction}` as any)}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {postRunEvaluation.judgeModel && <span>{postRunEvaluation.judgeModel}</span>}
                {postRunEvaluation.evaluatedAt && (
                  <span>{new Date(postRunEvaluation.evaluatedAt).toLocaleString()}</span>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['semanticMatchScore', 'replayReport.postRun.semanticMatch'],
              ['outputFormatScore', 'replayReport.postRun.outputFormat'],
              ['toolSequenceScore', 'replayReport.postRun.toolSequence'],
              ['toolDefinitionScore', 'replayReport.postRun.toolDefinition'],
              ['reasoningScore', 'replayReport.postRun.reasoning'],
            ] as const).map(([scoreKey, labelKey]) => {
              const score = postRunEvaluation[scoreKey] as number | null;
              if (score === null) {
                return null;
              }
              const normalizedScore = normalizeScore(score) ?? 0;
              return (
                <div key={scoreKey} className="rounded-md border bg-muted/20 p-3">
                  <div className="text-xs font-medium text-muted-foreground">{t(labelKey as any)}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{formatScore(score)}</div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${postRunScoreTone(score)}`}
                      style={{ width: `${Math.max(0, Math.min(100, normalizedScore))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

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

          <Collapsible defaultOpen={false} className="rounded-md border bg-muted/10 p-3">
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 text-left">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('replayReport.postRun.metadataTitle' as any)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('replayReport.postRun.metadataHint' as any)}
                </div>
              </div>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
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
            </CollapsibleContent>
          </Collapsible>
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
        <div className="font-medium">{t('replayReport.postRun.detailsTitle' as any)}</div>
      <div className="space-y-2 rounded-md border bg-background p-3">
        <div className="font-medium">{t('replayReport.section.verdict' as any)}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={verdictTone(verdict)}>
            {t('replayReport.verdict' as any)}: {t(`replayReport.verdictValue.${verdict}` as any)}
          </Badge>
          <ReplayConfidenceBadge label={t('replayReport.overallScore' as any)} value={formatScore(report.overallScore ?? null)} />
          <Badge variant={report.applied ? 'default' : 'secondary'}>{report.applied ? t('replayReport.applied' as any) : t('replayReport.skipped' as any)}</Badge>
        </div>
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
        {skippedSummary && <div className="text-xs text-muted-foreground"><span className="font-medium">{t('replayReport.skippedSummary' as any)}:</span> {skippedSummary}</div>}
      </div>

      <div className="space-y-2 rounded-md border bg-background p-3">
        <div className="font-medium">{t('replayReport.section.eligibility' as any)}</div>
        <div className="flex flex-wrap items-center gap-2">
          <ReplayConfidenceBadge label={t('replayReport.confidence' as any)} value={formatScore(report.confidenceScore)} tone={confidenceTone(report.confidenceScore)} />
          <Badge variant={report.applied ? 'default' : 'secondary'}>{report.applied ? t('replayReport.applied' as any) : t('replayReport.skipped' as any)}</Badge>
        </div>
        {(report.appliedSections.length > 0 || report.skippedSections.length > 0) && (
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <div><span className="font-medium">{t('replayReport.appliedSections' as any)}:</span> {report.appliedSections.length > 0 ? report.appliedSections.join(', ') : '-'}</div>
            <div><span className="font-medium">{t('replayReport.skippedSections' as any)}:</span> {report.skippedSections.length > 0 ? report.skippedSections.join(', ') : '-'}</div>
          </div>
        )}
        {invalidationReasons.length > 0 && <div className="text-xs text-muted-foreground"><span className="font-medium">{t('replayReport.observations' as any)}:</span> {invalidationReasons.join(', ')}</div>}
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
          {semanticEvaluated ? (
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
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="font-medium text-foreground">{t('replayReport.toolComparison.expected' as any)}</div>
                    <div>{comparison.expectedStepIndex !== null ? `#${comparison.expectedStepIndex}` : '-'}</div>
                    <div>{comparison.expectedPurpose ?? '-'}</div>
                    <div>{formatObjectPreview(comparison.expectedArgs)}</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{t('replayReport.toolComparison.observed' as any)}</div>
                    <div>{comparison.observedCallIndex !== null ? `#${comparison.observedCallIndex}` : '-'}</div>
                    <div>{comparison.observedPurpose ?? '-'}</div>
                    <div>{formatObjectPreview(comparison.observedArgs)}</div>
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

      <div className="space-y-2 rounded-md border bg-background p-3">
        <div className="font-medium">{t('replayReport.section.actions' as any)}</div>
        <div className="text-xs text-muted-foreground">{t('replayReport.actionsHint' as any)}</div>
      </div>
      </div>
    </div>
  );
}
