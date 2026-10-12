import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { HealthAction, HealthConcept, HealthIssue } from '../../types';
import { CAUSE_CLASSES, exampleWhat, exampleWhere, formatNumber, issueTexts, type Translate } from './healthModel';

/**
 * One problem of a concept: its cause, what it costs, the evidence (a breakdown and real rows with where
 * they came from) and one suggested fix, applied by opening the editor where it is made.
 */
export function HealthIssueCard({ issue, concepts, canEdit, onAction }: Readonly<{
  issue: HealthIssue;
  concepts: HealthConcept[];
  canEdit: boolean;
  onAction: (action: HealthAction) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const translate = t as Translate;
  const text = issueTexts(issue, translate, concepts);
  const widest = Math.max(1, ...(issue.breakdown?.items.map((item) => item.value) ?? [1]));
  // Changing the model needs edit rights; looking at the data and following a link does not.
  const reading = (action: HealthAction) => ['view_records', 'go_to_concept', 'raise_ai_limit', 'open_run_limits'].includes(action.kind);
  return <article className={`rounded-2xl border bg-card p-5 ${issue.severity === 'blocked' ? 'border-destructive/40' : ''}`} aria-labelledby={`health-issue-${issue.id}`}>
    <div className='flex flex-wrap items-center gap-2.5'>
      <span className={`rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${CAUSE_CLASSES[issue.cause]}`}>{translate(`health.cause.${issue.cause}`)}</span>
      <span className='text-xs text-muted-foreground'>{text.impact}</span>
    </div>
    <h3 id={`health-issue-${issue.id}`} className='mt-2.5 text-lg font-semibold leading-snug'>{text.title}</h3>
    <p className='mt-1.5 max-w-3xl text-sm text-muted-foreground'>{text.why}</p>

    {issue.breakdown && <div className='mt-4 rounded-xl border bg-muted/30 p-3.5'>
      <p className='mb-2.5 text-xs text-muted-foreground'>{text.breakdownTitle}</p>
      <ul className='space-y-2'>
        {issue.breakdown.items.map((item) => <li key={`${item.label}:${item.value}`} className='grid grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)_6rem] items-center gap-2.5'>
          <span className='truncate font-mono text-sm' title={issue.breakdown?.kind === 'reading' ? translate(`health.issue.archive_reading.category.${item.label}`) : item.label}>
            {issue.breakdown?.kind === 'ai_cost' ? formatNumber(Number(item.label))
              : issue.breakdown?.kind === 'reading' ? translate(`health.issue.archive_reading.category.${item.label}`) : item.label}
            {item.current && <span className='ml-1 text-xs text-muted-foreground'>({translate('health.issue.ai_row_limit.now')})</span>}
          </span>
          <span className='h-3.5 overflow-hidden rounded bg-muted' aria-hidden>
            <span className='block h-full rounded bg-primary/70' style={{ width: `${Math.max(1, (item.value / widest) * 100)}%` }} />
          </span>
          <span className='text-right font-mono text-xs text-muted-foreground'>{formatNumber(item.value)}</span>
        </li>)}
      </ul>
    </div>}

    {issue.examples.length > 0 && <div className='mt-3.5'>
      <p className='mb-2 text-xs text-muted-foreground'>{text.examplesTitle}</p>
      <ul className='space-y-1.5'>
        {issue.examples.map((example, index) => <li key={`${example.sheet ?? ''}:${String(example.row ?? '')}:${example.record ?? ''}:${index}`}
          className='grid gap-x-3 gap-y-0.5 rounded-lg border bg-muted/30 px-3 py-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]'>
          <span className='truncate font-mono text-xs text-sky-700 dark:text-sky-300' title={[example.source, example.sheet].filter(Boolean).join(' › ')}>{exampleWhere(example, translate)}</span>
          <span className='truncate text-sm' title={exampleWhat(example)}>{exampleWhat(example)}</span>
        </li>)}
      </ul>
    </div>}

    <div className='mt-4 flex flex-wrap items-center gap-3 border-t pt-3.5'>
      <div className='min-w-0 flex-1 basis-72'>
        {text.fix && <><p className='text-xs text-muted-foreground'>{translate('health.fix.label')}</p><p className='font-medium'>{text.fix}</p></>}
        {text.forecast && <p className='mt-0.5 text-xs text-emerald-700 dark:text-emerald-400'>{text.forecast}</p>}
      </div>
      {issue.secondary && text.secondary && (canEdit || reading(issue.secondary)) && <Button variant='outline' size='sm' onClick={() => issue.secondary && onAction(issue.secondary)}>{text.secondary}</Button>}
      {issue.fix && text.primary && (canEdit || reading(issue.fix)) && <Button size='sm' onClick={() => issue.fix && onAction(issue.fix)}>{text.primary}</Button>}
    </div>
  </article>;
}
