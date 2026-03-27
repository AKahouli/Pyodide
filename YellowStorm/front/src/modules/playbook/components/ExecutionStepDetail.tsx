import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, Download, FileText, Trash2 } from 'lucide-react';
import { HumanFeedbackInline } from './HumanFeedbackInline';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';
import type { TaskResult, HumanFeedbackData, PlaybookComponent, PlaybookExecution, ValidatedTaskReplay } from '../types';
import type { MessageComponent } from '@/modules/conversation/types';
import { useModuleTranslation } from '@/modules/localization';
import { usePlaybookStore } from '../store';
import { downloadStepResultHtml, downloadStepResultPdf } from '../utils/renderStepResultHtml';

interface Props {
  step: TaskResult | null;
  execution?: PlaybookExecution | null;
  onRequestValidateReplay?: (taskId: string) => void;
  onRequestRunEvaluation?: (taskId: string) => void;
  onRequestGrabOutputFormat?: (taskId: string) => void;
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

function getExecutionModeLabel(mode?: string): string {
  if (mode === 'replay_strict') return 'Replay (Strict)';
  if (mode === 'replay_flex') return 'Replay (Flex)';
  if (mode === 'replay_adaptive') return 'Replay (Adaptive)';
  return 'Live';
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

export function ExecutionStepDetail({
  step,
  execution = null,
  onRequestValidateReplay,
  onRequestRunEvaluation,
  onRequestGrabOutputFormat,
  onStepReplayModeChange,
  isRunningEvaluation = false,
  activeTab = 'results',
  onActiveTabChange,
}: Props) {
  const { t } = useModuleTranslation('playbook');
  const currentPlaybook = usePlaybookStore((s) => s.currentPlaybook);
  const replaySource = step ? execution?.replaySourceByTask?.[step.taskId] : null;
  const deleteExecution = usePlaybookStore((s) => s.deleteExecution);
  const fetchTaskReplays = usePlaybookStore((s) => s.fetchTaskReplays);
  const [baselineReplay, setBaselineReplay] = useState<ValidatedTaskReplay | null>(null);
  const [selectedEvaluationId, setSelectedEvaluationId] = useState<string | null>(null);
  const currentTask = currentPlaybook?.tasks.find((task) => task.id === step?.taskId) || null;
  const evaluationHistory = step?.evaluationHistory || [];
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

  const canDownload = step ? step.status === 'completed' || step.status === 'failed' || step.status === 'skipped' || step.status === 'interrupted' : false;

  const handleDownloadHtml = useCallback(() => {
    if (step) downloadStepResultHtml(step);
  }, [step]);

  const handleDownloadPdf = useCallback(() => {
    if (step) downloadStepResultPdf(step);
  }, [step]);

  useEffect(() => {
    setSelectedEvaluationId((current) => {
      if (!evaluationHistory.length) return null;
      if (current && evaluationHistory.some((entry) => entry.id === current)) {
        return current;
      }
      return evaluationHistory[0].id;
    });
  }, [evaluationHistory, step?.taskId]);

  if (!step) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        {t('execution.selectStep')}
      </div>
    );
  }

