import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ClipboardCheck, ClipboardCopy, Download, FileText, Loader2, MoreHorizontal, Trash2, Pencil, Check, CheckSquare, RotateCcw } from 'lucide-react';
import { HumanFeedbackInline } from './HumanFeedbackInline';
import { ArtifactBadge } from './ArtifactBadge';
import { AdvisorChangeReviewDialog } from './AdvisorChangeReviewDialog';
import { AdvisorResultPanel } from './AdvisorResultPanel';
import { IteratorResultPanel } from './IteratorResultPanel';
import { StepComponents } from './StepComponents';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { showError, showSuccess } from '@/lib/notifications';
import type { TaskResult, PlaybookExecution, PlaybookPageMode, ValidatedTaskReplay, TaskArtifact, AdvisorRemediationItem, RemediationCategory, PlaybookEvaluationExecution } from '../types';
import { PORT_COLORS } from '../utils/port-colors';

const REMEDIATION_CATEGORY_COLORS: Record<RemediationCategory, string> = {
  structure: 'bg-purple-100 text-purple-700 border-purple-200',
  prompt: 'bg-blue-100 text-blue-700 border-blue-200',
  contract: 'bg-amber-100 text-amber-700 border-amber-200',
  handoff: 'bg-rose-100 text-rose-700 border-rose-200',
  tooling: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  evidence: 'bg-sky-100 text-sky-700 border-sky-200',
  outputFormat: 'bg-orange-100 text-orange-700 border-orange-200',
};

function RemediationItemRow({
  text,
  category,
  onApply,
}: {
  text: string;
  category: RemediationCategory;
  onApply: () => void;
}) {
  const { t } = useModuleTranslation('playbook');
  return (
    <div className="rounded border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2 mb-1">
        <Badge variant="outline" className={cn('text-[10px] border', REMEDIATION_CATEGORY_COLORS[category])}>
          {t(`detail.remediation.category.${category}`)}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{text}</p>
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onApply}>
          <CheckSquare className="mr-1 h-3 w-3" />
          {t('detail.remediation.apply')}
        </Button>
      </div>
    </div>
  );
}

