import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  ADVISOR_SCORE_DIMENSIONS,
  getDimensionScore,
  type AdvisorAttempt,
  type AdvisorExecutionPoint,
  type AdvisorJudgeResult,
  type AdvisorScoreDimension,
} from '../utils/advisor-evaluation-metrics';
import { EvaluationDefinitionTooltip } from './EvaluationDefinitionTooltip';

function formatPercent(value: number | null, unavailableLabel: string): string {
  return value === null ? unavailableLabel : `${Math.round(value)}%`;
}

function formatDate(value: string | null, unavailableLabel: string): string {
  return value ? new Date(value).toLocaleString() : unavailableLabel;
}

function scoreTone(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

function ExecutionResultCard({
  point,
  side,
  selectedAttemptId,
  onAttemptChange,
}: Readonly<{
  point: AdvisorExecutionPoint;
  side: 'A' | 'B';
  selectedAttemptId: string;
  onAttemptChange: (id: string) => void;
}>) {
  const { t } = useModuleTranslation('playbook');
  const attempt = point.attempts.find((entry) => entry.id === selectedAttemptId) ?? point.attempts[0] ?? null;
  const attemptOverallScore = getDimensionScore(attempt?.result ?? null, 'overallScore');
  const unavailableLabel = t('evaluationWorkspace.notAvailable' as any);
  const output = point.taskResult?.displayText || point.taskResult?.output;

  return (
    <section className="min-w-0 rounded-lg border bg-background p-4" aria-label={t('evaluationWorkspace.compare.runAria' as any, { side })}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <EvaluationDefinitionTooltip
            label={t('evaluationWorkspace.compare.execution' as any, { number: point.execution.executionNumber })}
            definition={t('evaluationWorkspace.tooltip.execution' as any)}
            className="font-semibold"
          />
          <div className="mt-1 text-xs text-muted-foreground">
            <EvaluationDefinitionTooltip label={formatDate(point.execution.completedAt, unavailableLabel)} definition={t('evaluationWorkspace.tooltip.completionDate' as any)} />
          </div>
        </div>
        <EvaluationDefinitionTooltip
          label={formatPercent(attemptOverallScore, unavailableLabel)}
          definition={t('evaluationWorkspace.dimensionTooltip.overallScore' as any)}
          className={cn('text-xl font-semibold', scoreTone(attemptOverallScore))}
        />
      </div>

      <div className="mt-4 space-y-1.5">
        <EvaluationDefinitionTooltip
          label={t('evaluationWorkspace.compare.evaluationAttempt' as any)}
          definition={t('evaluationWorkspace.tooltip.evaluationAttempt' as any)}
          className="text-xs font-medium text-muted-foreground"
        />
        {!point.taskResult ? (
          <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            {t('evaluationWorkspace.compare.noStepResult' as any)}
          </div>
        ) : point.attempts.length > 1 ? (
          <Select value={attempt?.id ?? ''} onValueChange={onAttemptChange}>
            <SelectTrigger aria-label={t('evaluationWorkspace.compare.evaluationAttempt' as any)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {point.attempts.map((entry, index) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {t('evaluationWorkspace.compare.attemptOption' as any, {
                    number: entry.attemptNumber ?? point.attempts.length - index,
                    date: formatDate(entry.createdAt, unavailableLabel),
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : point.attempts.length === 1 ? (
          <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
            {t('evaluationWorkspace.compare.latestAttempt' as any)}
          </div>
        ) : (
          <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            {t('evaluationWorkspace.compare.noEvaluation' as any)}
          </div>
        )}
      </div>

      <div className="mt-4">
        <EvaluationDefinitionTooltip
          label={t('evaluationWorkspace.compare.generatedResult' as any)}
          definition={t('evaluationWorkspace.tooltip.generatedResult' as any)}
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        />
        <div className="mt-2 max-h-80 overflow-auto rounded-md border bg-muted/20 p-3 text-sm whitespace-pre-wrap break-words">
          {output || t(point.taskResult ? 'evaluationWorkspace.compare.noOutput' as any : 'evaluationWorkspace.compare.noStepResult' as any)}
        </div>
      </div>
    </section>
  );
}

function resolveAttempt(point: AdvisorExecutionPoint | null, id: string): AdvisorAttempt | null {
  if (!point) return null;
  return point.attempts.find((attempt) => attempt.id === id) ?? point.attempts[0] ?? null;
}

function DimensionDelta({
  dimension,
  left,
  right,
}: Readonly<{
  dimension: AdvisorScoreDimension;
  left: AdvisorJudgeResult | null;
  right: AdvisorJudgeResult | null;
}>) {
  const { t } = useModuleTranslation('playbook');
  const unavailableLabel = t('evaluationWorkspace.notAvailable' as any);
  const leftScore = getDimensionScore(left, dimension);
  const rightScore = getDimensionScore(right, dimension);
  if (leftScore === null && rightScore === null) return null;
  const delta = leftScore !== null && rightScore !== null ? rightScore - leftScore : null;
  const DeltaIcon = delta === null || Math.abs(delta) < 0.5 ? ArrowRight : delta > 0 ? ArrowUp : ArrowDown;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem_5rem] items-center gap-2 border-b py-2 text-sm last:border-b-0">
      <EvaluationDefinitionTooltip
        label={t(`evaluationWorkspace.dimension.${dimension}` as any)}
        definition={t(`evaluationWorkspace.dimensionTooltip.${dimension}` as any)}
        className="min-w-0 text-xs font-medium"
      />
      <span className={cn('text-right font-medium', scoreTone(leftScore))}>{formatPercent(leftScore, unavailableLabel)}</span>
      <span className={cn('text-right font-medium', scoreTone(rightScore))}>{formatPercent(rightScore, unavailableLabel)}</span>
      <span className={cn(
        'inline-flex items-center justify-end gap-1 font-medium',
        delta === null || Math.abs(delta) < 0.5 ? 'text-muted-foreground' : delta > 0 ? 'text-emerald-600' : 'text-rose-600',
      )}>
        <DeltaIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {delta === null ? unavailableLabel : `${delta > 0 ? '+' : ''}${Math.round(delta)}`}
      </span>
    </div>
  );
}

export function AdvisorExecutionComparison({ points, initialExecutionIds }: Readonly<{
  points: AdvisorExecutionPoint[];
  initialExecutionIds?: { left: string; right: string } | null;
}>) {
  const { t } = useModuleTranslation('playbook');
  const unavailableLabel = t('evaluationWorkspace.notAvailable' as any);
  const comparable = useMemo(() => points.filter((point) => point.taskResult !== null
    || point.execution.id === initialExecutionIds?.left
    || point.execution.id === initialExecutionIds?.right), [initialExecutionIds, points]);
  const [leftExecutionId, setLeftExecutionId] = useState('');
  const [rightExecutionId, setRightExecutionId] = useState('');
  const [leftAttemptId, setLeftAttemptId] = useState('');
  const [rightAttemptId, setRightAttemptId] = useState('');

  useEffect(() => {
    setLeftExecutionId((current) => {
      if (comparable.some((point) => point.execution.id === current)) return current;
      if (comparable.some((point) => point.execution.id === initialExecutionIds?.left)) return initialExecutionIds?.left ?? '';
      return comparable[1]?.execution.id ?? comparable[0]?.execution.id ?? '';
    });
    setRightExecutionId((current) => {
      if (comparable.some((point) => point.execution.id === current)) return current;
      if (comparable.some((point) => point.execution.id === initialExecutionIds?.right)) return initialExecutionIds?.right ?? '';
      return comparable[0]?.execution.id ?? '';
    });
  }, [comparable, initialExecutionIds]);

  const leftPoint = comparable.find((point) => point.execution.id === leftExecutionId) ?? null;
  const rightPoint = comparable.find((point) => point.execution.id === rightExecutionId) ?? null;

  useEffect(() => setLeftAttemptId(leftPoint?.attempts[0]?.id ?? ''), [leftPoint]);
  useEffect(() => setRightAttemptId(rightPoint?.attempts[0]?.id ?? ''), [rightPoint]);

  if (comparable.length < 2) {
    return <div className="rounded-lg border bg-muted/20 p-6 text-sm text-muted-foreground">{t('evaluationWorkspace.compare.insufficient' as any)}</div>;
  }

  const leftResult = resolveAttempt(leftPoint, leftAttemptId)?.result ?? null;
  const rightResult = resolveAttempt(rightPoint, rightAttemptId)?.result ?? null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {[
          { label: t('evaluationWorkspace.compare.leftExecution' as any), value: leftExecutionId, setValue: setLeftExecutionId, other: rightExecutionId },
          { label: t('evaluationWorkspace.compare.rightExecution' as any), value: rightExecutionId, setValue: setRightExecutionId, other: leftExecutionId },
        ].map((selector) => (
          <div key={selector.label} className="space-y-1.5">
            <EvaluationDefinitionTooltip label={selector.label} definition={t('evaluationWorkspace.tooltip.executionSelector' as any)} className="text-xs font-medium" />
            <Select value={selector.value} onValueChange={selector.setValue}>
              <SelectTrigger aria-label={selector.label}><SelectValue /></SelectTrigger>
              <SelectContent>
                {comparable.map((point) => (
                  <SelectItem key={point.execution.id} value={point.execution.id} disabled={point.execution.id === selector.other}>
                    {t('evaluationWorkspace.compare.executionOption' as any, {
                      number: point.execution.executionNumber,
                      date: formatDate(point.execution.completedAt, unavailableLabel),
                      score: formatPercent(point.overallScore, unavailableLabel),
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-background px-4">
        <div className="min-w-[540px]">
          <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem_5rem] gap-2 border-b py-3 text-xs font-medium text-muted-foreground">
            <EvaluationDefinitionTooltip label={t('evaluationWorkspace.compare.metric' as any)} definition={t('evaluationWorkspace.tooltip.metric' as any)} />
            <span className="text-right">{t('evaluationWorkspace.compare.leftColumn' as any)}</span>
            <span className="text-right">{t('evaluationWorkspace.compare.rightColumn' as any)}</span>
            <EvaluationDefinitionTooltip label={t('evaluationWorkspace.compare.change' as any)} definition={t('evaluationWorkspace.tooltip.change' as any)} className="justify-end" />
          </div>
          {ADVISOR_SCORE_DIMENSIONS.map((dimension) => (
            <DimensionDelta key={dimension} dimension={dimension} left={leftResult} right={rightResult} />
          ))}
        </div>
      </div>

      {leftPoint && rightPoint && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ExecutionResultCard point={leftPoint} side="A" selectedAttemptId={leftAttemptId} onAttemptChange={setLeftAttemptId} />
          <ExecutionResultCard point={rightPoint} side="B" selectedAttemptId={rightAttemptId} onAttemptChange={setRightAttemptId} />
        </div>
      )}
    </div>
  );
}
