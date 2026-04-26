import { Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookRepeatabilitySummary, TaskRepeatabilityResult } from '../types';

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

function getVerdictTone(verdict: TaskRepeatabilityResult['verdict'] | PlaybookRepeatabilitySummary['overallVerdict']): string {
  if (verdict === 'stable') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700';
  if (verdict === 'unstable') return 'border-rose-500/30 bg-rose-500/10 text-rose-700';
  if (verdict === 'insufficient_data') return 'border-amber-500/30 bg-amber-500/10 text-amber-700';
  return 'border-muted-foreground/20 bg-muted/40 text-muted-foreground';
}

function getScoreTextClass(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'text-muted-foreground';
  if (value >= 75) return 'text-green-600';
  if (value >= 50) return 'text-amber-600';
  return 'text-red-600';
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

export function RepeatabilityDetails({
  repeatability,
  loading = false,
  className,
}: Readonly<{
  repeatability: PlaybookRepeatabilitySummary | null;
  loading?: boolean;
  className?: string;
}>) {
  const { t } = useModuleTranslation('playbook');

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
        <Badge variant="outline" className={cn('text-xs', getVerdictTone(repeatability.overallVerdict))}>
          {t(`repeatability.verdict.${repeatability.overallVerdict}`)}
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label={t('repeatability.overallScore')}
          value={formatPercent(repeatability.overallScore)}
          className={getScoreTone(repeatability.overallScore)}
        />
        <MetricCard
          label={t('repeatability.evaluatedTasks')}
          value={`${repeatability.evaluatedTasks} / ${repeatability.totalTasks}`}
        />
        <MetricCard
          label={t('repeatability.totalTasks')}
          value={String(repeatability.totalTasks)}
        />
      </div>

      {repeatability.tasks.length === 0 ? (
        <div className="rounded-md border bg-background p-4 text-sm text-muted-foreground">
          {t('repeatability.noTasks')}
        </div>
      ) : (
        <div className="space-y-3">
          {repeatability.tasks.map((task) => (
            <div key={task.taskId} className="space-y-3 rounded-md border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{task.taskTitle || task.taskId}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{t(`repeatability.source.${task.expectedResultSource}`)}</span>
                    <span>{t('repeatability.executionCount', { count: task.executionCount })}</span>
                    <span>{t('repeatability.comparableCount', { count: task.comparableCount })}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className={cn('text-xs', getVerdictTone(task.verdict))}>
                    {t(`repeatability.verdict.${task.verdict}`)}
                  </Badge>
                  <span className={cn('text-xs font-semibold', getScoreTextClass(task.repeatabilityScore))}>
                    {formatPercent(task.repeatabilityScore)}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('repeatability.expectedResult')}
                    </div>
                    <div className="max-h-44 overflow-auto rounded border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
                      {task.expectedResult || t('repeatability.expectedResultMissing')}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('repeatability.explanation')}
                    </div>
                    {task.findings.length > 0 ? (
                      <ul className="space-y-1 rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                        {task.findings.map((finding, index) => (
                          <li key={`${finding}-${index}`} className="flex gap-2">
                            <span aria-hidden="true">•</span>
                            <span>{finding}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                        {t(task.verdict === 'stable' ? 'repeatability.expectationSatisfied' : 'repeatability.noExplanation')}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('repeatability.perExecution')}
                  </div>
                  {task.perExecution.length > 0 ? (
                    <div className="space-y-2">
                      {task.perExecution.map((execution) => (
                        <div key={execution.executionId} className="rounded border bg-muted/20 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-medium">
                              {t('repeatability.executionNumber', { number: execution.executionNumber })}
                            </span>
                            <span className={cn('font-semibold', getScoreTextClass(execution.score))}>
                              {t('repeatability.scoreValue', { score: formatPercent(execution.score) })}
                            </span>
                            <span className="text-muted-foreground">{formatDate(execution.completedAt)}</span>
                          </div>
                          <pre className="max-h-40 overflow-auto rounded bg-background p-2 text-xs whitespace-pre-wrap break-words">
                            {execution.output || t('repeatability.noOutput')}
                          </pre>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                      {t('repeatability.noPerExecution')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
