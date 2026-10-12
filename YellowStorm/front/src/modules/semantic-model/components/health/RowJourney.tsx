import { useModuleTranslation } from '@/modules/localization';
import type { HealthConcept } from '../../types';
import { badgeOf, formatNumber, STATUS_CLASSES, type Translate } from './healthModel';

/** The funnel of a concept's rows: in the source, read, read by the AI, made into records, and what was left behind and why. */
export function RowJourney({ concept }: Readonly<{ concept: HealthConcept }>) {
  const { t } = useModuleTranslation('semantic-model');
  const translate = t as Translate;
  const { journey } = concept;
  const records = journey.unit === 'records';
  const steps: Array<{ key: string; label: string; value: number }> = [];
  if (journey.rowsAvailable !== null) steps.push({ key: 'available', label: translate(records ? 'health.journey.availableRecords' : 'health.journey.available'), value: journey.rowsAvailable });
  if (journey.rowsRead !== null) steps.push({ key: 'read', label: translate(records ? 'health.journey.readRecords' : 'health.journey.read'), value: journey.rowsRead });
  if (journey.ai && journey.ai.read > 0) steps.push({ key: 'ai', label: translate('health.journey.aiRead'), value: journey.ai.read });
  steps.push({ key: 'made', label: translate('health.journey.made'), value: journey.recordsMade });
  const widest = Math.max(1, ...steps.map((step) => step.value));
  const final = STATUS_CLASSES[badgeOf(concept)].bar;
  return <section aria-label={translate('health.journey.title')}>
    <h2 className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>{translate('health.journey.title')}</h2>
    <ol className='mt-3 space-y-2'>
      {steps.map((step, index) => <li key={step.key} className='grid grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)_5.5rem] items-center gap-3'>
        <span className='text-sm text-muted-foreground'>{step.label}</span>
        <span className='h-5 overflow-hidden rounded-md bg-muted' aria-hidden>
          <span className={`block h-full rounded-md ${index === steps.length - 1 ? final : 'bg-muted-foreground/40'}`} style={{ width: `${Math.max(0.6, (step.value / widest) * 100)}%` }} />
        </span>
        <span className='text-right font-mono text-sm'>{formatNumber(step.value)}</span>
      </li>)}
    </ol>
    {journey.rowsRead === null && <p className='mt-3 text-sm text-muted-foreground'>{translate('health.journey.noCounts')}</p>}
    {journey.dropped.length > 0 && <ul className='mt-3 space-y-1 text-sm text-red-700 dark:text-red-300'>
      {journey.dropped.map((item) => <li key={`${item.reason}:${item.field ?? ''}`}>
        {translate(`health.journey.dropped.${item.reason}`, { rows: formatNumber(item.rows), field: concept.keyFields.find((key) => key.key === item.field)?.label ?? item.field?.replaceAll('_', ' ') ?? '' })}
      </li>)}
    </ul>}
  </section>;
}
