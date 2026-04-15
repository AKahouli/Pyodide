import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, Download, FileText, Loader2, MoreHorizontal, Trash2, Pencil, Check, CheckSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { HumanFeedbackInline } from './HumanFeedbackInline';
import { ArtifactBadge } from './ArtifactBadge';
import { AdvisorChangeReviewDialog } from './AdvisorChangeReviewDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';
import { cn } from '@/lib/utils';
import type { TaskResult, HumanFeedbackData, PlaybookComponent, PlaybookExecution, PlaybookPageMode, ValidatedTaskReplay, TaskArtifact, AdvisorRemediationItem, RemediationCategory } from '../types';
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
import type { MessageComponent } from '@/modules/conversation/types';
import { useModuleTranslation } from '@/modules/localization';
import { usePlaybookStore } from '../store';
import { downloadStepResultHtml, downloadStepResultPdf } from '../utils/renderStepResultHtml';

interface Props {
  step: TaskResult | null;
  execution?: PlaybookExecution | null;
  pageMode?: PlaybookPageMode;
  onBackToRunMode?: () => void;
  onRequestValidateReplay?: (taskId: string) => void;
  onRequestRunEvaluation?: (taskId: string) => void;
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

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${Math.round(value)}%`;
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

function formatToolArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return '{}';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return '{}';
  }
}

function formatPromptStage(stage: string | undefined): string {
  if (!stage) return 'LLM Call';
  return stage
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getExecutionModeLabel(
  mode: string | undefined,
  t: (key: 'execution.mode.live' | 'execution.mode.replayStrict' | 'execution.mode.replayFlex' | 'execution.mode.replayAdaptive') => string,
): string {
  if (mode === 'replay_strict') return t('execution.mode.replayStrict');
  if (mode === 'replay_flex') return t('execution.mode.replayFlex');
  if (mode === 'replay_adaptive') return t('execution.mode.replayAdaptive');
  return t('execution.mode.live');
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
  onRequestGrabOutputFormat,
  onOpenOutputFormatEditor,
  onStepReplayModeChange,
  isRunningEvaluation = false,
  activeTab = 'results',
  onActiveTabChange,
}: Props) {
  const { t } = useModuleTranslation('playbook');
  const navigate = useNavigate();
  const currentPlaybook = usePlaybookStore((s) => s.currentPlaybook);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const replaySource = step ? execution?.replaySourceByTask?.[step.taskId] : null;
  const deleteExecution = usePlaybookStore((s) => s.deleteExecution);
  const deleteStepExecution = usePlaybookStore((s) => s.deleteStepExecution);
  const updatePlaybookFromJudge = usePlaybookStore((s) => s.updatePlaybookFromJudge);
  const generatePlaybookFromJudge = usePlaybookStore((s) => s.generatePlaybookFromJudge);
  const optimizeStepFromJudge = usePlaybookStore((s) => s.optimizeStepFromJudge);
  const fetchAdvisorRemediations = usePlaybookStore((s) => s.fetchAdvisorRemediations);
  const applyAdvisorRemediations = usePlaybookStore((s) => s.applyAdvisorRemediations);
  const fetchTaskReplays = usePlaybookStore((s) => s.fetchTaskReplays);
  const [baselineReplay, setBaselineReplay] = useState<ValidatedTaskReplay | null>(null);
  const [selectedStepExecutionId, setSelectedStepExecutionId] = useState<string | null>(null);
  const [selectedEvaluationId, setSelectedEvaluationId] = useState<string | null>(null);
  const [comparisonEvaluationId, setComparisonEvaluationId] = useState<string | null>(null);
  const [selectedJudgeHistoryId, setSelectedJudgeHistoryId] = useState<string | null>(null);
  const [judgeActionLoading, setJudgeActionLoading] = useState<'update' | 'generate' | 'optimize' | null>(null);
  const [remediationDialogOpen, setRemediationDialogOpen] = useState(false);
  const [remediationDialogMode, setRemediationDialogMode] = useState<'optimize-step' | 'update-current' | 'generate-new'>('update-current');
  const [remediationItems, setRemediationItems] = useState<AdvisorRemediationItem[]>([]);
  const [remediationLoading, setRemediationLoading] = useState(false);
  const currentTask = currentPlaybook?.tasks.find((task) => task.id === step?.taskId) || null;
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
  const isLiveStreaming = step?.status === 'running' || step?.status === 'interrupted';
  const [isNearBottom, setIsNearBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: container.scrollHeight, behavior });
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, []);

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

  const handleApplyJudgeUpdate = useCallback(async () => {
    if (!execution || !currentPlaybook) return;
    setJudgeActionLoading('update');
    try {
      await updatePlaybookFromJudge(currentPlaybook.id, execution.id);
    } finally {
      setJudgeActionLoading(null);
    }
  }, [currentPlaybook, execution, updatePlaybookFromJudge]);

  const handleGenerateJudgePlaybook = useCallback(async () => {
    if (!execution || !currentPlaybook) return;
    setJudgeActionLoading('generate');
    try {
      const created = await generatePlaybookFromJudge(currentPlaybook.id, execution.id);
      navigate(`/playbooks/${created.id}`);
    } finally {
      setJudgeActionLoading(null);
    }
  }, [currentPlaybook, execution, generatePlaybookFromJudge, navigate]);

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

  const handleApplyRemediations = useCallback(async (selectedIds: string[], editedItems: Map<string, string>) => {
    if (!currentPlaybook || !execution) return;
    return applyAdvisorRemediations(currentPlaybook.id, execution.id, {
      mode: remediationDialogMode === 'generate-new' ? 'generate-new' : 'update-current',
      selectedIds,
    });
  }, [currentPlaybook, execution, remediationDialogMode, applyAdvisorRemediations]);

  useEffect(() => {
    setSelectedStepExecutionId((current) => {
      if (!stepExecutions.length) return null;
      const liveExecution = currentStepExecutionId
        ? stepExecutions.find((entry) => entry.id === currentStepExecutionId) || stepExecutions[0]
        : stepExecutions[0];

      if (step?.status === 'running' || step?.status === 'interrupted') {
        return liveExecution?.id ?? null;
      }

      if (current && stepExecutions.some((entry) => entry.id === current)) {
        return current;
      }

      return liveExecution?.id ?? null;
    });
  }, [currentStepExecutionId, step?.status, stepExecutions]);

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
      if (current === latestJudgeHistoryId) return current;
      return latestJudgeHistoryId;
    });
  }, [judgeHistory, step?.taskId]);

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
  const isEvaluationPending = isRunningEvaluation || step.status === 'running';
  const hasStepComparison = Boolean(selectedEvaluation && comparisonSemanticMatch);
  const streamingContentKey = [
    step.taskId,
    step.status,
    step.output || '',
    step.error || '',
    step.components?.length || 0,
    step.toolTrace?.length || 0,
    step.llmPromptTrace?.length || 0,
    step.artifacts?.length || 0,
    selectedStepExecution?.id || 'no-step-execution',
  ].join('|');

  useEffect(() => {
    if (!isLiveStreaming) return;
    if (!isNearBottom) return;
    scrollToBottom('auto');
  }, [isLiveStreaming, isNearBottom, streamingContentKey, scrollToBottom]);

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
            {(execution?.executionMode === 'replay_strict' || execution?.executionMode === 'replay_flex' || execution?.executionMode === 'replay_adaptive') && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700">
                {getExecutionModeLabel(execution?.executionMode, t)}
              </span>
            )}
            <div className="ml-auto flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="whitespace-nowrap text-xs text-muted-foreground">{t('detail.stepMode')}</span>
                <Select
                  value={currentTask?.stepReplayMode ?? 'live'}
                  onValueChange={(v) => onStepReplayModeChange?.(step.taskId, v as 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive')}
                  disabled={!currentTask?.hasValidatedReplay}
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
                {!currentTask?.hasValidatedReplay && (
                  <span className="text-[10px] text-muted-foreground" title={t('detail.noBaselineHint')}>
                    {t('detail.noBaseline')}
                  </span>
                )}
              </div>
              {stepExecutions.length > 0 && (
                <div className="flex items-center gap-1.5">
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
                </div>
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
                    {t('detail.actions.runEvaluation')}
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
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="results">{t('detail.tabs.results')}</TabsTrigger>
            <TabsTrigger value="evaluation">{t('detail.tabs.evaluation')}</TabsTrigger>
            <TabsTrigger value="judge">{t('detail.tabs.judge')}</TabsTrigger>
            <TabsTrigger value="tool-trace">{t('detail.tabs.toolTrace')}</TabsTrigger>
            <TabsTrigger value="replay-diff">{t('detail.tabs.replayDiff')}</TabsTrigger>
            <TabsTrigger value="llm-prompts">{t('detail.tabs.llmPrompts')}</TabsTrigger>
          </TabsList>

          <TabsContent value="results" className="space-y-4">
            {((execution?.executionMode === 'replay_strict' || execution?.executionMode === 'replay_flex' || execution?.executionMode === 'replay_adaptive') || replaySource) && (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <div className="font-medium">{t('detail.provenance.title')}</div>
                <div className="mt-2 space-y-1 text-muted-foreground">
                  <div>{t('detail.provenance.mode')}: {getExecutionModeLabel(execution?.executionMode, t)}</div>
                  {replaySource && (
                    <div>{t('detail.provenance.baseline')}: v{replaySource.validationVersion}</div>
                  )}
                  {baselineReplay?.preserveOutputFormat && (
                    <div>{t('detail.provenance.outputFormat')}</div>
                  )}
                </div>
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

            {selectedStepExecution?.components && selectedStepExecution.components.length > 0 ? (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <StepComponents components={selectedStepExecution.components} taskId={step.taskId} />
              </div>
            ) : selectedStepExecution?.output ? (
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

            {selectedStepExecution?.artifacts && selectedStepExecution.artifacts.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">{t('artifacts.sectionTitle' as any)}</h3>
                <div className="grid gap-2">
                  {selectedStepExecution.artifacts.map((artifact, idx) => (
                    <ArtifactListItem key={`${artifact.portId}-${idx}`} artifact={artifact} />
                  ))}
                </div>
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRequestRunEvaluation?.(step.taskId)}
                    disabled={isRunningEvaluation}
                    className="shrink-0"
                  >
                    {isRunningEvaluation ? t('execution.running') : t('detail.actions.runEvaluation')}
                  </Button>
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
                      <div className="rounded border bg-muted/30 p-2">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.overall')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(selectedEvaluation.semanticMatch.matchScore)}</div>
                      </div>
                      <div className="rounded border bg-muted/30 p-2">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.embeddingSimilarity')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(selectedEvaluation.semanticMatch.semanticSimilarityScore)}</div>
                      </div>
                      <div className="rounded border bg-muted/30 p-2">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.evidenceConsistency')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(selectedEvaluation.semanticMatch.evidenceConsistencyScore)}</div>
                      </div>
                      <div className="rounded border bg-muted/30 p-2">
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
                      <div className="rounded border bg-muted/30 p-2">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.overall')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(comparisonSemanticMatch.matchScore)}</div>
                      </div>
                      <div className="rounded border bg-muted/30 p-2">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.embeddingSimilarity')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(comparisonSemanticMatch.semanticSimilarityScore)}</div>
                      </div>
                      <div className="rounded border bg-muted/30 p-2">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.evidenceConsistency')}</div>
                        <div className="mt-1 text-lg font-semibold">{formatPercent(comparisonSemanticMatch.evidenceConsistencyScore)}</div>
                      </div>
                      <div className="rounded border bg-muted/30 p-2">
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
                  <div className="rounded bg-background p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.overall')}</div>
                    <div className="mt-1 text-lg font-semibold">{formatPercent(semanticMatchToDisplay.matchScore)}</div>
                  </div>
                  <div className="rounded bg-background p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.embeddingSimilarity')}</div>
                    <div className="mt-1 text-lg font-semibold">{formatPercent(semanticMatchToDisplay.semanticSimilarityScore)}</div>
                  </div>
                  <div className="rounded bg-background p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.evaluation.evidenceConsistency')}</div>
                    <div className="mt-1 text-lg font-semibold">{formatPercent(semanticMatchToDisplay.evidenceConsistencyScore)}</div>
                  </div>
                  <div className="rounded bg-background p-3">
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
            ) : (
              <div className="rounded-lg border bg-muted/10 p-4 text-sm text-muted-foreground">
                {isEvaluationPending
                  ? t('detail.evaluation.waiting')
                  : t('detail.evaluation.empty')}
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
            {advisorAutopilotActive && (
              <div className="rounded-lg border bg-muted/20 p-4 text-sm space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.autopilot.title')}</div>
                  <Badge variant="outline" className="rounded-full px-2 py-0 text-xs">
                    {t(`detail.autopilot.status.${execution?.advisorAutopilotStatus || 'idle'}` as any)}
                  </Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.autopilot.targetScore')}</div>
                    <div className="mt-1 font-medium">{formatPercent(execution?.advisorAutopilotTargetScore)}</div>
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

            {judgeHistory.length > 0 && (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-4 text-sm">
                <div className="min-w-[260px] flex-1 space-y-1">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.judge.stepExecutionLabel')}</div>
                  <Select value={selectedJudgeHistory?.id || ''} onValueChange={setSelectedJudgeHistoryId}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={t('detail.judge.stepExecutionPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {judgeHistory.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {new Date(entry.createdAt).toLocaleString()} | {t('detail.evaluation.attempt')} {entry.attemptNumber ?? '-'} | {formatPercent(entry.judgeResult.overallScore)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedJudgeHistory && (
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>{t('detail.evaluation.recorded')}: {new Date(selectedJudgeHistory.createdAt).toLocaleString()}</span>
                    <span>{t('detail.evaluation.attempt')}: {selectedJudgeHistory.attemptNumber ?? '-'}</span>
                    <span>{t('detail.evaluation.judgeModel', { model: selectedJudgeHistory.model || '-' })}</span>
                  </div>
                )}
              </div>
            )}

            {advisorOptimizationHistory.length > 0 && (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-4 text-sm">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('detail.autopilot.appliedOptimizations')}
                </div>
                <div className="space-y-3">
                  {[...advisorOptimizationHistory].reverse().map((entry) => (
                    <div key={`${entry.turn}-${entry.createdAt}`} className="rounded-md border bg-background p-3">
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>{t('detail.autopilot.turnLabel', { turn: entry.turn })}</span>
                        <span>{new Date(entry.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {entry.changedFields.length > 0 ? entry.changedFields.map((field) => (
                          <Badge key={field} variant="outline" className="rounded-full px-2 py-0 text-xs">
                            {t(`detail.autopilot.field.${field}` as any)}
                          </Badge>
                        )) : (
                          <div className="text-xs text-muted-foreground">{t('detail.autopilot.noVisibleChanges')}</div>
                        )}
                      </div>
                      {entry.changedFields.length > 0 && (
                        <div className="mt-3 space-y-3">
                          {entry.changedFields.map((field) => (
                            <div key={field} className="grid gap-3 md:grid-cols-2">
                              <div>
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('detail.autopilot.before')}</div>
                                <div className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-xs">
                                  {formatOptimizationValue(entry.beforeTask?.[field])}
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('detail.autopilot.after')}</div>
                                <div className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-xs">
                                  {formatOptimizationValue(entry.afterTask?.[field])}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {stepJudgeResult ? (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.judge.recommendationPane')}</div>
                      <div className="text-3xl font-semibold">{Math.round(stepJudgeResult.overallScore)}%</div>
                    </div>
                    <Badge variant="outline" className="rounded-full px-2 py-0 text-xs">
                      {t('detail.judge.confidence')} {formatConfidence(stepJudgeResult.confidence)}
                    </Badge>
                    <Badge variant="outline" className="rounded-full px-2 py-0 text-xs">
                      {t('detail.judge.toolUsageScore')} {formatPercent(stepJudgeResult.toolUsageScore)}
                    </Badge>
                    <div className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                      {t(`detail.judge.recommendation.${stepJudgeResult.recommendation}` as any)}
                    </div>
                    <div className="ml-auto flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => openRemediationDialog('update-current')} disabled={remediationLoading}>
                        {remediationLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        {t('detail.judge.updateCurrentPlaybook')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openRemediationDialog('optimize-step')} disabled={remediationLoading}>
                        {remediationLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        {t('detail.judge.optimizeThisStep')}
                      </Button>
                      <Button size="sm" onClick={() => openRemediationDialog('generate-new')} disabled={remediationLoading}>
                        {remediationLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        {t('detail.judge.generateNewOptimizedPlaybook')}
                      </Button>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">{stepJudgeResult.reason || t('detail.judge.noReason')}</p>

                  <AdvisorChangeReviewDialog
                    open={remediationDialogOpen}
                    onOpenChange={setRemediationDialogOpen}
                    items={remediationItems}
                    tasks={currentPlaybook?.tasks || []}
                    mode={remediationDialogMode}
                    loading={remediationLoading}
                    onApply={handleApplyRemediations}
                  />
                </div>

                <div className="rounded-lg border bg-background p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.judge.toolUsageRecommendation')}</div>
                  <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
                    {stepJudgeResult.toolUsageRecommendation || t('detail.judge.noReason')}
                  </p>
                </div>

                <div className="rounded-lg border bg-background p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.judge.remediationSuggestions')}</div>
                  <div className="mt-2 space-y-2 text-sm">
                    {stepJudgeResult.rewriteHints.length > 0 ? (
                      stepJudgeResult.rewriteHints.map((hint, idx) => (
                        <RemediationItemRow key={`rewrite-${idx}`} text={hint} category="prompt" onApply={() => openRemediationDialog('update-current')} />
                      ))
                    ) : (
                      <div className="text-muted-foreground">{t('detail.judge.none')}</div>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {issueSections.map((section) => (
                    <IssueSection
                      key={section.title}
                      title={section.title}
                      badge={section.badge}
                      badgeClassName={section.badgeClassName}
                      items={section.items}
                      emptyLabel={t('detail.judge.none')}
                    />
                  ))}
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

            {judgeSummary && !stepJudgeResult && (
              <div className="rounded-lg border bg-background p-4 text-sm space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.judge.recommendationPane')}</div>
                  <Badge variant="outline" className="rounded-full px-2 py-0 text-xs">
                    {Math.round(judgeSummary.overallScore)}%
                  </Badge>
                  <Badge variant="outline" className="rounded-full px-2 py-0 text-xs">
                    {t('detail.judge.confidence')} {formatConfidence(judgeSummary.confidence)}
                  </Badge>
                  <div className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {t(`detail.judge.recommendation.${judgeSummary.recommendation}` as any)}
                  </div>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openRemediationDialog('update-current')} disabled={remediationLoading}>
                      {remediationLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      {t('detail.judge.updateCurrentPlaybook')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openRemediationDialog('optimize-step')} disabled={remediationLoading}>
                      {remediationLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      {t('detail.judge.optimizeThisStep')}
                    </Button>
                    <Button size="sm" onClick={() => openRemediationDialog('generate-new')} disabled={remediationLoading}>
                      {remediationLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      {t('detail.judge.generateNewOptimizedPlaybook')}
                    </Button>
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-muted-foreground">{judgeSummary.reason || t('detail.judge.noReason')}</p>

                <AdvisorChangeReviewDialog
                  open={remediationDialogOpen}
                  onOpenChange={setRemediationDialogOpen}
                  items={remediationItems}
                  tasks={currentPlaybook?.tasks || []}
                  mode={remediationDialogMode}
                  loading={remediationLoading}
                  onApply={handleApplyRemediations}
                />

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-2">
                  <IssueSection
                    title={t('detail.judge.toolUsageIssues')}
                    badge={t('detail.remediation.category.tooling')}
                    badgeClassName="bg-emerald-100 text-emerald-700 border-emerald-200"
                    items={judgeSummary.toolUsageIssues || []}
                    emptyLabel={t('detail.judge.none')}
                  />
                  <IssueSection
                    title={t('detail.judge.crossStepToolPatterns')}
                    badge={t('detail.remediation.category.structure')}
                    badgeClassName="bg-purple-100 text-purple-700 border-purple-200"
                    items={judgeSummary.crossStepToolPatterns || []}
                    emptyLabel={t('detail.judge.none')}
                  />
                  <IssueSection
                    title={t('detail.judge.rootCauseTaskIds')}
                    badge={t('detail.remediation.category.structure')}
                    badgeClassName="bg-purple-100 text-purple-700 border-purple-200"
                    items={judgeSummary.rootCauseTaskIds || []}
                    emptyLabel={t('detail.judge.none')}
                  />
                  <IssueSection
                    title={t('detail.judge.highImpactRecommendations')}
                    badge={t('detail.remediation.category.structure')}
                    badgeClassName="bg-purple-100 text-purple-700 border-purple-200"
                    items={judgeSummary.highImpactRecommendations || []}
                    emptyLabel={t('detail.judge.none')}
                  />
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="tool-trace" className="space-y-4">
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

          </TabsContent>

          <TabsContent value="replay-diff" className="space-y-4">
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
          </TabsContent>

          <TabsContent value="llm-prompts" className="space-y-4">
            {promptTraceItems.length > 0 ? (
              <div className="space-y-3">
                {promptTraceItems.map((item, index) => (
                  <Collapsible key={`llm-prompt-${index}`} defaultOpen={false} className="rounded-lg border bg-muted/30 px-4">
                    <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 py-4 text-left">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{index + 1}.</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {formatPromptStage(item.stage)}
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
          </TabsContent>
        </Tabs>
      </div>

      {isLiveStreaming && !isNearBottom && (
        <Button
          type="button"
          size="sm"
          className="absolute bottom-4 right-4 z-20 shadow-lg"
          onClick={() => scrollToBottom()}
        >
          <ChevronDown className="mr-1 h-4 w-4" />
          Jump to bottom
        </Button>
      )}
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

/**
 * Renders a mixed list of AI components and humanFeedback components.
 * Groups consecutive non-humanFeedback components and renders them
 * via AIMessageContent, while humanFeedback gets its own inline widget.
 */
export function StepComponents({ components, taskId }: { components: PlaybookComponent[]; taskId: string }) {
  const groups: Array<{ type: 'ai'; items: MessageComponent[] } | { type: 'hf'; data: HumanFeedbackData }> = [];

  let currentAiGroup: MessageComponent[] = [];
  for (const comp of components) {
    if (comp.type === 'humanFeedback') {
      if (currentAiGroup.length > 0) {
        groups.push({ type: 'ai', items: currentAiGroup });
        currentAiGroup = [];
      }
      groups.push({ type: 'hf', data: comp.data as unknown as HumanFeedbackData });
    } else {
      currentAiGroup.push(comp as MessageComponent);
    }
  }
  if (currentAiGroup.length > 0) {
    groups.push({ type: 'ai', items: currentAiGroup });
  }

  return (
    <MessageProvider fileViewerDisplayMode="floating">
      {groups.map((group, i) =>
        group.type === 'ai' ? (
          <AIMessageContent key={i} parts={mapComponentsToContentParts(group.items)} />
        ) : (
          <HumanFeedbackInline key={i} data={group.data} taskId={taskId} />
        ),
      )}
    </MessageProvider>
  );
}
