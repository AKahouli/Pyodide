import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useAdvisorEvaluationData } from '../hooks/useAdvisorEvaluationData';
import type { PlaybookTask } from '../types';
import {
  buildAdvisorExecutionPoints,
  calculateAdvisorEvaluationMetrics,
  type AdvisorEvaluationMetrics,
  type AdvisorExecutionPoint,
} from '../utils/advisor-evaluation-metrics';
import { AdvisorExecutionComparison } from './AdvisorExecutionComparison';
import { EvaluationDefinitionTooltip } from './EvaluationDefinitionTooltip';

function formatPercent(value: number | null, unavailableLabel: string): string {
  return value === null ? unavailableLabel : `${Math.round(value)}%`;
}

function scoreTone(value: number | null): string {
  if (value === null) return 'border-border bg-muted/20';
  if (value >= 80) return 'border-emerald-500/30 bg-emerald-500/10';
  if (value >= 60) return 'border-amber-500/30 bg-amber-500/10';
  return 'border-rose-500/30 bg-rose-500/10';
}

function KpiCard({
  label,
  definition,
  value,
  detail,
  tone,
}: Readonly<{
  label: string;
  definition: string;
  value: string;
  detail: string;
  tone?: string;
}>) {
  return (
    <div className={cn('rounded-lg border p-4', tone)}>
      <EvaluationDefinitionTooltip label={label} definition={definition} className="text-xs font-medium uppercase tracking-wide text-muted-foreground" />
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function QualitySummary({ metrics }: Readonly<{ metrics: AdvisorEvaluationMetrics }>) {
  const { t } = useModuleTranslation('playbook');
  const qualityKey = `evaluationWorkspace.quality.${metrics.quality}`;
  const stabilityKey = `evaluationWorkspace.stability.${metrics.stability}`;
  const tone = metrics.quality === 'high' && metrics.stability === 'stable'
    ? 'border-emerald-500/30 bg-emerald-500/10'
    : metrics.quality === 'low' || metrics.stability === 'variable'
      ? 'border-rose-500/30 bg-rose-500/10'
      : 'border-amber-500/30 bg-amber-500/10';

  return (
    <div className={cn('rounded-lg border p-4', tone)}>
      <EvaluationDefinitionTooltip
        label={`${t(qualityKey as any)} · ${t(stabilityKey as any)}`}
        definition={t('evaluationWorkspace.tooltip.summaryStatus' as any)}
        className="text-base font-semibold"
      />
      <p className="mt-1 text-sm text-muted-foreground">
        {metrics.stability === 'insufficient'
          ? t('evaluationWorkspace.summaryDescriptionInsufficient' as any, {
            quality: t(qualityKey as any).toLocaleLowerCase(),
          })
          : t('evaluationWorkspace.summaryDescription' as any, {
            quality: t(qualityKey as any).toLocaleLowerCase(),
            stability: t(`evaluationWorkspace.summaryStability.${metrics.stability}` as any),
          })}
      </p>
    </div>
  );
}

function AdvisorTrend({ points }: Readonly<{ points: AdvisorExecutionPoint[] }>) {
  const { t } = useModuleTranslation('playbook');
  const chronological = [...points].reverse();
  const unavailableLabel = t('evaluationWorkspace.notAvailable' as any);

  return (
    <section className="rounded-lg border bg-background p-4">
      <EvaluationDefinitionTooltip
        label={t('evaluationWorkspace.trend.title' as any)}
        definition={t('evaluationWorkspace.tooltip.trend' as any)}
        className="font-semibold"
      />
      <div className="mt-4 space-y-2" role="list" aria-label={t('evaluationWorkspace.trend.title' as any)}>
        {chronological.map((point) => (
          <div key={point.execution.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-xs" role="listitem">
            <EvaluationDefinitionTooltip
              label={`#${point.execution.executionNumber}`}
              definition={t('evaluationWorkspace.tooltip.executionNumber' as any)}
              className="font-medium"
            />
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              {point.overallScore !== null && (
                <div
                  className={cn('h-full rounded-full', point.overallScore >= 80 ? 'bg-emerald-500' : point.overallScore >= 60 ? 'bg-amber-500' : 'bg-rose-500')}
                  style={{ width: `${point.overallScore}%` }}
                />
              )}
            </div>
            <EvaluationDefinitionTooltip
              label={formatPercent(point.overallScore, unavailableLabel)}
              definition={point.overallScore === null
                ? t('evaluationWorkspace.tooltip.unevaluatedScore' as any)
                : t('evaluationWorkspace.tooltip.executionScore' as any)}
              className="justify-end font-semibold"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function AdvisorEvaluationWorkspace({
  playbookId,
  tasks,
  enabled,
}: Readonly<{
  playbookId: string;
  tasks: PlaybookTask[];
  enabled: boolean;
}>) {
  const { t } = useModuleTranslation('playbook');
  const eligibleTasks = useMemo(
    () => tasks
      .filter((task) => task.enabled !== false && task.taskType !== 'evaluation')
      .sort((left, right) => left.executionOrder - right.executionOrder),
    [tasks],
  );
  const { executions, loading, error, unavailableCount, refresh } = useAdvisorEvaluationData(playbookId, enabled);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const unavailableLabel = t('evaluationWorkspace.notAvailable' as any);

  useEffect(() => {
    if (eligibleTasks.some((task) => task.id === selectedTaskId)) return;
    const evaluatedTask = eligibleTasks.find((task) =>
      buildAdvisorExecutionPoints(executions, task.id).some((point) => point.overallScore !== null),
    );
    setSelectedTaskId(evaluatedTask?.id ?? eligibleTasks[0]?.id ?? '');
  }, [eligibleTasks, executions, selectedTaskId]);

  const points = useMemo(
    () => selectedTaskId ? buildAdvisorExecutionPoints(executions, selectedTaskId) : [],
    [executions, selectedTaskId],
  );
  const metrics = useMemo(() => calculateAdvisorEvaluationMetrics(points), [points]);

  if (loading) {
    return (
      <div className="flex min-h-72 items-center justify-center rounded-lg border bg-muted/20 text-sm text-muted-foreground" role="status" aria-live="polite">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('evaluationWorkspace.loading' as any)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center" role="alert">
        <AlertTriangle className="h-5 w-5 text-destructive" />
        <div className="text-sm">{t('evaluationWorkspace.error' as any)}</div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw className="mr-2 h-4 w-4" />{t('evaluationWorkspace.retry' as any)}</Button>
      </div>
    );
  }

  if (eligibleTasks.length === 0 || executions.length === 0) {
    return <div className="rounded-lg border bg-muted/20 p-8 text-center text-sm text-muted-foreground">{t('evaluationWorkspace.empty' as any)}</div>;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid min-h-0 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-lg border bg-muted/20 p-3">
          <EvaluationDefinitionTooltip label={t('evaluationWorkspace.steps' as any)} definition={t('evaluationWorkspace.tooltip.steps' as any)} className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground" />
          <div className="mt-3 hidden space-y-1 lg:block">
            {eligibleTasks.map((task) => {
              const taskMetrics = calculateAdvisorEvaluationMetrics(buildAdvisorExecutionPoints(executions, task.id));
              return (
                <div
                  key={task.id}
                  className={cn('rounded-md border px-3 py-2 transition-colors', selectedTaskId === task.id ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted')}
                >
                  <button type="button" className="w-full truncate text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedTaskId(task.id)}>
                    {task.title || t('evaluationWorkspace.untitledStep' as any)}
                  </button>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                    <EvaluationDefinitionTooltip label={formatPercent(taskMetrics.averageScore, unavailableLabel)} definition={t('evaluationWorkspace.tooltip.average' as any)} />
                    <EvaluationDefinitionTooltip label={t(`evaluationWorkspace.stability.${taskMetrics.stability}` as any)} definition={t('evaluationWorkspace.tooltip.variation' as any)} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 lg:hidden">
            <Select value={selectedTaskId} onValueChange={setSelectedTaskId}>
              <SelectTrigger aria-label={t('evaluationWorkspace.steps' as any)}><SelectValue /></SelectTrigger>
              <SelectContent>{eligibleTasks.map((task) => <SelectItem key={task.id} value={task.id}>{task.title || t('evaluationWorkspace.untitledStep' as any)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          {unavailableCount > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs" role="status">
              {t('evaluationWorkspace.partialData' as any, { count: unavailableCount })}
            </div>
          )}
          <QualitySummary metrics={metrics} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label={t('evaluationWorkspace.kpi.average' as any)} definition={t('evaluationWorkspace.tooltip.average' as any)} value={formatPercent(metrics.averageScore, unavailableLabel)} detail={t('evaluationWorkspace.kpi.averageDetail' as any, { count: metrics.evaluatedCount })} tone={scoreTone(metrics.averageScore)} />
            <KpiCard label={t('evaluationWorkspace.kpi.variation' as any)} definition={t('evaluationWorkspace.tooltip.variation' as any)} value={metrics.variation === null ? unavailableLabel : t('evaluationWorkspace.kpi.variationValue' as any, { value: Math.round(metrics.variation) })} detail={t(`evaluationWorkspace.stability.${metrics.stability}` as any)} />
            <KpiCard label={t('evaluationWorkspace.kpi.passRate' as any)} definition={t('evaluationWorkspace.tooltip.passRate' as any)} value={`${metrics.passedCount} / ${metrics.evaluatedCount}`} detail={t('evaluationWorkspace.kpi.passRateDetail' as any)} />
            <KpiCard label={t('evaluationWorkspace.kpi.coverage' as any)} definition={t('evaluationWorkspace.tooltip.coverage' as any)} value={`${metrics.evaluatedCount} / ${metrics.eligibleCount}`} detail={t('evaluationWorkspace.kpi.coverageDetail' as any)} />
          </div>

          <Tabs defaultValue="history" className="space-y-4">
            <TabsList>
              <TabsTrigger value="history">{t('evaluationWorkspace.tabs.history' as any)}</TabsTrigger>
              <TabsTrigger value="compare">{t('evaluationWorkspace.tabs.compare' as any)}</TabsTrigger>
            </TabsList>
            <TabsContent value="history"><AdvisorTrend points={points} /></TabsContent>
            <TabsContent value="compare"><AdvisorExecutionComparison key={selectedTaskId} points={points} /></TabsContent>
          </Tabs>
        </main>
      </div>
    </TooltipProvider>
  );
}
