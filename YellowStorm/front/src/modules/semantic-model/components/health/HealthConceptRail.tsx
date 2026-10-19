import { useModuleTranslation } from '@/modules/localization';
import type { HealthConcept } from '../../types';
import { badgeOf, flowLine, STATUS_CLASSES, type Translate } from './healthModel';

/** The concepts, worst first: status, how much of what was read became records, and the line "rows → records". */
export function HealthConceptRail({ concepts, selectedId, onSelect }: Readonly<{
  concepts: HealthConcept[];
  selectedId: string | undefined;
  onSelect: (conceptId: string) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const translate = t as Translate;
  return <nav aria-label={translate('health.rail.aria')} className='flex flex-col gap-2'>
    <h2 className='px-1 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground'>{translate('health.rail.title')}</h2>
    {concepts.map((concept) => {
      const badge = badgeOf(concept);
      const classes = STATUS_CLASSES[badge];
      const selected = concept.conceptId === selectedId;
      return <button key={concept.conceptId} type='button' aria-pressed={selected} onClick={() => onSelect(concept.conceptId)}
        className={`w-full rounded-xl border p-3.5 text-start transition hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selected ? `bg-muted ${classes.ring}` : 'bg-card'}`}>
        <span className='flex items-center gap-2.5'>
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${classes.dot}`} aria-hidden />
          <span className='min-w-0 flex-1 truncate text-sm font-semibold'>{concept.label}</span>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${classes.badge}`}>{translate(`health.status.${badge}`)}</span>
        </span>
        <span className='mt-2.5 block h-1.5 overflow-hidden rounded-full bg-muted' aria-hidden>
          <span className={`block h-full rounded-full ${classes.bar}`} style={{ width: `${Math.max(1.5, (concept.keepRatio ?? 1) * 100)}%` }} />
        </span>
        <span className='mt-1.5 block truncate font-mono text-xs text-muted-foreground'>{flowLine(concept, translate)}</span>
      </button>;
    })}
  </nav>;
}
