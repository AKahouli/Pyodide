import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PlaybookStatusBadge } from './PlaybookStatusBadge';
import { StepComponents } from './StepComponents';
import { usePlaybookStore, useCurrentPlaybook, useCurrentPlaybookLoading } from '../store';
import * as api from '../api';
import type { PlaybookExecution, TaskResult } from '../types';
import { useModuleTranslation } from '@/modules/localization';

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatTime(isoString: string | null): string {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleString();
}

function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return n.toLocaleString();
}

/** Color-coded diff indicator for a numeric value */
function DiffIndicator({ left, right, lowerIsBetter = true }: { left: number | null; right: number | null; lowerIsBetter?: boolean }) {
  if (left === null || right === null) return null;
  const diff = right - left;
  if (diff === 0) return null;
  const isGood = lowerIsBetter ? diff < 0 : diff > 0;
  const pct = left !== 0 ? Math.round((Math.abs(diff) / left) * 100) : 0;
  return (
    <span className={`text-xs ml-1 ${isGood ? 'text-green-600' : 'text-red-500'}`}>
      {diff > 0 ? '+' : ''}{pct}%
    </span>
  );
}

export function PlaybookExecutionComparePage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useModuleTranslation('playbook');

  const playbook = useCurrentPlaybook();
  const playbookLoading = useCurrentPlaybookLoading();
  const fetchPlaybook = usePlaybookStore((s) => s.fetchPlaybook);

  const execIdA = searchParams.get('a');
  const execIdB = searchParams.get('b');

  const [execA, setExecA] = useState<PlaybookExecution | null>(null);
  const [execB, setExecB] = useState<PlaybookExecution | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (id) fetchPlaybook(id);
  }, [id, fetchPlaybook]);

  useEffect(() => {
    if (!id || !execIdA || !execIdB) return;
    setLoading(true);
    Promise.all([
      api.getExecution(id, execIdA),
      api.getExecution(id, execIdB),
    ]).then(([a, b]) => {
      setExecA(a);
      setExecB(b);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [id, execIdA, execIdB]);

  // Merge task lists from both executions to get a unified step list
  const unifiedSteps = useMemo(() => {
    if (!execA || !execB) return [];
    const taskMap = new Map<string, { a: TaskResult | null; b: TaskResult | null; title: string; order: number }>();

    for (const tr of execA.taskResults) {
      taskMap.set(tr.taskId, { a: tr, b: null, title: tr.nodeTitle, order: tr.order });
    }
    for (const tr of execB.taskResults) {
      const existing = taskMap.get(tr.taskId);
      if (existing) {
        existing.b = tr;
      } else {
        taskMap.set(tr.taskId, { a: null, b: tr, title: tr.nodeTitle, order: tr.order });
      }
    }

    return Array.from(taskMap.values()).sort((a, b) => a.order - b.order);
  }, [execA, execB]);

  // Auto-select first step
  useEffect(() => {
    if (unifiedSteps.length > 0 && !selectedTaskId) {
      setSelectedTaskId(unifiedSteps[0].a?.taskId ?? unifiedSteps[0].b?.taskId ?? null);
    }
  }, [unifiedSteps, selectedTaskId]);

  const selectedStep = useMemo(() => {
    return unifiedSteps.find((s) => (s.a?.taskId ?? s.b?.taskId) === selectedTaskId) ?? null;
  }, [unifiedSteps, selectedTaskId]);

  if (!execIdA || !execIdB) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        {t('compare.missingParams')}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-background">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/playbooks/${id}/executions`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold">
          {playbook?.name || t('execution.playbook')} — {t('compare.title')}
        </h1>
      </div>

      {loading || playbookLoading ? (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !execA || !execB ? (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          {t('compare.loadError')}
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Step list (left sidebar) */}
          <div className="w-72 border-r overflow-y-auto bg-background">
            <div className="p-3">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('compare.steps')}</h3>
              <div className="space-y-1">
                {unifiedSteps.map((step) => {
                  const taskId = step.a?.taskId ?? step.b?.taskId ?? '';
                  const isSelected = taskId === selectedTaskId;
                  const statusA = step.a?.status ?? 'skipped';
                  const statusB = step.b?.status ?? 'skipped';
                  const statusDiff = statusA !== statusB;

                  return (
                    <button
                      key={taskId}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                        isSelected ? 'bg-accent' : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setSelectedTaskId(taskId)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{step.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <PlaybookStatusBadge status={statusA} size="sm" />
                          <span className="text-xs text-muted-foreground">vs</span>
                          <PlaybookStatusBadge status={statusB} size="sm" />
                          {statusDiff && <span className="text-xs text-amber-500">*</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Comparison detail (right panel) */}
          <div className="flex-1 overflow-y-auto">
            {/* Execution summary comparison */}
            <div className="grid grid-cols-2 gap-4 p-4 border-b">
              <ExecutionSummaryCard execution={execA} label={`${t('execution.run')} #${execA.executionNumber}`} />
              <ExecutionSummaryCard execution={execB} label={`${t('execution.run')} #${execB.executionNumber}`} />
            </div>

            {/* Selected step comparison */}
            {selectedStep ? (
              <div className="grid grid-cols-2 gap-4 p-4">
                <StepCard step={selectedStep.a} label={`#${execA.executionNumber}`} other={selectedStep.b} />
                <StepCard step={selectedStep.b} label={`#${execB.executionNumber}`} other={selectedStep.a} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                {t('execution.selectStep')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ExecutionSummaryCard({ execution, label }: { execution: PlaybookExecution; label: string }) {
  const { t } = useModuleTranslation('playbook');

  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">{label}</h3>
        <PlaybookStatusBadge status={execution.status} size="md" />
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        <div className="flex justify-between">
          <span>{t('execution.started')}</span>
          <span>{formatTime(execution.startedAt)}</span>
        </div>
        <div className="flex justify-between">
          <span>{t('execution.duration')}</span>
          <span>{formatDuration(execution.durationMs)}</span>
        </div>
        <div className="flex justify-between">
          <span>{t('compare.totalTokens')}</span>
          <span>{formatTokens(execution.totalTokens)}</span>
        </div>
        <div className="flex justify-between">
          <span>{t('compare.stepsCompleted')}</span>
          <span>
            {execution.taskResults.filter((tr) => tr.status === 'completed').length}
            {' / '}
            {execution.taskResults.length}
          </span>
        </div>
      </div>
    </div>
  );
}

function StepCard({ step, label, other }: { step: TaskResult | null; label: string; other: TaskResult | null }) {
  const { t } = useModuleTranslation('playbook');

  if (!step) {
    return (
      <div className="border rounded-lg p-4 flex items-center justify-center text-muted-foreground text-sm">
        {t('compare.stepNotPresent')}
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <PlaybookStatusBadge status={step.status} size="md" />
      </div>

      <div className="text-xs space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('execution.duration')}</span>
          <span>
            {formatDuration(step.durationMs)}
            {other && <DiffIndicator left={other.durationMs} right={step.durationMs} lowerIsBetter />}
          </span>
        </div>
        {(step.totalTokens != null || step.inputTokens != null) && (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('usage.input')}</span>
              <span>
                {formatTokens(step.inputTokens)}
                {other && <DiffIndicator left={other.inputTokens ?? null} right={step.inputTokens ?? null} lowerIsBetter />}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('usage.output')}</span>
              <span>
                {formatTokens(step.outputTokens)}
                {other && <DiffIndicator left={other.outputTokens ?? null} right={step.outputTokens ?? null} lowerIsBetter />}
              </span>
            </div>
          </>
        )}
        {step.modelName && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('compare.model')}</span>
            <span className="truncate ml-2">{step.modelName}</span>
          </div>
        )}
      </div>

      {step.error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded p-2">
          {step.error}
        </div>
      )}

      {step.components && step.components.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-muted-foreground mb-1">{t('execution.output')}</p>
          <div className="prose prose-sm dark:prose-invert max-w-none max-h-96 overflow-y-auto">
            <StepComponents components={step.components} taskId={step.taskId} />
          </div>
        </div>
      ) : step.output ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-muted-foreground mb-1">{t('execution.output')}</p>
          <div className="bg-muted/50 rounded p-2 text-xs whitespace-pre-wrap max-h-64 overflow-y-auto">
            {step.output}
          </div>
        </div>
      ) : null}
    </div>
  );
}
