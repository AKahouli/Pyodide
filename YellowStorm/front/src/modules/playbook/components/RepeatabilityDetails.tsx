import { Loader2, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, useCallback } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookRepeatabilitySummary, RepeatabilityIterationSummary, RepeatabilityTaskExecutionSummary } from '../types';

const PAGE_SIZE = 5;

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${Math.round(value)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function getScoreTone(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'border-border/60 bg-muted/20';
  if (value >= 80) return 'border-emerald-500/30 bg-emerald-500/10';
  if (value >= 60) return 'border-amber-500/30 bg-amber-500/10';
  return 'border-rose-500/30 bg-rose-500/10';
}

function getMatchStateBadge(state: RepeatabilityTaskExecutionSummary['matchState']) {
  if (state === 'matched') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700';
  if (state === 'not_matched') return 'border-rose-500/30 bg-rose-500/10 text-rose-700';
  return 'border-slate-400/40 bg-slate-500/10 text-slate-600';
}

function getPassedBadge(passed: boolean) {
  if (passed) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700';
  return 'border-rose-500/30 bg-rose-500/10 text-rose-700';
}

function MetricCard({
  label,
  value,
  className,
}: Readonly<{
  label: string;
  value: string;
  className?: string;
}>) {
  return (
    <div className={cn('rounded border p-3', className)}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function TaskExecutionPane({ task }: Readonly<{ task: RepeatabilityTaskExecutionSummary }>) {
  const { t } = useModuleTranslation('playbook');

  return (
    <Collapsible defaultOpen={false} className="rounded-md border bg-background/60 px-3 py-2">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
        <div className="flex min-w-0 items-center gap-2">
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
          <span className="truncate text-xs font-medium">{task.taskTitle || task.taskId}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', getMatchStateBadge(task.matchState))}>
            {t(`repeatability.matchState.${task.matchState}`)}
          </Badge>
          <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', getScoreTone(task.matchScore))}>
            {formatPercent(task.matchScore)}
          </Badge>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t('repeatability.expectedResult')}</div>
          <div className="max-h-32 overflow-auto rounded border bg-muted/30 p-2 text-xs whitespace-pre-wrap break-words">
            {task.expectedResult || t('repeatability.expectedResultMissing')}
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded border bg-muted/20 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('repeatability.source')}</div>
            <div className="text-xs font-medium">{t(`repeatability.source.${task.expectedResultSource}`)}</div>
          </div>
          <div className="rounded border bg-muted/20 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('repeatability.type')}</div>
            <div className="text-xs font-medium">{
              ({
                none: t('repeatability.expectedResultType.none'),
                exact_value: t('repeatability.expectedResultType.exact_value'),
                semantic_description: t('repeatability.expectedResultType.semantic_description'),
                numeric_presentation: t('repeatability.expectedResultType.numeric_presentation'),
                document_generation: t('repeatability.expectedResultType.document_generation'),
                baseline_comparison: t('repeatability.expectedResultType.baseline_comparison'),
              } as Record<string, string>)[task.expectedResultType || 'none'] || task.expectedResultType || '-'
            }</div>
          </div>
          <div className="rounded border bg-muted/20 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('repeatability.matched')}</div>
            <div className="text-xs font-medium">
              {task.expectedResultMatched === null
                ? t('repeatability.notEvaluated')
                : t(`repeatability.expectedResultMatched.${task.expectedResultMatched ? 'yes' : 'no'}`)}
            </div>
          </div>
          <div className="rounded border bg-muted/20 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('repeatability.matchScore')}</div>
            <div className="text-xs font-medium">{formatPercent(task.matchScore)}</div>
          </div>
        </div>

        {task.expectedResultReason && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t('repeatability.matchExplanation')}</div>
            <p className="rounded border bg-muted/30 p-2 text-xs whitespace-pre-wrap">{task.expectedResultReason}</p>
          </div>
        )}

        {task.output && (
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t('repeatability.output')}</div>
            <pre className="max-h-40 overflow-auto rounded border bg-muted/30 p-2 text-xs whitespace-pre-wrap break-words">
              {task.output}
            </pre>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function IterationPane({ iteration }: Readonly<{ iteration: RepeatabilityIterationSummary }>) {
  const { t } = useModuleTranslation('playbook');

  return (
    <Collapsible defaultOpen={false} className="rounded-md border bg-background p-4">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
          <span className="text-sm font-medium">
            {t('repeatability.iterationNumber', { number: iteration.executionNumber })}
          </span>
          {iteration.completedAt && (
            <span className="text-xs text-muted-foreground">{formatDate(iteration.completedAt)}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', getPassedBadge(iteration.passed))}>
            {t('repeatability.passedTasks', { passed: iteration.passedTasks, total: iteration.evaluatedTasks })}
          </Badge>
          <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', getScoreTone(iteration.averageMatchScore))}>
            {formatPercent(iteration.averageMatchScore)}
          </Badge>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-2 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        {iteration.tasks.length === 0 ? (
          <div className="rounded border bg-muted/20 p-3 text-xs text-muted-foreground">{t('repeatability.noTasks')}</div>
        ) : (
          iteration.tasks.map((task) => (
            <TaskExecutionPane key={task.taskId} task={task} />
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function RepeatabilityDetails({
  repeatability,
  loading = false,
  className,
  onPageFetch,
}: Readonly<{
  repeatability: PlaybookRepeatabilitySummary | null;
  loading?: boolean;
  className?: string;
  onPageFetch?: (limit: number, offset: number) => Promise<PlaybookRepeatabilitySummary>;
}>) {
  const { t } = useModuleTranslation('playbook');
  const [page, setPage] = useState(0);

  const totalPages = repeatability ? Math.max(1, Math.ceil(repeatability.totalIterations / PAGE_SIZE)) : 1;

  const handlePageChange = useCallback(async (newPage: number) => {
    if (!onPageFetch) return;
    const offset = newPage * PAGE_SIZE;
    await onPageFetch(PAGE_SIZE, offset);
    setPage(newPage);
  }, [onPageFetch]);

  if (loading) {
    return (
      <div className={cn('flex min-h-40 items-center justify-center rounded-lg border bg-muted/20 text-sm text-muted-foreground', className)}>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('repeatability.loading')}
      </div>
    );
  }

  if (!repeatability) {
    return (
      <div className={cn('rounded-lg border bg-muted/20 p-6 text-sm text-muted-foreground', className)}>
        {t('repeatability.noData')}
      </div>
    );
  }

  return (
    <div className={cn('space-y-4 rounded-lg border bg-muted/20 p-4 text-sm', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('repeatability.title')}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t('repeatability.generatedAt', { date: formatDate(repeatability.generatedAt) })}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label={t('repeatability.overallAverageMatch')}
          value={formatPercent(repeatability.overallAverageMatchScore)}
          className={getScoreTone(repeatability.overallAverageMatchScore)}
        />
        <MetricCard
          label={t('repeatability.passedIterations')}
          value={`${repeatability.passedIterations} / ${repeatability.evaluatedIterations}`}
        />
        <MetricCard
          label={t('repeatability.totalIterations')}
          value={String(repeatability.totalIterations)}
        />
      </div>

      {repeatability.iterations.length === 0 ? (
        <div className="rounded-md border bg-background p-4 text-sm text-muted-foreground">
          {t('repeatability.noIterations')}
        </div>
      ) : (
        <div className="space-y-2">
          {repeatability.iterations.map((iteration) => (
            <IterationPane key={iteration.executionId} iteration={iteration} />
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                {t('repeatability.pagination', { page: page + 1, total: totalPages })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page === 0 || loading}
                  onClick={() => void handlePageChange(page - 1)}
                  aria-label={t('repeatability.prevPage')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page >= totalPages - 1 || loading}
                  onClick={() => void handlePageChange(page + 1)}
                  aria-label={t('repeatability.nextPage')}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
