import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Database, Loader2, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useModelHealth } from '../../query/hooks';
import type { HealthAction, HealthCause, HealthConcept, ModelHealth } from '../../types';
import { HealthConceptRail } from './HealthConceptRail';
import { HealthIssueCard } from './HealthIssueCard';
import { CAUSES, badgeOf, formatNumber, flowLine, readable, STATUS_CLASSES, type Translate } from './healthModel';
import { RowJourney } from './RowJourney';

export type TrustCenterSection = 'overview' | 'records' | 'sources';

/**
 * Model health: what the last run did to each concept's rows and what to change. A verdict for the run,
 * the concepts worst first, and for the one picked its row journey and one card per problem.
 * `setup` is shown below: what blocks the next run before any row is read.
 */
export function ModelHealthView({ modelId, canEdit, onAction, setup, section, onSectionChange, records, sources }: Readonly<{
  modelId: string;
  canEdit: boolean;
  /** Opens where an action is done; "go to concept" is handled here, by picking that concept. */
  onAction: (action: HealthAction) => void;
  setup: ReactNode;
  section?: TrustCenterSection;
  onSectionChange?: (section: TrustCenterSection) => void;
  records?: ReactNode;
  sources?: ReactNode;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const translate = t as Translate;
  const health = useModelHealth(modelId);
  const [pickedId, setPickedId] = useState<string>();
  const [cause, setCause] = useState<HealthCause | 'all'>('all');
  const [localSection, setLocalSection] = useState<TrustCenterSection>('overview');
  const activeSection = section ?? localSection;
  const selectSection = onSectionChange ?? setLocalSection;
  const data = health.data;
  const concepts = useMemo(() => data?.concepts ?? [], [data?.concepts]);
  const selected = concepts.find((concept) => concept.conceptId === pickedId)
    ?? concepts.find((concept) => concept.conceptId === data?.verdict?.conceptId) ?? concepts[0];
  // A new run explains new things: start again from its worst concept.
  useEffect(() => { setPickedId(undefined); setCause('all'); }, [data?.dataRevisionId]);

  const pick = (conceptId: string) => { setPickedId(conceptId); setCause('all'); };
  const act = (action: HealthAction) => (action.kind === 'go_to_concept' ? pick(action.conceptId) : onAction(action));

  const overview = health.isLoading
    ? <div className='flex h-full min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground'><Loader2 className='h-5 w-5 animate-spin' />{translate('health.loading')}</div>
    : health.isError || !data
      ? <div className='flex h-full min-h-64 items-center justify-center p-6'><div className='max-w-md rounded-2xl border bg-background p-6 text-center'>
        <p className='text-sm text-muted-foreground'>{translate('health.unavailable')}</p>
        <Button className='mt-4' onClick={() => void health.refetch()}>{translate('health.retry')}</Button>
      </div></div>
      : <div className='space-y-5'>
        {data.state === 'no_data'
          ? <div className='mx-auto max-w-md rounded-2xl border bg-background p-6 text-center'>
            <Database className='mx-auto h-6 w-6 text-muted-foreground' />
            <h2 className='mt-3 font-semibold'>{translate('health.noData.title')}</h2>
            <p className='mt-1 text-sm text-muted-foreground'>{translate('health.noData.hint')}</p>
          </div>
          : <>
            <Verdict data={data} translate={translate} />
            <div className='flex flex-col gap-5 lg:flex-row lg:items-start'>
              <aside className='w-full shrink-0 lg:w-80'>
                <HealthConceptRail concepts={concepts} selectedId={selected?.conceptId} onSelect={pick} />
              </aside>
              <main className='min-w-0 flex-1 space-y-4'>
                {selected && <ConceptDetail concept={selected} concepts={concepts} cause={cause} onCause={setCause} canEdit={canEdit} onAction={act} />}
              </main>
            </div>
          </>}
        <section aria-label={translate('health.setup.title')} className='rounded-2xl border bg-background p-5'>
          <h2 className='text-lg font-semibold'>{translate('health.setup.title')}</h2>
          <p className='mb-4 text-sm text-muted-foreground'>{translate('health.setup.description')}</p>
          {setup}
        </section>
      </div>;
  const sectionContent = activeSection === 'records' ? records : activeSection === 'sources' ? sources : overview;
  const tabs: Array<{ id: TrustCenterSection; key: string }> = [
    { id: 'overview', key: 'trustCenter.overview' },
    { id: 'records', key: 'trustCenter.records' },
    { id: 'sources', key: 'trustCenter.sourcesLineage' },
  ];
  return <div className='h-full overflow-y-auto bg-muted/20 p-4 sm:p-6'>
    <div className='mx-auto max-w-7xl space-y-5'>
      <nav role='tablist' aria-label={translate('trustCenter.sections')} className='flex flex-wrap gap-1 rounded-xl border bg-background p-1'>
        {tabs.map((tab) => <button key={tab.id} type='button' role='tab' aria-selected={activeSection === tab.id} onClick={() => selectSection(tab.id)}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${activeSection === tab.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
          {translate(tab.key)}
        </button>)}
      </nav>
      <div role='tabpanel' className='min-h-0'>{sectionContent}</div>
    </div>
  </div>;
}

/** The run in one sentence, how many concepts are healthy, and the four figures behind it. */
function Verdict({ data, translate }: Readonly<{ data: ModelHealth; translate: Translate }>) {
  const { summary, verdict } = data;
  const total = Math.max(1, summary.concepts);
  const blocked = data.concepts.filter((concept) => concept.status === 'blocked').length;
  const healthy = summary.healthy;
  const between = summary.concepts - blocked - healthy;
  const radius = 36;
  const length = 2 * Math.PI * radius;
  const arc = (count: number, offset: number, stroke: string) => count > 0
    ? <circle cx='44' cy='44' r={radius} fill='none' strokeWidth='9' className={stroke} strokeDasharray={`${(count / total) * length} ${length}`} strokeDashoffset={-offset} transform='rotate(-90 44 44)' /> : null;
  const tile = (value: number, label: string, tone?: string) => <div className={`rounded-2xl border p-3.5 ${tone ?? 'bg-card'}`}>
    <div className='text-2xl font-bold'>{formatNumber(value)}</div>
    <div className='text-xs text-muted-foreground'>{label}</div>
  </div>;
  return <section aria-label={translate('health.verdict.heading')} className='flex flex-col gap-4 lg:flex-row'>
    <div className='flex flex-1 items-center gap-5 rounded-2xl border bg-card p-5 lg:flex-[2]'>
      <div className='relative h-[88px] w-[88px] shrink-0' role='img' aria-label={translate('health.ring.aria', { healthy, total: summary.concepts })}>
        <svg viewBox='0 0 88 88' className='h-full w-full'>
          <circle cx='44' cy='44' r={radius} fill='none' strokeWidth='9' className='stroke-muted' />
          {arc(blocked, 0, 'stroke-destructive')}
          {arc(between, (blocked / total) * length, 'stroke-amber-500')}
          {arc(healthy, ((blocked + between) / total) * length, 'stroke-emerald-500')}
        </svg>
        <div className='absolute inset-0 flex flex-col items-center justify-center'><span className='text-xl font-bold'>{healthy}/{summary.concepts}</span><span className='text-[10px] text-muted-foreground'>{translate('health.ring.label')}</span></div>
      </div>
      <div className='min-w-0'>
        <p className='text-xs font-medium uppercase tracking-wider text-muted-foreground'>{translate('health.verdict.heading')}</p>
        <h2 className='mt-1 text-xl font-semibold leading-snug'>{verdict ? translate(`health.verdict.${verdict.kind}.title`, readable(verdict.params)) : translate('health.verdict.clean.title')}</h2>
        <p className='mt-1.5 text-sm text-muted-foreground'>{verdict ? translate(`health.verdict.${verdict.kind}.body`, readable(verdict.params)) : translate('health.verdict.clean.body')}</p>
      </div>
    </div>
    <div className='grid flex-1 grid-cols-2 gap-3'>
      {tile(summary.rowsRead, translate('health.stats.rowsRead'))}
      {tile(summary.recordsKept, translate('health.stats.records'))}
      {tile(summary.fixesNeeded, translate('health.stats.fixes'), summary.fixesNeeded > 0 ? 'border-destructive/40 bg-destructive/5' : undefined)}
      {tile(summary.limits, translate('health.stats.limits'))}
    </div>
  </section>;
}

function ConceptDetail({ concept, concepts, cause, onCause, canEdit, onAction }: Readonly<{
  concept: HealthConcept;
  concepts: HealthConcept[];
  cause: HealthCause | 'all';
  onCause: (cause: HealthCause | 'all') => void;
  canEdit: boolean;
  onAction: (action: HealthAction) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const translate = t as Translate;
  const badge = badgeOf(concept);
  const issues = concept.issues.filter((issue) => cause === 'all' || issue.cause === cause);
  const origin = concept.origin.kind === 'derived'
    ? translate('health.origin.derived', { concept: concepts.find((item) => item.conceptId === concept.origin.fromConceptId)?.label ?? '' })
    : concept.origin.kind === 'manual' ? translate('health.origin.manual')
      : concept.origin.sources.length ? translate('health.origin.from', { sources: concept.origin.sources.join(', ') }) : translate('health.origin.fromDocuments');
  const key = concept.keyFields.length ? ` · ${translate('health.origin.key', { fields: concept.keyFields.map((field) => field.label).join(' + ') })}` : '';
  return <>
    <section className='rounded-2xl border bg-card p-5'>
      <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
        <h1 className='text-xl font-semibold'>{concept.label}</h1>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASSES[badge].badge}`}>{translate(`health.status.${badge}`)}</span>
        <span className='min-w-0 truncate text-sm text-muted-foreground' title={origin + key}>{origin}{key}</span>
        <Button variant='ghost' size='sm' className='ml-auto' onClick={() => onAction({ kind: 'view_records', conceptId: concept.conceptId })}>
          <Table2 className='mr-1.5 h-4 w-4' />{translate('health.seeData')}
        </Button>
      </div>
      <div className='mt-4'><RowJourney concept={concept} /></div>
      <p className='sr-only'>{flowLine(concept, translate)}</p>
    </section>
    {concept.issues.length > 0 && <div role='group' aria-label={translate('health.filter.label')} className='flex flex-wrap gap-2'>
      {(['all', ...CAUSES.filter((item) => concept.issues.some((issue) => issue.cause === item))] as const).map((item) => {
        const count = item === 'all' ? concept.issues.length : concept.issues.filter((issue) => issue.cause === item).length;
        return <button key={item} type='button' aria-pressed={cause === item} onClick={() => onCause(item)}
          className={`rounded-full border px-3 py-1.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${cause === item ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted'}`}>
          {translate(item === 'all' ? 'health.filter.all' : `health.cause.${item}`)} <span className='font-mono text-xs opacity-70'>{count}</span>
        </button>;
      })}
    </div>}
    {concept.issues.length === 0 && <p className='rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-sm text-emerald-800 dark:text-emerald-300'>{translate('health.empty')}</p>}
    {issues.map((issue) => <HealthIssueCard key={issue.id} issue={issue} concepts={concepts} canEdit={canEdit} onAction={onAction} />)}
  </>;
}