  const selectedEvaluation = evaluationHistory.find((entry) => entry.id === selectedEvaluationId) || evaluationHistory[0] || null;
  const semanticMatchToDisplay = selectedEvaluation?.semanticMatch || step.semanticMatch || null;
  const isEvaluationPending = isRunningEvaluation || step.status === 'running';

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-lg font-semibold">{step.nodeTitle}</h2>
          {isBaselineExecution && (
            <span className="rounded-full border border-amber-500/30 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              Baseline
            </span>
          )}
          {baselineReplay?.preserveOutputFormat && (
            <span className="rounded-full border border-sky-500/30 bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
              Format preserved
            </span>
          )}
          {step.isStale && (
            <span
              className="rounded-full border border-amber-500/30 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
              title={step.staleReason || 'Invalidated by an upstream rerun'}
            >
              Stale
            </span>
          )}
          {currentTask?.hasOutputFormatTemplate && currentTask.activeOutputFormatStatus === 'pending' && (
            <span className="rounded-full border border-sky-500/30 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
              Template pending
            </span>
          )}
          {currentTask?.activeOutputFormatStatus === 'failed' && (
            <span className="rounded-full border border-red-500/30 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
              Template failed
            </span>
          )}
          {baselineReplay?.preserveOutputFormat && baselineReplay.formatGuideStatus === 'pending' && (
            <span className="rounded-full border border-sky-500/30 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
              Guide pending
            </span>
          )}
          {baselineReplay?.formatGuideStatus === 'failed' && (
            <span className="rounded-full border border-red-500/30 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
              Guide failed
            </span>
          )}
          {(execution?.executionMode === 'replay_strict' || execution?.executionMode === 'replay_flex' || execution?.executionMode === 'replay_adaptive') && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700">
              {getExecutionModeLabel(execution?.executionMode)}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Step mode:</span>
            <Select
              value={currentTask?.stepReplayMode ?? 'live'}
              onValueChange={(v) => onStepReplayModeChange?.(step.taskId, v as 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive')}
              disabled={!currentTask?.hasValidatedReplay}
            >
              <SelectTrigger className="h-7 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="replay_strict">Replay (Strict)</SelectItem>
                <SelectItem value="replay_flex">Replay (Flex)</SelectItem>
                <SelectItem value="replay_adaptive">Replay (Adaptive)</SelectItem>
              </SelectContent>
            </Select>
            {!currentTask?.hasValidatedReplay && (
              <span className="text-[10px] text-muted-foreground" title="Save a replay baseline to enable replay modes">
                (no baseline)
              </span>
            )}
          </div>
          {execution && step.status === 'completed' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRequestValidateReplay?.(step.taskId)}
            >
              Save Replay Baseline
            </Button>
          )}
          {execution && step.status === 'completed' && !!step.output && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRequestGrabOutputFormat?.(step.taskId)}
            >
              Grab this output format
            </Button>
          )}
          {execution && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              title="Delete execution"
              onClick={() => void deleteExecution(execution.playbookId, execution.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          {canDownload && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" title="Download result">
                  <Download className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleDownloadHtml}>
                  <FileText className="mr-2 h-4 w-4" />
                  Download HTML
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadPdf}>
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {step.agentName && <span>{t('execution.agent')}: {step.agentName}</span>}
          <span>{t('execution.started')}: {formatTime(step.startedAt)}</span>
          {step.completedAt && (
            <span>{t('execution.finished')}: {formatTime(step.completedAt)}</span>
          )}
          <span>{t('execution.duration')}: {formatDuration(step.durationMs)}</span>
        </div>
      </div>

      {step.isStale && (
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This result is stale because an upstream step was rerun. Run this step again or use "Resume From This Step" to recompute downstream steps.
        </div>
      )}

      <Tabs value={activeTab} onValueChange={onActiveTabChange} className="gap-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="results">Step Results</TabsTrigger>
          <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
          <TabsTrigger value="tool-trace">Tool Trace</TabsTrigger>
          <TabsTrigger value="replay-diff">Replay Args Diff</TabsTrigger>
          <TabsTrigger value="llm-prompts">LLM Prompts</TabsTrigger>
        </TabsList>

        <TabsContent value="results" className="space-y-4">
          {((execution?.executionMode === 'replay_strict' || execution?.executionMode === 'replay_flex' || execution?.executionMode === 'replay_adaptive') || replaySource) && (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="font-medium">Replay Provenance</div>
              <div className="mt-2 space-y-1 text-muted-foreground">
                <div>Mode: {getExecutionModeLabel(execution?.executionMode)}</div>
                {replaySource && (
                  <div>Validated baseline: v{replaySource.validationVersion}</div>
                )}
                {baselineReplay?.preserveOutputFormat && (
                  <div>Output format preservation: enabled</div>
                )}
              </div>
            </div>
          )}

          {step.error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4">
              <div className="mb-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                <span className="text-sm font-semibold text-destructive">{t('execution.error')}</span>
              </div>
              <pre className="max-h-80 overflow-y-auto rounded bg-destructive/5 p-3 font-mono text-sm whitespace-pre-wrap break-words text-destructive/90">
                {step.error}
              </pre>
            </div>
          )}

          {step.components && step.components.length > 0 ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <h3 className="mb-2 text-sm font-medium">{t('execution.output')}</h3>
              <StepComponents components={step.components} taskId={step.taskId} />
            </div>
          ) : step.output ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <h3 className="mb-2 text-sm font-medium">{t('execution.output')}</h3>
              <div className="rounded-lg bg-muted/50 p-4 text-sm whitespace-pre-wrap">
                {step.output}
              </div>
            </div>
          ) : step.status !== 'pending' && step.status !== 'running' && !step.error ? (
            <p className="text-sm text-muted-foreground">{t('execution.noOutput')}</p>
          ) : null}

          {step.status === 'running' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              {t('execution.running')}
            </div>
          )}
        </TabsContent>

        <TabsContent value="evaluation" className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-4">
            {(execution || evaluationHistory.length > 0) && (
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                <div className="text-sm text-muted-foreground">
                  Run the selected step again and refresh its baseline evaluation.
                </div>
                {evaluationHistory.length > 0 && (
                  <div className="min-w-[260px] space-y-1 justify-self-end">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Evaluation Run</div>
                    <Select value={selectedEvaluation?.id || ''} onValueChange={setSelectedEvaluationId}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select evaluation" />
                      </SelectTrigger>
                      <SelectContent>
                        {evaluationHistory.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {new Date(entry.createdAt).toLocaleString()} | Attempt {entry.attemptNumber ?? '-'} | {formatPercent(entry.semanticMatch.matchScore)}
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
                    className="justify-self-end"
                  >
                    {isRunningEvaluation ? 'Running...' : 'Run Evaluation'}
                  </Button>
                )}
              </div>
            )}

            {evaluationHistory.length > 0 && (
              <div className={`${execution ? 'mt-4 border-t pt-4' : ''}`}>
                <div className="text-sm text-muted-foreground">
                  Historical evaluations are saved per step attempt. Use the selector above to inspect older runs.
                </div>
                {selectedEvaluation && (
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>Recorded: {new Date(selectedEvaluation.createdAt).toLocaleString()}</span>
                    <span>Attempt: {selectedEvaluation.attemptNumber ?? '-'}</span>
                    <span>Trigger: {selectedEvaluation.trigger}</span>
                    {selectedEvaluation.baselineValidationVersion !== null && (
                      <span>Baseline: v{selectedEvaluation.baselineValidationVersion}</span>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className={`${execution || evaluationHistory.length > 0 ? 'mt-4 border-t pt-4' : ''}`}>
              {isEvaluationPending && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                  <div className="font-medium text-primary">Evaluation in progress</div>
                  <div className="mt-1 text-muted-foreground">
                    The step is rerunning now. New evaluation results will appear here as soon as the run completes.
                  </div>
                </div>
              )}
              {semanticMatchToDisplay ? (
                <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">Semantic Match</div>
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Match {formatPercent(semanticMatchToDisplay.matchScore)}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-4">
                    <div className="rounded bg-background p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Overall</div>
                      <div className="mt-1 text-lg font-semibold">{formatPercent(semanticMatchToDisplay.matchScore)}</div>
                    </div>
                    <div className="rounded bg-background p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Embedding Similarity</div>
                      <div className="mt-1 text-lg font-semibold">{formatPercent(semanticMatchToDisplay.semanticSimilarityScore)}</div>
                    </div>
                    <div className="rounded bg-background p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidence Consistency</div>
                      <div className="mt-1 text-lg font-semibold">{formatPercent(semanticMatchToDisplay.evidenceConsistencyScore)}</div>
                    </div>
                    <div className="rounded bg-background p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Judge Score</div>
                      <div className="mt-1 text-lg font-semibold">{formatPercent(semanticMatchToDisplay.judgeScore)}</div>
                    </div>
                  </div>
                  {semanticMatchToDisplay.reason && (
                    <div className="mt-3 rounded bg-background p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reason</div>
                      <div className="mt-1 text-sm whitespace-pre-wrap">{semanticMatchToDisplay.reason}</div>
                    </div>
                  )}
                  {(semanticMatchToDisplay.missingPoints?.length || semanticMatchToDisplay.changedPoints?.length) ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded bg-background p-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Missing Points</div>
                        {semanticMatchToDisplay.missingPoints?.length ? (
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                            {semanticMatchToDisplay.missingPoints.map((item, index) => (
                              <li key={`missing-${index}`}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="mt-1 text-sm text-muted-foreground">None</div>
                        )}
                      </div>
                      <div className="rounded bg-background p-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Changed Points</div>
                        {semanticMatchToDisplay.changedPoints?.length ? (
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                            {semanticMatchToDisplay.changedPoints.map((item, index) => (
                              <li key={`changed-${index}`}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="mt-1 text-sm text-muted-foreground">None</div>
                        )}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 text-xs text-muted-foreground">
                    {semanticMatchToDisplay.judgeUsed ? `Judge model: ${semanticMatchToDisplay.model || '-'}` : 'Embedding-only fallback used'}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/10 p-4 text-sm text-muted-foreground">
                  {isEvaluationPending
                    ? 'Waiting for evaluation results...'
                    : 'No evaluation available for this step.'}
                </div>
              )}
            </div>
          </div>
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
                      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Args</div>
                      <pre className="max-h-56 overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">
                        {formatToolArgs(item.args)}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Output Summary</div>
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
              No tool trace available for this step.
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
                  ? 'Missing in actual replay'
                  : argsMatch && toolMatch
                    ? 'Matches baseline'
                    : 'Differs from baseline';

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
                        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Validated baseline args</div>
                        <pre className="max-h-56 overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">
                          {formatToolArgs(baselineItem.args)}
                        </pre>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual replay-run args</div>
                        <pre className="max-h-56 overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">
                          {formatToolArgs(actualItem?.args)}
                        </pre>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Validated baseline result</div>
                        <pre className="max-h-56 overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">
                          {baselineItem.outputSummary || '-'}
                        </pre>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual replay-run result</div>
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
                  Some actual replay tool calls do not exist in the validated baseline.
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
              No replay baseline available for diff.
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
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Prompt sent to the LLM</div>
                    <pre className="max-h-[28rem] overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">
                      {item.prompt || '-'}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
              No LLM prompt trace available for this step.
            </div>
          )}
        </TabsContent>
      </Tabs>
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
