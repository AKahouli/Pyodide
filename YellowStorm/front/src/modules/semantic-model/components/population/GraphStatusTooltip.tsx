import { useState } from 'react';
import { Check, Copy, Network } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { useModuleTranslation } from '@/modules/localization';
import { useGraphStatus } from '../../query/hooks';
import type { ServedGraph } from '../../types';

function CopyValue({ value }: Readonly<{ value: string }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <span className='flex min-w-0 items-center gap-1'>
      <code className='truncate rounded bg-muted px-1 py-0.5 text-[11px]' title={value}>{value}</code>
      <button type='button' className='shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground' onClick={copy} aria-label={t('graphStatus.copy')}>
        {copied ? <Check className='h-3 w-3' /> : <Copy className='h-3 w-3' />}
      </button>
    </span>
  );
}

const INDEX_STATES = ['building', 'queued', 'failed', 'missing', 'unavailable'] as const;
type IndexState = typeof INDEX_STATES[number] | 'unknown';
const indexState = (state: string): IndexState => (INDEX_STATES as readonly string[]).includes(state) ? state as IndexState : 'unknown';

const STATE_DOT: Record<ServedGraph['state'], string> = { ok: 'bg-emerald-500', mismatch: 'bg-amber-500', missing: 'bg-destructive' };

function Environment({ served }: Readonly<{ served: ServedGraph }>) {
  const { t } = useModuleTranslation('semantic-model');
  const number = (value: number) => value.toLocaleString();
  const index = served.index;
  const indexText = index.state === 'ready'
    ? t('graphStatus.indexReady', { indexed: number(index.indexedCount ?? 0), expected: number(index.expectedCount ?? 0) })
    : t(`graphStatus.indexState.${indexState(index.state)}`);
  return (
    <section className='space-y-1.5'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-xs font-semibold'>{t(`graphStatus.environment.${served.environment}`)}</span>
        <span className='flex items-center gap-1.5 text-xs'>
          <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[served.state]}`} aria-hidden />
          {t(`graphStatus.state.${served.state}`)}
        </span>
      </div>
      <dl className='grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-xs'>
        <dt className='text-muted-foreground'>{t('graphStatus.schema')}</dt>
        <dd>{served.graphSchema ? <CopyValue value={served.graphSchema} /> : '—'}</dd>
        <dt className='text-muted-foreground'>{t('graphStatus.revision')}</dt>
        <dd><CopyValue value={served.dataRevisionId} /></dd>
        <dt className='text-muted-foreground'>{t('graphStatus.layout')}</dt>
        <dd className={served.layout === 'entity' ? 'text-amber-700 dark:text-amber-400' : undefined}>{t(`graphStatus.layouts.${served.layout}`)}</dd>
        {served.builtAt && <>
          <dt className='text-muted-foreground'>{t('graphStatus.built')}</dt>
          <dd>{new Date(served.builtAt).toLocaleString()}</dd>
        </>}
        <dt className='text-muted-foreground'>{t('graphStatus.contents')}</dt>
        <dd>
          {served.graph
            ? t('graphStatus.counts', { records: number(served.graph.vertices), links: number(served.graph.edges), concepts: served.graph.conceptLabels, relations: served.graph.relationLabels })
            : '—'}
          {served.state === 'mismatch' && <span className='block text-amber-700 dark:text-amber-400'>
            {t('graphStatus.storedCounts', { records: number(served.stored.records), links: number(served.stored.links) })}
          </span>}
        </dd>
        <dt className='text-muted-foreground'>{t('graphStatus.index')}</dt>
        <dd>{indexText}</dd>
      </dl>
      {(served.state !== 'ok' || served.layout === 'entity') && <p className='text-[11px] text-muted-foreground'>{t('graphStatus.rebuildHint')}</p>}
    </section>
  );
}

/** Which graph the draft and the published data use (schema, revision, layout), and whether it holds all the data. */
export function GraphStatusTooltip({ modelId }: Readonly<{ modelId: string }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [open, setOpen] = useState(false);
  const status = useGraphStatus(modelId, open);
  const environments = [...(status.data?.environments ?? [])].sort((a, b) => Number(b.environment === 'production') - Number(a.environment === 'production'));
  return (
    <HoverCard openDelay={150} closeDelay={150} open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        <button type='button' className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground' aria-label={t('graphStatus.title')}
          onClick={() => setOpen((current) => !current)}>
          <Network className='h-3.5 w-3.5' />
        </button>
      </HoverCardTrigger>
      <HoverCardContent align='end' className='w-96 space-y-3'>
        <p className='text-sm font-semibold'>{t('graphStatus.title')}</p>
        {status.isLoading && <p className='text-xs text-muted-foreground'>{t('graphStatus.loading')}</p>}
        {status.isError && <p className='text-xs text-destructive'>{t('graphStatus.error')}</p>}
        {status.data && !environments.length && <p className='text-xs text-muted-foreground'>{t('graphStatus.none')}</p>}
        {environments.map((served) => <Environment key={served.environment} served={served} />)}
      </HoverCardContent>
    </HoverCard>
  );
}
