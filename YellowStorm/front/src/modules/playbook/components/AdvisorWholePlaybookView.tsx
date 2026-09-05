import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  calculateAdvisorEvaluationMetrics,
  type AdvisorEvaluationMetrics,
  type AdvisorExecutionPoint,
  type AdvisorWholeEvaluationMetrics,
  type AdvisorWholeExecutionPoint,
  type AdvisorWholeExecutionState,
} from '../utils/advisor-evaluation-metrics';
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

function stateTone(state: AdvisorWholeExecutionState): string {
  if (state === 'pass') return 'text-emerald-600 dark:text-emerald-400';
  if (state === 'fail') return 'text-rose-600 dark:text-rose-400';
  return 'text-amber-600 dark:text-amber-400';
}

function KpiCard({ label, definition, value, detail, tone }: Readonly<{
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

function buildTaskHealth(points: AdvisorWholeExecutionPoint[]) {
  const catalog = new Map<string, { title: string; order: number }>();
  for (const point of points) {
    for (const step of point.steps) {
      if (!catalog.has(step.taskId)) catalog.set(step.taskId, { title: step.title, order: step.order });
    }
  }

  return [...catalog.entries()]
    .map(([taskId, task]) => {
      const taskPoints: AdvisorExecutionPoint[] = points.map((point) => {
        const step = point.steps.find((candidate) => candidate.taskId === taskId);
        return {
          execution: point.execution,
          taskResult: step?.taskResult ?? null,
          attempts: step?.attempts ?? [],
          latestResult: step?.latestResult ?? null,
          overallScore: step?.overallScore ?? null,
        };
      });
      return { taskId, ...task, metrics: calculateAdvisorEvaluationMetrics(taskPoints) };
    })
    .sort((left, right) => left.order - right.order);
}

function WholeSummary({ metrics }: Readonly<{ metrics: AdvisorWholeEvaluationMetrics }>) {
  const { t } = useModuleTranslation('playbook');
  const quality = t(`evaluationWorkspace.quality.${metrics.quality}` as any);
  const stability = t(`evaluationWorkspace.stability.${metrics.stability}` as any);
  return (
    <div className={cn('rounded-lg border p-4', scoreTone(metrics.averageScore))}>
      <EvaluationDefinitionTooltip
        label={`${quality} · ${stability}`}
        definition={t('evaluationWorkspace.whole.tooltip.summary' as any)}
        className="text-base font-semibold"
      />
      <p className="mt-1 text-sm text-muted-foreground">
        {t('evaluationWorkspace.whole.summaryDescription' as any, {
          executions: metrics.executionCount,
          evaluated: metrics.evaluatedExecutionCount,
        })}
      </p>
    </div>
  );
}

export function AdvisorWholePlaybookSummary({ metrics }: Readonly<{
  metrics: AdvisorWholeEvaluationMetrics;
}>) {
  const { t } = useModuleTranslation('playbook');
  const unavailableLabel = t('evaluationWorkspace.notAvailable' as any);

  return (
    <div className="space-y-4">
      <WholeSummary metrics={metrics} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t('evaluationWorkspace.whole.kpi.quality' as any)}
          definition={t('evaluationWorkspace.whole.tooltip.quality' as any)}
          value={formatPercent(metrics.averageScore, unavailableLabel)}
          detail={t('evaluationWorkspace.whole.kpi.qualityDetail' as any, { count: metrics.evaluatedExecutionCount })}
          tone={scoreTone(metrics.averageScore)}
        />
        <KpiCard
          label={t('evaluationWorkspace.whole.kpi.variation' as any)}
          definition={t('evaluationWorkspace.whole.tooltip.variation' as any)}
          value={metrics.variation === null ? unavailableLabel : t('evaluationWorkspace.kpi.variationValue' as any, { value: Math.round(metrics.variation) })}
          detail={t(`evaluationWorkspace.stability.${metrics.stability}` as any)}
        />
        <KpiCard
          label={t('evaluationWorkspace.whole.kpi.passRate' as any)}
          definition={t('evaluationWorkspace.whole.tooltip.passRate' as any)}
          value={`${metrics.passedCount} / ${metrics.executionCount}`}
          detail={t('evaluationWorkspace.whole.kpi.passRateDetail' as any)}
        />
        <KpiCard
          label={t('evaluationWorkspace.whole.kpi.coverage' as any)}
          definition={t('evaluationWorkspace.whole.tooltip.coverage' as any)}
          value={`${metrics.evaluatedStepCount} / ${metrics.eligibleStepCount}`}
          detail={t('evaluationWorkspace.whole.kpi.coverageDetail' as any)}
        />
      </div>
    </div>
  );
}

export function AdvisorWholePlaybookHistory({ points }: Readonly<{
  points: AdvisorWholeExecutionPoint[];
}>) {
  const { t } = useModuleTranslation('playbook');
  const unavailableLabel = t('evaluationWorkspace.notAvailable' as any);
  const chronological = [...points].reverse();
  const taskHealth = useMemo(() => buildTaskHealth(points), [points]);

  return (
    <div className="space-y-4">

      <section className="rounded-lg border bg-background p-4">
        <EvaluationDefinitionTooltip label={t('evaluationWorkspace.whole.history.title' as any)} definition={t('evaluationWorkspace.whole.tooltip.history' as any)} className="font-semibold" />
        <div className="mt-4 space-y-2" role="list" aria-label={t('evaluationWorkspace.whole.history.title' as any)}>
          {chronological.map((point) => (
            <div key={point.execution.id} className="grid gap-2 rounded-md border px-3 py-2 text-xs sm:grid-cols-[5rem_minmax(0,1fr)_6rem_7rem] sm:items-center" role="listitem">
              <span className="font-medium">{t('evaluationWorkspace.compare.execution' as any, { number: point.execution.executionNumber })}</span>
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-2 min-w-20 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  {point.overallScore !== null && <div className={cn('h-full rounded-full', point.overallScore >= 80 ? 'bg-emerald-500' : point.overallScore >= 60 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${point.overallScore}%` }} />}
                </div>
                <span className="w-10 text-right font-semibold">{formatPercent(point.overallScore, unavailableLabel)}</span>
              </div>
              <span>{t('evaluationWorkspace.whole.history.coverage' as any, { evaluated: point.evaluatedCount, eligible: point.eligibleCount })}</span>
              <span className={cn('font-medium sm:text-right', stateTone(point.state))}>{t(`evaluationWorkspace.whole.state.${point.state}` as any)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border bg-background p-4">
        <EvaluationDefinitionTooltip label={t('evaluationWorkspace.whole.health.title' as any)} definition={t('evaluationWorkspace.whole.tooltip.health' as any)} className="font-semibold" />
        <table className="mt-4 min-w-[620px] w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="pb-2 font-medium">{t('evaluationWorkspace.whole.health.step' as any)}</th>
              <th className="pb-2 text-right font-medium">{t('evaluationWorkspace.kpi.average' as any)}</th>
              <th className="pb-2 text-right font-medium">{t('evaluationWorkspace.kpi.variation' as any)}</th>
              <th className="pb-2 text-right font-medium">{t('evaluationWorkspace.kpi.passRate' as any)}</th>
              <th className="pb-2 text-right font-medium">{t('evaluationWorkspace.kpi.coverage' as any)}</th>
            </tr>
          </thead>
          <tbody>
            {taskHealth.map(({ taskId, title, metrics: taskMetrics }) => (
              <tr key={taskId} className="border-b last:border-0">
                <td className="py-2 font-medium">{title}</td>
                <td className="py-2 text-right">{formatPercent(taskMetrics.averageScore, unavailableLabel)}</td>
                <td className="py-2 text-right">{taskMetrics.variation === null ? unavailableLabel : t('evaluationWorkspace.kpi.variationValue' as any, { value: Math.round(taskMetrics.variation) })}</td>
                <td className="py-2 text-right">{taskMetrics.passedCount} / {taskMetrics.evaluatedCount}</td>
                <td className="py-2 text-right">{taskMetrics.evaluatedCount} / {taskMetrics.eligibleCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