function ArtifactListItem({
  artifact,
}: {
  artifact: TaskArtifact;
}) {
  const { t } = useModuleTranslation('playbook');
  const colors = PORT_COLORS[artifact.artifactKind];
  const Icon = colors?.icon || FileText;

  const handleDownload = () => {
    if (!artifact.url && !artifact.content) return;
    if (artifact.content) {
      const blob = new Blob([artifact.content], { type: artifact.mimeType || 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = artifact.filename || `artifact-${artifact.portId}`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (artifact.url) {
      const a = document.createElement('a');
      a.href = artifact.url;
      a.download = artifact.filename || `artifact-${artifact.portId}`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
    }
  };

  const hasDownload = !!(artifact.url || artifact.content);
  const kindLabel = t(`artifactKind.${artifact.artifactKind}`);

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', colors?.bg || 'bg-muted')}>
        <Icon className={cn('h-4 w-4', colors?.dot.replace('bg-', 'text-') || 'text-muted-foreground')} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{artifact.filename || artifact.portId}</span>
          <span className="shrink-0 rounded-full border border-muted-foreground/20 bg-muted/50 px-1.5 py-0 text-[10px] text-muted-foreground">
            {kindLabel}
          </span>
        </div>
        {artifact.size != null && (
          <span className="text-xs text-muted-foreground">{(artifact.size / 1024).toFixed(1)} KB</span>
        )}
        {artifact.content && !artifact.url && (
          <p className="mt-1 max-h-20 overflow-y-auto rounded bg-muted/50 p-2 font-mono text-xs text-muted-foreground whitespace-pre-wrap break-words">
            {artifact.content.length > 500 ? artifact.content.slice(0, 500) + '...' : artifact.content}
          </p>
        )}
      </div>
      {hasDownload && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 h-7 px-2 text-xs"
          onClick={handleDownload}
        >
          <Download className="mr-1 h-3 w-3" />
          {t('artifacts.download' as any)}
        </Button>
      )}
    </div>
  );
}
import { useModuleTranslation } from '@/modules/localization';
import { usePlaybookStore } from '../store';
import { downloadStepResultHtml, downloadStepResultPdf, renderStepResultHtml } from '../utils/renderStepResultHtml';

interface EvaluationArtifactPayload {
  type: 'playbook_evaluation_result';
  mode?: 'semantic' | 'reference' | 'hybrid';
  score?: number;
  verdict?: 'pass' | 'warning' | 'fail';
  summary?: string;
  semanticScore?: number | null;
  referenceScore?: number | null;
  artifactScore?: number | null;
  formatScore?: number | null;
  evidenceScore?: number | null;
  executionHealthScore?: number | null;
  findings?: Array<{
    severity?: 'info' | 'warning' | 'error';
    category?: string;
    sourceTaskId?: string | null;
    message?: string;
  }>;
}

interface Props {
  step: TaskResult | null;
  execution?: PlaybookExecution | null;
  pageMode?: PlaybookPageMode;
  onBackToRunMode?: () => void;
  onRequestValidateReplay?: (taskId: string) => void;
  onRequestRunEvaluation?: (taskId: string) => void;
  onRequestRunAdvisorEvaluation?: (taskId: string) => void;
  onRequestGrabOutputFormat?: (taskId: string) => void;
  onOpenOutputFormatEditor?: (taskId: string) => void;
  onStepReplayModeChange?: (taskId: string, mode: 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive') => void;
  isRunningEvaluation?: boolean;
  activeTab?: string;
  onActiveTabChange?: (value: string) => void;
}

function formatTime(isoString: string | null): string {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleTimeString();
}

function formatDateTimeCompact(isoString: string | null): string {
  if (!isoString) return '-';
  const date = new Date(isoString);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getExecutionModeLabel(mode?: string): string {
  if (mode === 'replay_strict') return 'Replay (Strict)';
  if (mode === 'replay_flex') return 'Replay (Flex)';
  if (mode === 'replay_adaptive') return 'Replay (Adaptive)';
  return 'Live';
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const scaled = value <= 1 ? value * 100 : value;
  return `${Math.round(scaled)}%`;
}

function formatSignedPercentDelta(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '0%';
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

function formatOptimizationValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value.trim().length > 0 ? value : '-';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.length > 0 ? JSON.stringify(value, null, 2) : '[]';
  return JSON.stringify(value, null, 2);
}

function getScoreTone(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'border-border/60 bg-muted/20';
  if (value >= 80) return 'border-emerald-500/30 bg-emerald-500/10';
  if (value >= 60) return 'border-amber-500/30 bg-amber-500/10';
  return 'border-rose-500/30 bg-rose-500/10';
}

function normalizePercentValue(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return value <= 1 ? value * 100 : value;
}

function getExpectedMatchTone(source: string | null | undefined, score: number | null | undefined): string {
  if (source === 'none') return 'border-slate-400/40 bg-slate-500/10';
  return getScoreTone(score);
}

function normalizeExpectedResultSource(value: string | null | undefined): 'node_field' | 'golden_baseline' | 'none' {
  return value === 'node_field' || value === 'golden_baseline' || value === 'none'
    ? value
    : 'none';
}

function normalizeExpectedResultType(value: string | null | undefined): 'exact_value' | 'semantic_description' | 'numeric_presentation' | 'document_generation' | 'baseline_comparison' | 'none' {
  return value === 'exact_value'
    || value === 'semantic_description'
    || value === 'numeric_presentation'
    || value === 'document_generation'
    || value === 'baseline_comparison'
    || value === 'none'
    ? value
    : 'none';
}

function normalizeAdvisorScore(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function getJudgeVerdictKey(score: number | null | undefined): 'passed' | 'passedWithImprovements' | 'needsOptimization' | 'failed' {
  const normalized = normalizeAdvisorScore(score);
  if (normalized === null) return 'needsOptimization';
  if (normalized >= 90) return 'passed';
  if (normalized >= 75) return 'passedWithImprovements';
  if (normalized >= 50) return 'needsOptimization';
  return 'failed';
}

function getEvaluationArtifactPayload(step: TaskResult | null): EvaluationArtifactPayload | null {
  if (!step?.artifacts?.length) return null;
  for (const artifact of step.artifacts) {
    const payload = artifact.metadata?.data as EvaluationArtifactPayload | undefined;
    if (payload?.type === 'playbook_evaluation_result') {
      return payload;
    }
    const directPayload = (artifact as any).data as EvaluationArtifactPayload | undefined;
    if (directPayload?.type === 'playbook_evaluation_result') {
      return directPayload;
    }
  }
  return null;
}

function formatToolArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return '{}';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return '{}';
  }
}

function formatPromptStage(stage: string | undefined): string {
  if (!stage) return 'detail.promptStage.llmCall';
  return stage
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stableValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function areArgsEqual(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  return JSON.stringify(stableValue(a || {})) === JSON.stringify(stableValue(b || {}));
}

function buildCurrentStepExecution(step: TaskResult) {
  return {
    id: `current:${step.taskId}:${step.attemptNumber ?? 'latest'}`,
    attemptNumber: step.attemptNumber ?? null,
    status: step.status,
    output: step.output,
    error: step.error,
    durationMs: step.durationMs,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    components: step.components || [],
    toolTrace: step.toolTrace || [],
    llmPromptTrace: step.llmPromptTrace || [],
    inputTokens: step.inputTokens ?? null,
    outputTokens: step.outputTokens ?? null,
    totalTokens: step.totalTokens ?? null,
    modelName: step.modelName ?? null,
    artifacts: step.artifacts || [],
  };
}

export function ExecutionStepDetail({
  step,
  execution = null,
  pageMode = 'run',
  onBackToRunMode,
  onRequestValidateReplay,
  onRequestRunEvaluation,
  onRequestRunAdvisorEvaluation,
  onRequestGrabOutputFormat,
  onOpenOutputFormatEditor,
  onStepReplayModeChange,
  isRunningEvaluation = false,
  activeTab = 'results',
  onActiveTabChange,
}: Props) {
  const { t } = useModuleTranslation('playbook');
  const currentPlaybook = usePlaybookStore((s) => s.currentPlaybook);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const replaySource = step ? execution?.replaySourceByTask?.[step.taskId] : null;
  const deleteExecution = usePlaybookStore((s) => s.deleteExecution);
  const deleteStepExecution = usePlaybookStore((s) => s.deleteStepExecution);
  const updatePlaybookFromJudge = usePlaybookStore((s) => s.updatePlaybookFromJudge);
  const generatePlaybookFromJudge = usePlaybookStore((s) => s.generatePlaybookFromJudge);
  const optimizeStepFromJudge = usePlaybookStore((s) => s.optimizeStepFromJudge);
  const fetchAdvisorRemediations = usePlaybookStore((s) => s.fetchAdvisorRemediations);
  const designPlaybookAction = usePlaybookStore((s) => s.designPlaybook);
  const reapplyOptimization = usePlaybookStore((s) => s.reapplyOptimization);
  const executePlaybook = usePlaybookStore((s) => s.executePlaybook);
  const fetchTaskReplays = usePlaybookStore((s) => s.fetchTaskReplays);
  const fetchEvaluationBaseline = usePlaybookStore((s) => s.fetchEvaluationBaseline);
  const createEvaluationBaselineFromExecution = usePlaybookStore((s) => s.createEvaluationBaselineFromExecution);
  const fetchEvaluationExecutions = usePlaybookStore((s) => s.fetchEvaluationExecutions);
  const [baselineReplay, setBaselineReplay] = useState<ValidatedTaskReplay | null>(null);
  const [evaluationBaseline, setEvaluationBaseline] = useState<{ id: string; sourceExecutionId: string; createdAt: string } | null>(null);
  const [evaluationExecutions, setEvaluationExecutions] = useState<PlaybookEvaluationExecution[]>([]);
  const [isSavingEvaluationBaseline, setIsSavingEvaluationBaseline] = useState(false);
  const [selectedStepExecutionId, setSelectedStepExecutionId] = useState<string | null>(null);
  const [stepReplayModeValue, setStepReplayModeValue] = useState<'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive'>('live');
  const [selectedEvaluationId, setSelectedEvaluationId] = useState<string | null>(null);
  const [comparisonEvaluationId, setComparisonEvaluationId] = useState<string | null>(null);
  const [selectedJudgeHistoryId, setSelectedJudgeHistoryId] = useState<string | null>(null);
  const [judgeActionLoading, setJudgeActionLoading] = useState<'update' | 'generate' | 'optimize' | null>(null);
  const [remediationDialogOpen, setRemediationDialogOpen] = useState(false);
  const [remediationDialogMode, setRemediationDialogMode] = useState<'optimize-step' | 'update-current' | 'generate-new'>('update-current');
  const [remediationItems, setRemediationItems] = useState<AdvisorRemediationItem[]>([]);
  const [remediationLoading, setRemediationLoading] = useState(false);
  const [reapplyingIndex, setReapplyingIndex] = useState<number | null>(null);
  const [missingAdvisorTaskIds, setMissingAdvisorTaskIds] = useState<string[]>([]);
  const [runningAdvisorPreflight, setRunningAdvisorPreflight] = useState(false);
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const executionSnapshotTask = useMemo(() => {
    const snapshot = execution?.playbookSnapshot as { tasks?: Array<Record<string, unknown>> } | null;
    const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];
    return tasks.find((task) => task.id === step?.taskId) || null;
  }, [execution?.playbookSnapshot, step?.taskId]);
  const playbookTask = currentPlaybook?.tasks.find((task) => task.id === step?.taskId) || null;
  const currentTask = (playbookTask || executionSnapshotTask || null) as any;
  useEffect(() => {
    setStepReplayModeValue(currentTask?.stepReplayMode ?? 'live');
  }, [currentTask?.id, currentTask?.stepReplayMode]);
  const evaluationHistory = step?.evaluationHistory || [];
  const judgeHistory = step?.judgeHistory || [];
  const advisorOptimizationHistory = step?.advisorOptimizationHistory || [];
  const stepJudgeStatus = step?.judgeStatus || 'idle';
  const stepJudgeError = step?.judgeError || null;
  const judgeSummary = execution?.judgeSummary || null;
  const advisorAutopilotActive = execution?.advisorAutopilotEnabled === true;
  const latestJudgeHistory = judgeHistory[judgeHistory.length - 1] || null;
  const selectedJudgeHistory = judgeHistory.find((entry) => entry.id === selectedJudgeHistoryId) || latestJudgeHistory;
  const stepJudgeResult = selectedJudgeHistory?.judgeResult || step?.judgeResult || null;
  const normalizedExpectedResultSource = normalizeExpectedResultSource(stepJudgeResult?.expectedResultSource);
  const normalizedExpectedResultType = normalizeExpectedResultType(stepJudgeResult?.expectedResultType);
  const normalizedResultMatchingScore = normalizeAdvisorScore(stepJudgeResult?.resultMatchingScore);
  const judgeVerdictKey = getJudgeVerdictKey(stepJudgeResult?.overallScore);
  const selectedOptimizationEntry = useMemo(() => {
    if (!advisorOptimizationHistory.length) return null;
    if (!selectedJudgeHistory) return advisorOptimizationHistory[advisorOptimizationHistory.length - 1] || null;

    const selectedTime = new Date(selectedJudgeHistory.createdAt).getTime();
    let best: typeof advisorOptimizationHistory[number] | null = null;
    let bestDelta = Infinity;

    for (const entry of advisorOptimizationHistory) {
      const entryTime = new Date(entry.createdAt).getTime();
      const delta = Math.abs(entryTime - selectedTime);
      if (Math.abs(delta) < Math.abs(bestDelta)) {
        bestDelta = delta;
        best = entry;
      }
    }

    return best || advisorOptimizationHistory[advisorOptimizationHistory.length - 1] || null;
  }, [advisorOptimizationHistory, selectedJudgeHistory]);
  const issueSections = useMemo(() => {
    if (!stepJudgeResult) return [];
    return [
      {
        title: t('detail.judge.structuralIssues'),
        badge: t('detail.remediation.category.structure'),
        badgeClassName: 'bg-purple-100 text-purple-700 border-purple-200',
        items: stepJudgeResult.missingFacts || [],
      },
      {
        title: t('detail.judge.promptIssues'),
        badge: t('detail.remediation.category.prompt'),
        badgeClassName: 'bg-blue-100 text-blue-700 border-blue-200',
        items: stepJudgeResult.incoherences || [],
      },
      {
        title: t('detail.judge.contractIssues'),
        badge: t('detail.remediation.category.contract'),
        badgeClassName: 'bg-amber-100 text-amber-700 border-amber-200',
        items: stepJudgeResult.unsupportedClaims || [],
      },
      {
        title: t('detail.judge.handoffIssues'),
        badge: t('detail.remediation.category.handoff'),
        badgeClassName: 'bg-rose-100 text-rose-700 border-rose-200',
        items: stepJudgeResult.handoffRisks || [],
      },
      {
        title: t('detail.judge.toolSelectionIssues'),
        badge: t('detail.remediation.category.tooling'),
        badgeClassName: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        items: stepJudgeResult.toolSelectionIssues || [],
      },
      {
        title: t('detail.judge.missingToolCalls'),
        badge: t('detail.remediation.category.tooling'),
        badgeClassName: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        items: stepJudgeResult.missingToolCalls || [],
      },
      {
        title: t('detail.judge.redundantToolCalls'),
        badge: t('detail.remediation.category.tooling'),
        badgeClassName: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        items: stepJudgeResult.redundantToolCalls || [],
      },
      {
        title: t('detail.judge.toolOutputUseIssues'),
        badge: t('detail.remediation.category.tooling'),
        badgeClassName: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        items: stepJudgeResult.toolOutputUseIssues || [],
      },
      {
        title: t('detail.judge.toolSequencingIssues'),
        badge: t('detail.remediation.category.tooling'),
        badgeClassName: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        items: stepJudgeResult.toolSequencingIssues || [],
      },
      {
        title: t('detail.judge.toolUsageStrengths'),
        badge: t('detail.remediation.category.evidence'),
        badgeClassName: 'bg-sky-100 text-sky-700 border-sky-200',
        items: stepJudgeResult.toolUsageStrengths || [],
      },
    ];
  }, [stepJudgeResult, t]);
  const playbookTaskTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of currentPlaybook?.tasks || []) {
      map.set(task.id, task.title);
    }
    return map;
  }, [currentPlaybook?.tasks]);
  const missingAdvisorTaskTitles = useMemo(
    () => missingAdvisorTaskIds.map((taskId) => playbookTaskTitleMap.get(taskId) || taskId),
    [missingAdvisorTaskIds, playbookTaskTitleMap],
  );
  const remediationCount = stepJudgeResult?.rewriteHints.length ?? 0;
  const issueCount = issueSections.reduce((sum, section) => sum + section.items.length, 0);
  const promptTraceItems = useMemo(() => {
    const items = [...(step?.llmPromptTrace || [])];
    if (baselineReplay?.llmPromptTrace?.length) {
      items.push(...baselineReplay.llmPromptTrace);
    }
    return items;
  }, [step?.llmPromptTrace, baselineReplay?.llmPromptTrace]);

  useEffect(() => {
    let cancelled = false;

    async function loadBaseline() {
      if (!execution?.playbookId || !step?.taskId) {
        if (!cancelled) setBaselineReplay(null);
        return;
      }

      try {
        const replays = await fetchTaskReplays(execution.playbookId, step.taskId);
        if (cancelled) return;
        const matched = replays.find((replay) => replaySource?.replayId && replay.id === replaySource.replayId)
          || replays.find((replay) => replay.status === 'active')
          || replays.find((replay) => replaySource?.validationVersion && replay.validationVersion === replaySource.validationVersion)
          || null;
        setBaselineReplay(matched);
      } catch {
        if (!cancelled) setBaselineReplay(null);
      }
    }

    loadBaseline();
    return () => {
      cancelled = true;
    };
  }, [
    execution?.playbookId,
    step?.taskId,
    replaySource?.replayId,
    replaySource?.validationVersion,
    currentTask?.activeReplayId,
    currentTask?.activeReplayVersion,
    currentTask?.activeReplayFormatGuideStatus,
    currentTask?.activeReplayFormatGuideError,
    fetchTaskReplays,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadEvaluationExecutions() {
      if (!execution?.playbookId || !step?.taskId || currentTask?.taskType !== 'evaluation') {
        if (!cancelled) setEvaluationExecutions([]);
        return;
      }

      try {
        const entries = await fetchEvaluationExecutions(execution.playbookId, step.taskId);
        if (!cancelled) setEvaluationExecutions(entries);
      } catch {
        if (!cancelled) setEvaluationExecutions([]);
      }
    }

    void loadEvaluationExecutions();
    return () => {
      cancelled = true;
    };
  }, [execution?.playbookId, step?.taskId, currentTask?.taskType, fetchEvaluationExecutions]);

  const isBaselineExecution = !!(execution?.id && baselineReplay?.referenceExecutionId && execution.id === baselineReplay.referenceExecutionId);
  const replayBadgeVersion = currentTask?.activeReplayVersion ?? replaySource?.validationVersion ?? baselineReplay?.validationVersion ?? null;
  const showReplayBadge = Boolean(currentTask?.hasValidatedReplay || currentTask?.isSavingReplayBaseline || replayBadgeVersion);
  const isReplayBadgeBusy = Boolean(currentTask?.isSavingReplayBaseline);
  const showOutputFormatBadge = Boolean(
    currentTask?.hasOutputFormatTemplate
    || currentTask?.isCapturingOutputFormat
    || currentTask?.activeOutputFormatTemplateVersion,
  );
  const isOutputFormatBusy = Boolean(currentTask?.isCapturingOutputFormat || currentTask?.activeOutputFormatStatus === 'pending');
  const outputFormatBadgeTone = currentTask?.activeOutputFormatStatus === 'failed'
    ? 'border-red-500/30 bg-red-50 text-red-700'
    : 'border-sky-500/30 bg-sky-100 text-sky-700';
  const hasReplayBaseline = Boolean(currentTask?.hasValidatedReplay || replayBadgeVersion);
  const [isNearBottom, setIsNearBottom] = useState(true);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const threshold = 96;
    const updateNearBottom = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      setIsNearBottom(distanceFromBottom <= threshold);
    };

    updateNearBottom();
    container.addEventListener('scroll', updateNearBottom, { passive: true });
    return () => {
      container.removeEventListener('scroll', updateNearBottom);
    };
  }, [step?.taskId]);

  const canDownload = step ? step.status === 'completed' || step.status === 'failed' || step.status === 'skipped' || step.status === 'interrupted' : false;
  const stepExecutions = useMemo(() => {
    if (!step) return [];
    const current = buildCurrentStepExecution(step);
    const persisted = step.stepExecutions || [];
    const mergedExecutions = [
      current,
      ...persisted.filter((entry) => entry.attemptNumber !== current.attemptNumber),
    ];
    return mergedExecutions.sort((a, b) => {
      const left = new Date(a.completedAt || a.startedAt || 0).getTime();
      const right = new Date(b.completedAt || b.startedAt || 0).getTime();
      return right - left;
    });
  }, [step]);

  const currentStepExecutionId = step ? `current:${step.taskId}:${step.attemptNumber ?? 'latest'}` : null;

  const handleDownloadHtml = useCallback(() => {
    if (step) downloadStepResultHtml(step);
  }, [step]);

  const handleDownloadPdf = useCallback(() => {
    if (step) downloadStepResultPdf(step);
  }, [step]);

  const handleCopyToClipboard = useCallback(async () => {
    if (!step) return;
    try {
      const html = renderStepResultHtml(step)
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, '');
      const plainText = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (navigator.clipboard?.write) {
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const textBlob = new Blob([plainText], { type: 'text/plain' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': htmlBlob,
            'text/plain': textBlob,
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }

      setCopiedToClipboard(true);
      showSuccess(t('detail.actions.copiedToClipboard'));
      window.setTimeout(() => setCopiedToClipboard(false), 2000);
    } catch {
      showError(t('detail.actions.copyToClipboardFailed'));
    }
  }, [step, t]);

  const handleApplyJudgeUpdate = useCallback(async () => {
    if (!execution || !currentPlaybook) return;
    setJudgeActionLoading('update');
    try {
      await updatePlaybookFromJudge(currentPlaybook.id, execution.id);
    } finally {
      setJudgeActionLoading(null);
    }
  }, [currentPlaybook, execution, updatePlaybookFromJudge]);

  const handleOptimizeJudgeStep = useCallback(async () => {
    if (!execution || !currentPlaybook || !step) return;
    setJudgeActionLoading('optimize');
    try {
      await optimizeStepFromJudge(currentPlaybook.id, execution.id, step.taskId);
    } finally {
      setJudgeActionLoading(null);
    }
  }, [currentPlaybook, execution, optimizeStepFromJudge, step]);

  const openRemediationDialog = useCallback(async (mode: 'optimize-step' | 'update-current' | 'generate-new') => {
    if (!execution || !currentPlaybook) return;
    if (mode === 'generate-new') {
      const taskResultsById = new Map((execution.taskResults || []).map((taskResult) => [taskResult.taskId, taskResult]));
      const missingTaskIds = (currentPlaybook.tasks || [])
        .filter((task) => !taskResultsById.get(task.id)?.judgeResult)
        .map((task) => task.id);

      if (missingTaskIds.length > 0) {
        setMissingAdvisorTaskIds(missingTaskIds);
        setRemediationDialogOpen(false);
        return;
      }
    }

    setMissingAdvisorTaskIds([]);
    setRemediationLoading(true);
    setRemediationDialogMode(mode);
    try {
      const taskId = mode === 'optimize-step' ? step?.taskId : undefined;
      const items = await fetchAdvisorRemediations(currentPlaybook.id, execution.id, taskId);
      setRemediationItems(items);
      setRemediationDialogOpen(true);
    } finally {
      setRemediationLoading(false);
    }
  }, [execution, currentPlaybook, step, fetchAdvisorRemediations]);

  const handleGenerateJudgePlaybook = useCallback(async () => {
    await openRemediationDialog('generate-new');
  }, [openRemediationDialog]);

  const handleRunAdvisorForAllTasks = useCallback(async () => {
    if (!currentPlaybook) return;
    setRunningAdvisorPreflight(true);
    try {
      await executePlaybook(currentPlaybook.id, {
        executionMode: 'live',
        advisorAutopilotEnabled: true,
        advisorAutopilotTargetScore: currentPlaybook.advisorAutopilotTargetScore ?? undefined,
        advisorAutopilotMaxTurns: currentPlaybook.advisorAutopilotMaxTurns ?? undefined,
      });
      setMissingAdvisorTaskIds([]);
    } catch (error) {
      showError(t('detail.judge.failedUnknown'), { description: t('detail.judge.missingEvaluationRunFailed') });
    } finally {
      setRunningAdvisorPreflight(false);
    }
  }, [currentPlaybook, executePlaybook, t]);

  const buildOptimizationQuery = useCallback((
    selectedIds: string[],
    editedItems: Map<string, string>,
    mode: 'optimize-step' | 'update-current' | 'generate-new',
  ): string => {
    const selectedItems = remediationItems.filter((item) => selectedIds.includes(item.id));
    const groupedByCategory = new Map<RemediationCategory, AdvisorRemediationItem[]>();
    for (const item of selectedItems) {
      const existing = groupedByCategory.get(item.category) || [];
      existing.push(item);
      groupedByCategory.set(item.category, existing);
    }
    const categoryOrder: RemediationCategory[] = ['structure', 'prompt', 'contract', 'handoff', 'tooling', 'evidence', 'outputFormat'];
    const findings = categoryOrder
      .filter((cat) => groupedByCategory.has(cat))
      .map((cat) => {
        const items = groupedByCategory.get(cat)!;
        const lines = items.map((item) => {
          const desc = editedItems.get(item.id) || item.description;
          return `- [${cat}] ${desc}`;
        });
        return lines.join('\n');
      })
      .join('\n');

    if (mode === 'optimize-step') {
      const taskTitle = step?.taskId
        ? currentPlaybook?.tasks.find((t) => t.id === step.taskId)?.title || step.taskId
        : 'this step';
      return [
        `Optimize only the step "${taskTitle}" based on these advisor findings.`,
        'Preserve the rest of the playbook unless a connection or port must change to keep the workflow valid.',
        '',
        'Advisor findings:',
        findings,
        '',
        'Apply the changes directly to the current playbook.',
      ].join('\n');
    }

    if (mode === 'generate-new') {
      return [
        'Generate an optimized playbook based on these advisor findings.',
        'Restructure the workflow to address all findings. You may add, remove, reorder, or rewrite steps as needed.',
        'Preserve the user\'s original intent.',
        '',
        'Advisor findings:',
        findings,
        '',
        'Apply the changes directly to the current playbook.',
      ].join('\n');
    }

    return [
      'Optimize the current playbook based on these advisor findings.',
      'Preserve the user\'s original intent, keep valid DAG structure, and only change steps, edges, ports, or agent assignments that are necessary to address the findings.',
      '',
      'Advisor findings:',
      findings,
      '',
      'Apply the changes directly to the current playbook.',
    ].join('\n');
  }, [remediationItems, step?.taskId, currentPlaybook?.tasks]);

  const handleApplyRemediations = useCallback(async (selectedIds: string[], editedItems: Map<string, string>) => {
    if (!currentPlaybook || !execution) return;
    const query = buildOptimizationQuery(selectedIds, editedItems, remediationDialogMode);
    return designPlaybookAction(currentPlaybook.id, { query });
  }, [currentPlaybook, execution, remediationDialogMode, buildOptimizationQuery, designPlaybookAction]);

  const handleReapplyOptimization = useCallback(async (historyIndex: number, direction: 'after' | 'before') => {
    if (!currentPlaybook || !execution || !step) return;
    setReapplyingIndex(historyIndex);
    try {
      await reapplyOptimization(currentPlaybook.id, execution.id, step.taskId, historyIndex, direction);
    } finally {
      setReapplyingIndex(null);
    }
  }, [currentPlaybook, execution, step, reapplyOptimization]);

  useEffect(() => {
    setSelectedStepExecutionId((current) => {
      if (!stepExecutions.length) return null;
      const liveExecution = currentStepExecutionId
        ? stepExecutions.find((entry) => entry.id === currentStepExecutionId) || stepExecutions[0]
        : stepExecutions[0];

      if (current && stepExecutions.some((entry) => entry.id === current)) {
        return current;
      }

      return liveExecution?.id ?? null;
    });
  }, [currentStepExecutionId, stepExecutions]);

  useEffect(() => {
    setSelectedEvaluationId((current) => {
      if (!evaluationHistory.length) return null;
      const latestEvaluationId = evaluationHistory[0].id;
      if (current === latestEvaluationId) return current;
      return latestEvaluationId;
    });
  }, [evaluationHistory, step?.taskId]);

  useEffect(() => {
    setComparisonEvaluationId((current) => {
      const comparisonCandidates = evaluationHistory.filter((entry) => entry.id !== selectedEvaluationId);
      if (comparisonCandidates.length === 0) return null;
      if (current && comparisonCandidates.some((entry) => entry.id === current)) {
        return current;
      }
      return comparisonCandidates[0].id;
    });
  }, [evaluationHistory, selectedEvaluationId, step?.taskId]);

  useEffect(() => {
    setSelectedJudgeHistoryId((current) => {
      if (!judgeHistory.length) return null;
      const latestJudgeHistoryId = judgeHistory[judgeHistory.length - 1].id;
      if (current && judgeHistory.some((entry) => entry.id === current)) return current;
      return latestJudgeHistoryId;
    });
  }, [judgeHistory, step?.taskId]);

  const handleSaveEvaluationBaseline = useCallback(async () => {
    if (!execution || !step) return;
    setIsSavingEvaluationBaseline(true);
    try {
      const baseline = await createEvaluationBaselineFromExecution(execution.playbookId, step.taskId, execution.id);
      setEvaluationBaseline({ id: baseline.id, sourceExecutionId: baseline.sourceExecutionId, createdAt: baseline.createdAt });
    } finally {
      setIsSavingEvaluationBaseline(false);
    }
  }, [createEvaluationBaselineFromExecution, execution, step]);

  if (!step) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        {t('execution.selectStep')}
      </div>
    );
  }

  const selectedEvaluation = evaluationHistory.find((entry) => entry.id === selectedEvaluationId) || evaluationHistory[0] || null;
  const selectedStepExecution = stepExecutions.find((entry) => entry.id === selectedStepExecutionId) || stepExecutions[0] || null;
  const comparisonCandidates = evaluationHistory.filter((entry) => entry.id !== selectedEvaluation?.id);
  const comparisonEvaluation = comparisonCandidates.find((entry) => entry.id === comparisonEvaluationId) || comparisonCandidates[0] || null;
  const semanticMatchToDisplay = selectedEvaluation?.semanticMatch || step.semanticMatch || null;
  const comparisonSemanticMatch = comparisonEvaluation?.semanticMatch || null;
  const evaluationArtifact = getEvaluationArtifactPayload(step);
  const isEvaluationPending = isRunningEvaluation || step.status === 'running';
  const hasStepComparison = Boolean(selectedEvaluation && comparisonSemanticMatch);
  const latestDedicatedEvaluation = evaluationExecutions[0] || null;
  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollContainerRef}
        data-testid="execution-step-scroll"
        className="h-full overflow-y-auto p-6"
      >
        <div className="mb-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{step.nodeTitle}</h2>
            {showReplayBadge && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {isReplayBadgeBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                {replayBadgeVersion
                  ? t('detail.badges.replayBaseline', { version: replayBadgeVersion })
                  : t('detail.badges.baseline')}
              </span>
            )}
            {showOutputFormatBadge && (
              <button
                type="button"
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors hover:opacity-90 ${outputFormatBadgeTone}`}
                onClick={() => onOpenOutputFormatEditor?.(step.taskId)}
              >
                {isOutputFormatBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                {currentTask?.activeOutputFormatTemplateVersion
                  ? t('detail.badges.outputFormatTemplate', { version: currentTask.activeOutputFormatTemplateVersion })
                  : t('detail.badges.outputFormat')}
              </button>
            )}
            {step.isStale && (
              <span
                className="rounded-full border border-amber-500/30 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                title={step.staleReason || 'Invalidated by an upstream rerun'}
              >
                {t('detail.badges.stale')}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <span className="whitespace-nowrap text-xs text-muted-foreground">{t('detail.stepMode')}</span>
              <Select
                value={stepReplayModeValue}
                onValueChange={(v) => {
                  const nextMode = v as 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';
                  setStepReplayModeValue(nextMode);
                  onStepReplayModeChange?.(step.taskId, nextMode);
                }}
              >
                <SelectTrigger className="h-7 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="live">{t('execution.mode.live')}</SelectItem>
                  <SelectItem value="replay_strict">{t('execution.mode.replayStrict')}</SelectItem>
                  <SelectItem value="replay_flex">{t('execution.mode.replayFlex')}</SelectItem>
                  <SelectItem value="replay_adaptive">{t('execution.mode.replayAdaptive')}</SelectItem>
                </SelectContent>
              </Select>
              {!hasReplayBaseline && (
                <span className="text-[10px] text-muted-foreground" title={t('detail.noBaselineHint')}>
                  {t('detail.noBaseline')}
                </span>
              )}
              {stepExecutions.length > 0 && (
                <>
                  <span className="mx-1 h-4 w-px bg-border" />
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {t('detail.results.stepExecutionLabel')}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="h-7 w-[220px] justify-between text-xs">
                        <span className="truncate text-left">
                          {selectedStepExecution
                            ? `${t('detail.evaluation.attempt')} ${selectedStepExecution.attemptNumber ?? '-'} | ${new Date(selectedStepExecution.completedAt || selectedStepExecution.startedAt || Date.now()).toLocaleString()}`
                            : t('detail.results.stepExecutionPlaceholder')}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[380px] p-1">
                      {stepExecutions.map((entry) => {
                        const isSelected = entry.id === selectedStepExecution?.id;
                        const canDeleteEntry = Boolean(
                          execution
                          && entry.attemptNumber !== (step.attemptNumber ?? null)
                          && !entry.id.startsWith('current:'),
                        );
                        return (
                          <div
                            key={entry.id}
                            className={cn(
                              'flex items-center gap-2 rounded-sm px-2 py-1.5',
                              isSelected ? 'bg-accent' : 'hover:bg-muted/60',
                            )}
                          >
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={() => setSelectedStepExecutionId(entry.id)}
                            >
                              <div className="truncate text-sm">
                                {t('detail.evaluation.attempt')} {entry.attemptNumber ?? '-'} | {new Date(entry.completedAt || entry.startedAt || Date.now()).toLocaleString()}
                              </div>
                              <div className="text-xs text-muted-foreground">{entry.status}</div>
                            </button>
                            {canDeleteEntry && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                title={t('detail.results.deleteStepExecution')}
                                onClick={async (event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (!execution || !window.confirm(t('detail.results.deleteStepExecutionConfirm'))) {
                                    return;
                                  }
                                  setSelectedStepExecutionId((current) => {
                                    if (current !== entry.id) return current;
                                    const remaining = stepExecutions.filter((candidate) => candidate.id !== entry.id);
                                    return remaining[0]?.id ?? null;
                                  });
                                  await deleteStepExecution(execution.playbookId, execution.id, step.taskId, entry.id);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" title={t('detail.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {execution && step.status === 'completed' && (
                  <DropdownMenuItem onClick={() => onRequestValidateReplay?.(step.taskId)}>
                    <FileText className="mr-2 h-4 w-4" />
                    {t('detail.actions.saveReplay')}
                  </DropdownMenuItem>
                )}
                {execution && (
                  <DropdownMenuItem onClick={() => onRequestRunEvaluation?.(step.taskId)} disabled={isRunningEvaluation}>
                    <FileText className="mr-2 h-4 w-4" />
                    {t('detail.actions.runReplayEvaluation')}
                  </DropdownMenuItem>
                )}
                {execution && step.status === 'completed' && !!step.output && (
                  <DropdownMenuItem onClick={() => onRequestGrabOutputFormat?.(step.taskId)}>
                    <FileText className="mr-2 h-4 w-4" />
                    {t('detail.actions.saveOutputFormat')}
                  </DropdownMenuItem>
                )}
                {canDownload && (
                  <>
                    <DropdownMenuItem onClick={handleDownloadHtml}>
                      <FileText className="mr-2 h-4 w-4" />
                      {t('detail.actions.downloadHtml')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownloadPdf}>
                      <Download className="mr-2 h-4 w-4" />
                      {t('detail.actions.downloadPdf')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void handleCopyToClipboard()}>
                      <ClipboardCopy className="mr-2 h-4 w-4" />
                      {t('detail.actions.copyToClipboard')}
                    </DropdownMenuItem>
                  </>
                )}
                {execution && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => void deleteExecution(execution.playbookId, execution.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t('detail.actions.deleteExecution')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {step.agentName && <span>{t('detail.metadata.agent')}: {step.agentName}</span>}
            <span>{t('detail.metadata.started')}: {formatTime(step.startedAt)}</span>
            {step.completedAt && (
              <span>{t('detail.metadata.completed')}: {formatTime(step.completedAt)}</span>
            )}
            <span>{t('detail.metadata.duration')}: {formatDuration(step.durationMs)}</span>
          </div>
        </div>

        {step.isStale && (
          <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t('detail.staleMessage')}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={onActiveTabChange} className="gap-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="results">{t('detail.tabs.results')}</TabsTrigger>
            <TabsTrigger value="evaluation">{t('detail.tabs.evaluation')}</TabsTrigger>
            <TabsTrigger value="judge">{t('detail.tabs.judge')}</TabsTrigger>
            <TabsTrigger value="traces">{t('detail.tabs.traces')}</TabsTrigger>
          </TabsList>

          <TabsContent value="results" className="space-y-4 text-[14px] [&_*]:text-[14px] [&_*]:!text-[14px]">
            {canDownload && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={handleDownloadHtml}>
                  <FileText className="mr-1 h-4 w-4" />
                  {t('detail.actions.downloadHtml')}
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownloadPdf}>
                  <Download className="mr-1 h-4 w-4" />
                  {t('detail.actions.downloadPdf')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleCopyToClipboard()} disabled={copiedToClipboard}>
                  {copiedToClipboard ? <ClipboardCheck className="mr-1 h-4 w-4" /> : <ClipboardCopy className="mr-1 h-4 w-4" />}
                  {t(copiedToClipboard ? 'detail.actions.copiedToClipboard' : 'detail.actions.copyToClipboard')}
                </Button>
              </div>
            )}

            {step.iteratorIterations && step.iteratorIterations.length > 0 ? (
              <IteratorResultPanel step={step} />
            ) : selectedStepExecution?.components && selectedStepExecution.components.length > 0 ? (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <StepComponents components={selectedStepExecution.components} taskId={step.taskId} />
              </div>
            ) : ((execution?.executionMode === 'replay_strict' || execution?.executionMode === 'replay_flex' || execution?.executionMode === 'replay_adaptive') || replaySource) ? (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <div className="font-medium">{t('detail.provenance.title')}</div>
                <div className="mt-2 space-y-1 text-muted-foreground">
                  <div>{t('detail.provenance.mode')}: {({
                    'replay_strict': t('execution.mode.replayStrict'),
                    'replay_flex': t('execution.mode.replayFlex'),
                    'replay_adaptive': t('execution.mode.replayAdaptive'),
                    'live': t('execution.mode.live'),
                  } as Record<string, string>)[execution?.executionMode || 'live'] || t('execution.mode.live')}</div>
                  {replaySource && (
                    <div>{t('detail.provenance.baseline')}: v{replaySource.validationVersion}</div>
                  )}
                  {baselineReplay?.preserveOutputFormat && (
                    <div>{t('detail.provenance.outputFormat')}</div>
                  )}
                </div>
              </div>
            ) : selectedStepExecution?.output && (!selectedStepExecution.components || selectedStepExecution.components.length === 0) ? (
              <div className="rounded-lg bg-muted/50 p-4 whitespace-pre-wrap" style={{ fontSize: '11px' }}>
                {selectedStepExecution.output}
              </div>
            ) : null}

            {selectedStepExecution?.status === 'running' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                {t('execution.running')}
              </div>
            )}

            {selectedStepExecution?.error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                  <span className="text-sm font-semibold text-destructive">{t('execution.error')}</span>
                </div>
                <pre className="max-h-80 overflow-y-auto rounded bg-destructive/5 p-3 font-mono text-sm whitespace-pre-wrap break-words text-destructive/90">
                  {selectedStepExecution.error}
                </pre>
              </div>
            )}

          </TabsContent>

          <TabsContent value="evaluation" className="space-y-4">
            {(execution || evaluationHistory.length > 0) && (
              <div className="flex flex-wrap items-end justify-between gap-3">
                {evaluationHistory.length > 0 && (
                  <div className="min-w-[260px] flex-1 space-y-1">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.stepExecutionLabel')}</div>
                    <Select value={selectedEvaluation?.id || ''} onValueChange={setSelectedEvaluationId}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={t('detail.evaluation.stepExecutionPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {evaluationHistory.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {new Date(entry.createdAt).toLocaleString()} | {t('detail.evaluation.attempt')} {entry.attemptNumber ?? '-'} | {formatPercent(entry.semanticMatch.matchScore)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {comparisonCandidates.length > 0 && (
                  <div className="min-w-[260px] flex-1 space-y-1">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.compareWith')}</div>
                    <Select value={comparisonEvaluation?.id || ''} onValueChange={setComparisonEvaluationId}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={t('detail.evaluation.compareWithPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {comparisonCandidates.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {new Date(entry.createdAt).toLocaleString()} | {t('detail.evaluation.attempt')} {entry.attemptNumber ?? '-'} | {formatPercent(entry.semanticMatch.matchScore)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {execution && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRequestRunEvaluation?.(step.taskId)}
                      disabled={isRunningEvaluation}
                      className="shrink-0"
                    >
                      {isRunningEvaluation ? t('execution.running') : t('detail.actions.runReplayEvaluation')}
                    </Button>
                    {currentTask?.taskType === 'evaluation' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSaveEvaluationBaseline}
                        disabled={isSavingEvaluationBaseline}
                        className="shrink-0"
                      >
                        {isSavingEvaluationBaseline ? t('execution.running') : t('detail.actions.saveEvaluationBaseline')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {currentTask?.taskType === 'evaluation' && (
              <div className="rounded-lg border bg-muted/10 p-4 text-sm">
                <div className="font-medium">{t('detail.evaluation.baselineTitle')}</div>
                <div className="mt-1 text-muted-foreground">
                  {evaluationBaseline
                    ? `${t('detail.evaluation.baselineExecution')} ${evaluationBaseline.sourceExecutionId} • ${new Date(evaluationBaseline.createdAt).toLocaleString()}`
                    : t('detail.evaluation.baselineEmpty')}
                </div>
                {latestDedicatedEvaluation && (
                  <div className="mt-3 rounded bg-background p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.recorded')}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {new Date(latestDedicatedEvaluation.createdAt).toLocaleString()} • {latestDedicatedEvaluation.verdict || '-'} • {formatPercent(latestDedicatedEvaluation.score ?? null)}
                    </div>
                    {latestDedicatedEvaluation.summary && (
                      <div className="mt-2 text-sm whitespace-pre-wrap">{latestDedicatedEvaluation.summary}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {hasStepComparison && selectedEvaluation && comparisonEvaluation && comparisonSemanticMatch && (
              <div className="rounded-lg border bg-muted/20 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{t('detail.evaluation.compareTitle')}</div>
                  <div className="text-xs text-muted-foreground">{t('detail.evaluation.compareHint')}</div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded bg-background p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('detail.evaluation.selectedExecution')}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{t('detail.evaluation.attempt')}: {selectedEvaluation.attemptNumber ?? '-'}</span>
                      <span>{t('detail.evaluation.recorded')}: {new Date(selectedEvaluation.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className={cn('rounded border p-2', getScoreTone(selectedEvaluation.semanticMatch.matchScore))}>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.overall')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(selectedEvaluation.semanticMatch.matchScore)}</div>
                      </div>
                      <div className={cn('rounded border p-2', getScoreTone(selectedEvaluation.semanticMatch.semanticSimilarityScore))}>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.embeddingSimilarity')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(selectedEvaluation.semanticMatch.semanticSimilarityScore)}</div>
                      </div>
                      <div className={cn('rounded border p-2', getScoreTone(selectedEvaluation.semanticMatch.evidenceConsistencyScore))}>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.evidenceConsistency')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(selectedEvaluation.semanticMatch.evidenceConsistencyScore)}</div>
                      </div>
                      <div className={cn('rounded border p-2', getScoreTone(selectedEvaluation.semanticMatch.judgeScore))}>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.judgeScore')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(selectedEvaluation.semanticMatch.judgeScore)}</div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded bg-background p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('detail.evaluation.comparedExecution')}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{t('detail.evaluation.attempt')}: {comparisonEvaluation.attemptNumber ?? '-'}</span>
                      <span>{t('detail.evaluation.recorded')}: {new Date(comparisonEvaluation.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className={cn('rounded border p-2', getScoreTone(comparisonSemanticMatch.matchScore))}>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.overall')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(comparisonSemanticMatch.matchScore)}</div>
                      </div>
                      <div className={cn('rounded border p-2', getScoreTone(comparisonSemanticMatch.semanticSimilarityScore))}>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.embeddingSimilarity')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(comparisonSemanticMatch.semanticSimilarityScore)}</div>
                      </div>
                      <div className={cn('rounded border p-2', getScoreTone(comparisonSemanticMatch.evidenceConsistencyScore))}>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.evidenceConsistency')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(comparisonSemanticMatch.evidenceConsistencyScore)}</div>
                      </div>
                      <div className={cn('rounded border p-2', getScoreTone(comparisonSemanticMatch.judgeScore))}>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.judgeScore')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(comparisonSemanticMatch.judgeScore)}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border bg-background px-2 py-1">
                    {t('detail.evaluation.compareDelta', {
                      label: t('detail.evaluation.overall'),
                      value: formatSignedPercentDelta(semanticMatchToDisplay.matchScore - comparisonSemanticMatch.matchScore),
                    })}
                  </span>
                  <span className="rounded-full border bg-background px-2 py-1">
                    {t('detail.evaluation.compareDelta', {
                      label: t('detail.evaluation.embeddingSimilarity'),
                      value: formatSignedPercentDelta(semanticMatchToDisplay.semanticSimilarityScore - comparisonSemanticMatch.semanticSimilarityScore),
                    })}
                  </span>
                  <span className="rounded-full border bg-background px-2 py-1">
                    {t('detail.evaluation.compareDelta', {
                      label: t('detail.evaluation.evidenceConsistency'),
                      value: formatSignedPercentDelta(semanticMatchToDisplay.evidenceConsistencyScore - comparisonSemanticMatch.evidenceConsistencyScore),
                    })}
                  </span>
                  <span className="rounded-full border bg-background px-2 py-1">
                    {t('detail.evaluation.compareDelta', {
                      label: t('detail.evaluation.judgeScore'),
                      value: formatSignedPercentDelta(semanticMatchToDisplay.judgeScore - comparisonSemanticMatch.judgeScore),
                    })}
                  </span>
                </div>
                {(selectedEvaluation.semanticMatch.reason || comparisonSemanticMatch.reason) && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded bg-background p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.reason')}</div>
                      <div className="mt-1 text-sm whitespace-pre-wrap">{selectedEvaluation.semanticMatch.reason || t('detail.evaluation.none')}</div>
                    </div>
                    <div className="rounded bg-background p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.reason')}</div>
                      <div className="mt-1 text-sm whitespace-pre-wrap">{comparisonSemanticMatch.reason || t('detail.evaluation.none')}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {semanticMatchToDisplay ? (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{t('detail.evaluation.semanticMatch')}</div>
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {t('detail.evaluation.matchBadge', { score: formatPercent(semanticMatchToDisplay.matchScore) })}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <div className={cn('rounded border p-2', getScoreTone(semanticMatchToDisplay.matchScore))}>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.overall')}</div>
                    <div className="mt-1 text-lg font-semibold">{formatPercent(semanticMatchToDisplay.matchScore)}</div>
                  </div>
                  <div className={cn('rounded border p-2', getScoreTone(semanticMatchToDisplay.semanticSimilarityScore))}>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.embeddingSimilarity')}</div>
                    <div className="mt-1 text-lg font-semibold">{formatPercent(semanticMatchToDisplay.semanticSimilarityScore)}</div>
                  </div>
                  <div className={cn('rounded border p-2', getScoreTone(semanticMatchToDisplay.evidenceConsistencyScore))}>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.evidenceConsistency')}</div>
                    <div className="mt-1 text-lg font-semibold">{formatPercent(semanticMatchToDisplay.evidenceConsistencyScore)}</div>
                  </div>
                  <div className={cn('rounded border p-2', getScoreTone(semanticMatchToDisplay.judgeScore))}>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.judgeScore')}</div>
                    <div className="mt-1 text-lg font-semibold">{formatPercent(semanticMatchToDisplay.judgeScore)}</div>
                  </div>
                </div>
                {semanticMatchToDisplay.reason && (
                  <div className="mt-3 rounded bg-background p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.reason')}</div>
                    <div className="mt-1 text-sm whitespace-pre-wrap">{semanticMatchToDisplay.reason}</div>
                  </div>
                )}
                {(semanticMatchToDisplay.missingPoints?.length || semanticMatchToDisplay.changedPoints?.length) ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded bg-background p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.missingPoints')}</div>
                      {semanticMatchToDisplay.missingPoints?.length ? (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                          {semanticMatchToDisplay.missingPoints.map((item, index) => (
                            <li key={`missing-${index}`}>{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mt-1 text-sm text-muted-foreground">{t('detail.evaluation.none')}</div>
                      )}
                    </div>
                    <div className="rounded bg-background p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.changedPoints')}</div>
                      {semanticMatchToDisplay.changedPoints?.length ? (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                          {semanticMatchToDisplay.changedPoints.map((item, index) => (
                            <li key={`changed-${index}`}>{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mt-1 text-sm text-muted-foreground">{t('detail.evaluation.none')}</div>
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 text-xs text-muted-foreground">
                  {semanticMatchToDisplay.judgeUsed
                    ? t('detail.evaluation.judgeModel', { model: semanticMatchToDisplay.model || '-' })
                    : t('detail.evaluation.embeddingFallback')}
                </div>
              </div>
            ) : evaluationArtifact ? (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{t('detail.evaluation.semanticMatch')}</div>
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {evaluationArtifact.verdict || '-'} | {formatPercent(evaluationArtifact.score ?? null)}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className={cn('rounded border p-2', getScoreTone(evaluationArtifact.score ?? null))}>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.overall')}</div>
                    <div className="mt-1 text-lg font-semibold">{formatPercent(evaluationArtifact.score ?? null)}</div>
                  </div>
                  <div className={cn('rounded border p-2', getScoreTone(evaluationArtifact.semanticScore ?? null))}>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.semantic')}</div>
                    <div className="mt-1 text-lg font-semibold">{formatPercent(evaluationArtifact.semanticScore ?? null)}</div>
                  </div>
                  <div className={cn('rounded border p-2', getScoreTone(evaluationArtifact.referenceScore ?? null))}>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.reference')}</div>
                    <div className="mt-1 text-lg font-semibold">{formatPercent(evaluationArtifact.referenceScore ?? null)}</div>
                  </div>
                </div>
                {evaluationArtifact.summary && (
                  <div className="mt-3 rounded bg-background p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.reason')}</div>
                    <div className="mt-1 text-sm whitespace-pre-wrap">{evaluationArtifact.summary}</div>
                  </div>
                )}
                {evaluationArtifact.findings?.length ? (
                  <div className="mt-3 space-y-2">
                    {evaluationArtifact.findings.map((finding, index) => (
                      <div key={`${finding.category || 'finding'}-${index}`} className="rounded bg-background p-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {(finding.category || 'evaluation')} · {(finding.severity || 'info')}
                        </div>
                        <div className="mt-1 text-sm whitespace-pre-wrap">{finding.message || t('detail.evaluation.none')}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-lg border bg-muted/10 p-6 text-sm text-muted-foreground">
                {isEvaluationPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  t('detail.evaluation.empty')
                )}
              </div>
            )}

            {evaluationHistory.length > 0 && (
              <div>
                <div className="text-sm text-muted-foreground">
                  {t('detail.evaluation.historyHint')}
                </div>
                {selectedEvaluation && (
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>{t('detail.evaluation.recorded')}: {new Date(selectedEvaluation.createdAt).toLocaleString()}</span>
                    <span>{t('detail.evaluation.attempt')}: {selectedEvaluation.attemptNumber ?? '-'}</span>
                    <span>{t('detail.evaluation.trigger')}: {selectedEvaluation.trigger}</span>
                    {selectedEvaluation.baselineValidationVersion !== null && (
                      <span>{t('detail.provenance.baseline')}: v{selectedEvaluation.baselineValidationVersion}</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {isEvaluationPending && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                <div className="font-medium text-primary">{t('detail.evaluation.inProgress')}</div>
                <div className="mt-1 text-muted-foreground">
                  {t('detail.evaluation.runningMessage')}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="judge" className="space-y-4">
            {execution && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRequestRunAdvisorEvaluation?.(step.taskId)}
                  disabled={isRunningEvaluation || stepJudgeStatus === 'evaluating'}
                >
                  {stepJudgeStatus === 'evaluating' && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  {stepJudgeStatus === 'evaluating' ? t('execution.running') : t('detail.actions.runAdvisorEvaluation')}
                </Button>
              </div>
            )}

            {advisorOptimizationHistory.length > 0 && (
              <div className="rounded-lg border bg-muted/20 p-4 text-sm space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.autopilot.title')}</div>
                  <Badge variant="outline" className="rounded-full px-2 py-0 text-xs">
                    {t(`detail.autopilot.status.${execution?.advisorAutopilotStatus || 'idle'}` as any)}
                  </Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className={cn('rounded border p-2', getScoreTone(execution?.advisorAutopilotTargetScore))}>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.autopilot.targetScore')}</div>
                    <div className="mt-1 text-lg font-semibold">{formatPercent(execution?.advisorAutopilotTargetScore)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.autopilot.maxTurns')}</div>
                    <div className="mt-1 font-medium">{execution?.advisorAutopilotMaxTurns ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.autopilot.attemptCount')}</div>
                    <div className="mt-1 font-medium">{execution?.advisorAutopilotAttemptCount ?? 0}</div>
                  </div>
                </div>
                {step?.advisorStopReason && (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.autopilot.stopReason')}</div>
                    <div className="mt-1 text-muted-foreground">{t(`detail.autopilot.stopReasonValue.${step.advisorStopReason}` as any)}</div>
                  </div>
                )}
                {execution?.advisorAutopilotLastError && (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.autopilot.lastError')}</div>
                    <div className="mt-1 text-destructive whitespace-pre-wrap">{execution.advisorAutopilotLastError}</div>
                  </div>
                )}
              </div>
            )}

            {advisorAutopilotActive && (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-4 text-sm">
                <Collapsible defaultOpen={false} className="rounded-md border bg-background">
                  <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t('detail.autopilot.appliedOptimizations')}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {advisorOptimizationHistory.length > 0
                          ? selectedOptimizationEntry
                            ? t('detail.autopilot.showingTurn', { turn: selectedOptimizationEntry.turn, count: advisorOptimizationHistory.length })
                            : t('detail.autopilot.optimizationCount', { count: advisorOptimizationHistory.length })
                          : t('detail.autopilot.noAppliedOptimizations')}
                      </div>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-t px-4 py-3 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                    {selectedOptimizationEntry ? (
                      <div className="rounded-md border bg-background p-3">
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span>{t('detail.autopilot.turnLabel', { turn: selectedOptimizationEntry.turn })}</span>
                          <span>{new Date(selectedOptimizationEntry.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedOptimizationEntry.changedFields.length > 0 ? selectedOptimizationEntry.changedFields.map((field) => (
                            <Badge key={field} variant="outline" className="rounded-full px-2 py-0 text-xs">
                              {t(`detail.autopilot.field.${field}` as any)}
                            </Badge>
                          )) : (
                            <div className="text-xs text-muted-foreground">{t('detail.autopilot.noVisibleChanges')}</div>
                          )}
                        </div>
                        {selectedOptimizationEntry.changedFields.length > 0 && (
                          <div className="mt-3 space-y-3">
                            {selectedOptimizationEntry.changedFields.map((field) => (
                              <div key={field} className="grid gap-3 md:grid-cols-2">
                                <div>
                                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('detail.autopilot.before')}</div>
                                  <div className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-xs">
                                    {(() => {
                                      const val = selectedOptimizationEntry.beforeTask?.[field];
                                      return typeof val === 'boolean' ? t(val ? 'detail.boolean.true' : 'detail.boolean.false') : formatOptimizationValue(val);
                                    })()}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('detail.autopilot.after')}</div>
                                  <div className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-xs">
                                    {(() => {
                                      const val = selectedOptimizationEntry.afterTask?.[field];
                                      return typeof val === 'boolean' ? t(val ? 'detail.boolean.true' : 'detail.boolean.false') : formatOptimizationValue(val);
                                    })()}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {selectedOptimizationEntry && (() => {
                          const idx = advisorOptimizationHistory.indexOf(selectedOptimizationEntry);
                          return (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={reapplyingIndex === idx}
                                onClick={() => void handleReapplyOptimization(idx, 'after')}
                              >
                                {reapplyingIndex === idx && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                                <RotateCcw className="mr-1 h-3 w-3" />
                                {t('detail.autopilot.reapply')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                disabled={reapplyingIndex === idx}
                                onClick={() => void handleReapplyOptimization(idx, 'before')}
                              >
                                {t('detail.autopilot.revert')}
                              </Button>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                        {t('detail.autopilot.noAppliedOptimizations')}
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}

            {stepJudgeResult ? (
              <div className="space-y-4">
                {missingAdvisorTaskIds.length > 0 && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>{t('detail.judge.missingEvaluationTitle')}</AlertTitle>
                    <AlertDescription className="space-y-3">
                      <p>{t('detail.judge.missingEvaluationDescription', { count: missingAdvisorTaskIds.length })}</p>
                      <p className="text-xs text-destructive/90">{missingAdvisorTaskTitles.join(', ')}</p>
                      <div>
                        <Button size="sm" onClick={() => void handleRunAdvisorForAllTasks()} disabled={runningAdvisorPreflight || judgeActionLoading !== null}>
                          {runningAdvisorPreflight && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                          {t('detail.judge.missingEvaluationRunCta')}
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void handleGenerateJudgePlaybook()} disabled={judgeActionLoading !== null || remediationLoading}>
                    {judgeActionLoading === 'generate' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    {t('detail.judge.generateOptimizedPlaybook')}
                  </Button>
                  {judgeHistory.length > 0 && (
                    <Select value={selectedJudgeHistory?.id || ''} onValueChange={setSelectedJudgeHistoryId}>
                      <SelectTrigger className="h-9 min-w-[260px] sm:w-[320px]">
                        <SelectValue placeholder={t('detail.judge.stepExecutionPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {judgeHistory.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {t('detail.evaluation.attempt')} {entry.attemptNumber ?? '-'} · {new Date(entry.createdAt).toLocaleString()} · {formatPercent(entry.judgeResult.overallScore)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button size="sm" variant="outline" onClick={() => openRemediationDialog('optimize-step')} disabled={remediationLoading}>
                    {remediationLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    {t('detail.judge.previewChanges')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openRemediationDialog('update-current')} disabled={remediationLoading}>
                    {remediationLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    {t('detail.judge.applyToCurrentPlaybook')}
                  </Button>
                </div>

                <AdvisorResultPanel judgeResult={stepJudgeResult} />

                <AdvisorChangeReviewDialog
                  open={remediationDialogOpen}
                  onOpenChange={setRemediationDialogOpen}
                  items={remediationItems}
                  tasks={currentPlaybook?.tasks || []}
                  mode={remediationDialogMode}
                  loading={remediationLoading}
                  onApply={handleApplyRemediations}
                />

                <Collapsible defaultOpen={false} className="rounded-lg border bg-background p-4">
                  <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      <span>{t('detail.judge.remediationSuggestions')}</span>
                      <span>{t('detail.judge.remediationSummary', { count: remediationCount })}</span>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2 text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                    {stepJudgeResult.rewriteHints.length > 0 ? (
                      stepJudgeResult.rewriteHints.map((hint, idx) => (
                        <RemediationItemRow key={`rewrite-${idx}`} text={hint} category="prompt" onApply={() => openRemediationDialog('update-current')} />
                      ))
                    ) : (
                      <div className="text-muted-foreground">{t('detail.judge.none')}</div>
                    )}
                  </CollapsibleContent>
                </Collapsible>

              </div>
            ) : judgeSummary ? (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className={cn('rounded-md border px-3 py-2', getScoreTone(judgeSummary.overallScore))}>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.judge.overallScore')}</div>
                      <div className="mt-1 text-lg font-semibold">{formatPercent(judgeSummary.overallScore)}</div>
                    </div>
                    <div className={cn('rounded-md border px-3 py-2', getScoreTone(normalizePercentValue(judgeSummary.confidence)))}>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.judge.confidence')}</div>
                      <div className="mt-1 text-lg font-semibold">{formatConfidence(judgeSummary.confidence)}</div>
                    </div>
                    <div className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-xs text-muted-foreground">
                      {t(`detail.judge.recommendation.${judgeSummary.recommendation}` as any)}
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-border/60 bg-background/60 p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.judge.recommendationTitle')}</div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{judgeSummary.reason || t('detail.judge.noReason')}</p>
                  </div>
                </div>
              </div>
            ) : stepJudgeStatus === 'failed' ? (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {t('detail.judge.failed')}
                </div>
                <pre className="max-h-80 overflow-y-auto rounded bg-destructive/5 p-3 font-mono text-sm whitespace-pre-wrap break-words text-destructive/90">
                  {stepJudgeError || t('detail.judge.failedUnknown')}
                </pre>
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                {stepJudgeStatus === 'evaluating' || execution?.judgeSummaryStatus === 'evaluating'
                  ? t('detail.judge.evaluating')
                  : t('detail.judge.empty')}
              </div>
            )}

          </TabsContent>

          <TabsContent value="traces" className="space-y-4">
            <Collapsible defaultOpen={false} className="rounded-lg border bg-background p-4">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.tabs.toolTrace')}</div>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                {step.toolTrace && step.toolTrace.length > 0 ? (
                  <div className="space-y-3">
                    {step.toolTrace.map((item) => (
                      <div key={`${item.callIndex}-${item.toolName}`} className="rounded-lg border bg-muted/30 p-4">
                        <div className="mb-2 flex items-center gap-2 text-sm">
                          <span className="font-medium">{item.callIndex}.</span>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{item.toolName}</code>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.toolTrace.args')}</div>
                            <pre className="max-h-56 overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">
                              {formatToolArgs(item.args)}
                            </pre>
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.toolTrace.outputSummary')}</div>
                            <pre className="max-h-56 overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">
                              {item.outputSummary || '-'}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                    {t('detail.toolTrace.empty')}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            <Collapsible defaultOpen={false} className="rounded-lg border bg-background p-4">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.tabs.replayDiff')}</div>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                {baselineReplay ? (
                  <div className="space-y-3">
                    {baselineReplay.toolCalls.map((baselineItem) => {
                      const actualItem = step.toolTrace?.find((item) => item.callIndex === baselineItem.callIndex);
                      const argsMatch = actualItem ? areArgsEqual(baselineItem.args, actualItem.args) : false;
                      const toolMatch = actualItem ? actualItem.toolName === baselineItem.toolName : false;
                      const statusClass = !actualItem
                        ? 'bg-amber-100 text-amber-700'
                        : argsMatch && toolMatch
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700';
                      const statusLabel = !actualItem
                        ? t('detail.replayDiff.missing')
                        : argsMatch && toolMatch
                          ? t('detail.replayDiff.matches')
                          : t('detail.replayDiff.differs');

                      return (
                        <div key={`replay-diff-${baselineItem.callIndex}-${baselineItem.toolName}`} className="rounded-lg border bg-muted/20 p-4">
                          <div className="mb-2 flex items-center gap-2 text-sm">
                            <span className="font-medium">{baselineItem.callIndex}.</span>
                            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{baselineItem.toolName}</code>
                            <span className={`rounded-full px-2 py-0.5 text-xs ${statusClass}`}>
                              {statusLabel}
                            </span>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.replayDiff.baselineArgs')}</div>
                              <pre className="max-h-56 overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">
                                {formatToolArgs(baselineItem.args)}
                              </pre>
                            </div>
                            <div>
                              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.replayDiff.actualArgs')}</div>
                              <pre className="max-h-56 overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">
                                {formatToolArgs(actualItem?.args)}
                              </pre>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div>
                              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.replayDiff.baselineResult')}</div>
                              <pre className="max-h-56 overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">
                                {baselineItem.outputSummary || '-'}
                              </pre>
                            </div>
                            <div>
                              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.replayDiff.actualResult')}</div>
                              <pre className="max-h-56 overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">
                                {actualItem?.outputSummary || '-'}
                              </pre>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {(step.toolTrace || []).some((actualItem) => !baselineReplay.toolCalls.find((baselineItem) => baselineItem.callIndex === actualItem.callIndex)) && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-50 p-4 text-sm text-amber-800">
                        {t('detail.replayDiff.extraCalls')}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                    {t('detail.replayDiff.empty')}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            <Collapsible defaultOpen={false} className="rounded-lg border bg-background p-4">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.tabs.llmPrompts')}</div>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                {promptTraceItems.length > 0 ? (
                  <div className="space-y-3">
                    {promptTraceItems.map((item, index) => (
                      <Collapsible key={`llm-prompt-${index}`} defaultOpen={false} className="rounded-lg border bg-muted/30 px-4">
                        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 py-4 text-left">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-medium">{index + 1}.</span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                              {item.stage ? formatPromptStage(item.stage) : t('detail.promptStage.llmCall')}
                            </span>
                            <code className="rounded bg-background px-1.5 py-0.5 text-xs">{item.model || '-'}</code>
                          </div>
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pb-4 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.prompts.promptLabel')}</div>
                          <pre className="max-h-[28rem] overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">
                            {item.prompt || '-'}
                          </pre>
                        </CollapsibleContent>
                      </Collapsible>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                    {t('detail.prompts.empty')}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </TabsContent>
        </Tabs>
      </div>

    </div>
  );
}

function IssueSection({
  title,
  badge,
  badgeClassName,
  items,
  emptyLabel,
}: {
  title: string;
  badge: string;
  badgeClassName: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
        <Badge variant="outline" className={cn('text-[10px] border', badgeClassName)}>
          {badge}
        </Badge>
      </div>
      <div className="mt-2 space-y-2 text-sm">
        {items.length > 0 ? (
          items.map((item, index) => (
            <div key={`${title}-${index}`} className="rounded border bg-muted/20 px-3 py-2">
              <p className="whitespace-pre-wrap text-muted-foreground">{item}</p>
            </div>
          ))
        ) : (
          <div className="text-muted-foreground">{emptyLabel}</div>
        )}
      </div>
    </div>
  );
}

