import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { AdvisorWholeExecutionPoint, AdvisorWholeExecutionState, AdvisorWholeStepPoint } from '../utils/advisor-evaluation-metrics';
import { EvaluationDefinitionTooltip } from './EvaluationDefinitionTooltip';

function formatPercent(value: number | null, unavailableLabel: string): string {
  return value === null ? unavailableLabel : `${Math.round(value)}%`;
}

function scoreTone(value: number | null): string {
  if (value === null) return 'text-muted-foreground';
  if (value >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (value >= 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

function stateTone(state: AdvisorWholeExecutionState): string {
  if (state === 'pass') return 'text-emerald-600 dark:text-emerald-400';
  if (state === 'fail') return 'text-rose-600 dark:text-rose-400';
  return 'text-amber-600 dark:text-amber-400';
}

function ExecutionSummary({ point, side }: Readonly<{ point: AdvisorWholeExecutionPoint; side: 'A' | 'B' }>) {
  const { t } = useModuleTranslation('playbook');
  const unavailableLabel = t('evaluationWorkspace.notAvailable' as any);
  return (
    <section className="rounded-lg border bg-background p-4" aria-label={t('evaluationWorkspace.compare.runAria' as any, { side })}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{t('evaluationWorkspace.compare.execution' as any, { number: point.execution.executionNumber })}</div>
          <div className="mt-1 text-xs text-muted-foreground">{point.execution.completedAt ? new Date(point.execution.completedAt).toLocaleString() : unavailableLabel}</div>
        </div>
        <div className={cn('text-xl font-semibold', scoreTone(point.overallScore))}>{formatPercent(point.overallScore, unavailableLabel)}</div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>{t('evaluationWorkspace.whole.history.coverage' as any, { evaluated: point.evaluatedCount, eligible: point.eligibleCount })}</span>
        <span className={cn('font-medium', stateTone(point.state))}>{t(`evaluationWorkspace.whole.state.${point.state}` as any)}</span>
      </div>
    </section>
  );
}

function getStepStatus(left: AdvisorWholeStepPoint | undefined, right: AdvisorWholeStepPoint | undefined): string | null {
  if (!left && right) return 'added';
  if (left && !right) return 'removed';
  if (!left?.taskResult || !right?.taskResult) return 'notExecuted';
  if (left.overallScore === null || right.overallScore === null) return 'notEvaluated';
  return null;
}

export function AdvisorWholePlaybookComparison({ points, drillableTaskIds, onDrillDown }: Readonly<{
  points: AdvisorWholeExecutionPoint[];
  drillableTaskIds: ReadonlySet<string>;
  onDrillDown: (taskId: string, leftExecutionId: string, rightExecutionId: string) => void;
}>) {
  const { t } = useModuleTranslation('playbook');
  const unavailableLabel = t('evaluationWorkspace.notAvailable' as any);
  const [leftExecutionId, setLeftExecutionId] = useState('');
  const [rightExecutionId, setRightExecutionId] = useState('');

  useEffect(() => {
    setLeftExecutionId((current) => points.some((point) => point.execution.id === current) ? current : points[1]?.execution.id ?? points[0]?.execution.id ?? '');
    setRightExecutionId((current) => points.some((point) => point.execution.id === current) ? current : points[0]?.execution.id ?? '');
  }, [points]);

  const leftPoint = points.find((point) => point.execution.id === leftExecutionId) ?? null;
  const rightPoint = points.find((point) => point.execution.id === rightExecutionId) ?? null;
  const rows = useMemo(() => {
    const catalog = new Map<string, { title: string; order: number }>();
    for (const step of [...(leftPoint?.steps ?? []), ...(rightPoint?.steps ?? [])]) {
      if (!catalog.has(step.taskId)) catalog.set(step.taskId, { title: step.title, order: step.order });
    }
    return [...catalog.entries()]
      .map(([taskId, task]) => ({
        taskId,
        ...task,
        left: leftPoint?.steps.find((step) => step.taskId === taskId),
        right: rightPoint?.steps.find((step) => step.taskId === taskId),
      }))
      .sort((left, right) => left.order - right.order);
  }, [leftPoint, rightPoint]);

  if (points.length < 2) {
    return <div className="rounded-lg border bg-muted/20 p-6 text-sm text-muted-foreground">{t('evaluationWorkspace.whole.compare.insufficient' as any)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {[
          { label: t('evaluationWorkspace.compare.leftExecution' as any), value: leftExecutionId, setValue: setLeftExecutionId, other: rightExecutionId },
          { label: t('evaluationWorkspace.compare.rightExecution' as any), value: rightExecutionId, setValue: setRightExecutionId, other: leftExecutionId },
        ].map((selector) => (
          <div key={selector.label} className="space-y-1.5">
            <EvaluationDefinitionTooltip label={selector.label} definition={t('evaluationWorkspace.whole.tooltip.executionSelector' as any)} className="text-xs font-medium" />
            <Select value={selector.value} onValueChange={selector.setValue}>
              <SelectTrigger aria-label={selector.label}><SelectValue /></SelectTrigger>
              <SelectContent>
                {points.map((point) => (
                  <SelectItem key={point.execution.id} value={point.execution.id} disabled={point.execution.id === selector.other}>
                    {t('evaluationWorkspace.whole.compare.executionOption' as any, {
                      number: point.execution.executionNumber,
                      score: formatPercent(point.overallScore, unavailableLabel),
                      evaluated: point.evaluatedCount,
                      eligible: point.eligibleCount,
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      {leftPoint && rightPoint && <div className="grid gap-3 md:grid-cols-2"><ExecutionSummary point={leftPoint} side="A" /><ExecutionSummary point={rightPoint} side="B" /></div>}

      <section className="overflow-x-auto rounded-lg border bg-background p-4">
        <EvaluationDefinitionTooltip label={t('evaluationWorkspace.whole.compare.matrixTitle' as any)} definition={t('evaluationWorkspace.whole.tooltip.matrix' as any)} className="font-semibold" />
        <table className="mt-4 min-w-[680px] w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="pb-2 font-medium">{t('evaluationWorkspace.whole.health.step' as any)}</th>
              <th className="pb-2 text-right font-medium">{t('evaluationWorkspace.compare.leftColumn' as any)}</th>
              <th className="pb-2 text-right font-medium">{t('evaluationWorkspace.compare.rightColumn' as any)}</th>
              <th className="pb-2 text-right font-medium">{t('evaluationWorkspace.compare.change' as any)}</th>
              <th className="pb-2 text-right font-medium">{t('evaluationWorkspace.whole.compare.status' as any)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const leftScore = row.left?.overallScore ?? null;
              const rightScore = row.right?.overallScore ?? null;
              const delta = leftScore !== null && rightScore !== null ? rightScore - leftScore : null;
              const DeltaIcon = delta === null || Math.abs(delta) < 0.5 ? ArrowRight : delta > 0 ? ArrowUp : ArrowDown;
              const status = getStepStatus(row.left, row.right);
              const canDrillDown = drillableTaskIds.has(row.taskId);
              return (
                <tr key={row.taskId} className="border-b last:border-0">
                  <td className="py-2">
                    <button
                      type="button"
                      disabled={!canDrillDown}
                      className="text-left font-medium underline-offset-4 enabled:hover:underline disabled:cursor-default"
                      onClick={() => onDrillDown(row.taskId, leftExecutionId, rightExecutionId)}
                    >
                      {row.title}
                    </button>
                  </td>
                  <td className={cn('py-2 text-right font-medium', scoreTone(leftScore))}>{formatPercent(leftScore, unavailableLabel)}</td>
                  <td className={cn('py-2 text-right font-medium', scoreTone(rightScore))}>{formatPercent(rightScore, unavailableLabel)}</td>
                  <td className={cn('py-2 text-right font-medium', delta === null || Math.abs(delta) < 0.5 ? 'text-muted-foreground' : delta > 0 ? 'text-emerald-600' : 'text-rose-600')}>
                    <span className="inline-flex items-center justify-end gap-1"><DeltaIcon className="h-3.5 w-3.5" aria-hidden="true" />{delta === null ? unavailableLabel : `${delta > 0 ? '+' : ''}${Math.round(delta)}`}</span>
                  </td>
                  <td className="py-2 text-right text-xs text-muted-foreground">{status ? t(`evaluationWorkspace.whole.compare.${status}` as any) : t('evaluationWorkspace.whole.compare.comparable' as any)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
