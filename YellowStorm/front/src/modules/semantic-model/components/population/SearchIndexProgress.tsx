import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Search, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';

const BUILDING = new Set(['queued', 'indexing']);
/** The runtime's error code of a build that was stopped on request. */
export const INDEX_STOPPED_CODE = 'cancelled';

/**
 * After a run: the search index of the new data, built in the background (cards, then passages of
 * long fields such as a body or an attachment's text). Followed every few seconds while it builds.
 */
export function SearchIndexProgress({ modelId, dataRevisionId }: Readonly<{ modelId: string; dataRevisionId?: string | null }>) {
  const { t } = useModuleTranslation('semantic-model');
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: semanticModelQueryKeys.searchIndex(modelId, dataRevisionId),
    queryFn: () => semanticModelApi.searchIndexStatus(modelId),
    refetchInterval: (query) => {
      const data = query.state.data;
      // The run just saved: its index may not be asked for yet, or still be the previous data's.
      const stale = dataRevisionId && data?.dataRevisionId !== dataRevisionId;
      return !data || stale || BUILDING.has(data.index.state) || data.index.state === 'missing' ? 3000 : false;
    },
  });
  const data = status.data;
  if (!data || data.index.state === 'unavailable') return null;
  const index = data.index;
  const stale = Boolean(dataRevisionId && data.dataRevisionId !== dataRevisionId);
  const state = stale ? 'queued' : index.state;
  const records = { done: (index.indexedCount ?? 0) + (index.exactOnlyCount ?? 0), total: index.expectedCount ?? 0 };
  const passages = { done: index.passageIndexedCount ?? 0, total: index.passageCount ?? 0 };
  // First step: the records are read into search cards; the vectors (and the passages) come after.
  const reading = state === 'indexing' && index.stage === 'documents';
  const done = reading ? index.loadedCount ?? 0 : records.done + passages.done;
  const total = reading ? records.total : records.total + passages.total;
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const building = BUILDING.has(state) || state === 'missing';
  // A build stopped on request is not a failure; only an explicit request builds it again.
  const stopped = !stale && state === 'failed' && index.lastErrorCode === INDEX_STOPPED_CODE;
  const buildAgain = async () => {
    try {
      await semanticModelApi.ensureSearchIndex(modelId);
      await queryClient.invalidateQueries({ queryKey: ['semantic-model', modelId, 'search-index'] });
    } catch (error) {
      showError(t('population.progress.index.buildError'), { description: parseApiError(error).message });
    }
  };

  return <div className='space-y-1.5 rounded-lg border p-2.5' aria-label={t('population.progress.index.title')}>
    <p className='flex items-center gap-2 text-xs'>
      {building ? <Loader2 className='h-3.5 w-3.5 shrink-0 animate-spin text-primary' />
        : state === 'ready' ? <CheckCircle2 className='h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400' />
        : stopped ? <StopCircle className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
        : state === 'failed' ? <AlertTriangle className='h-3.5 w-3.5 shrink-0 text-destructive' />
        : <Search className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />}
      <span className='flex-1 font-medium'>{t('population.progress.index.title')}</span>
      <span className={cn('text-muted-foreground', state === 'failed' && !stopped && 'text-destructive')}>
        {stopped ? t('population.progress.index.stopped')
          : t(`population.progress.index.${(['queued', 'indexing', 'ready', 'failed', 'missing'].includes(state) ? state : 'missing') as 'queued' | 'indexing' | 'ready' | 'failed' | 'missing'}`)}
      </span>
      {state === 'indexing' && total > 0 && <span className='tabular-nums text-muted-foreground'>{t('population.progress.index.percent', { percent })}</span>}
    </p>
    {state === 'indexing' && total > 0 && <div className='h-1 overflow-hidden rounded-full bg-muted' role='progressbar'
      aria-label={t('population.progress.index.title')} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <div className='h-full rounded-full bg-primary/70 transition-[width] duration-500' style={{ width: `${percent}%` }} />
    </div>}
    {!stale && total > 0 && <p className='text-[11px] text-muted-foreground'>
      {reading
        ? t('population.progress.index.reading', { done: done.toLocaleString(), total: total.toLocaleString() })
        : passages.total > 0
          ? t('population.progress.index.counts', { records: records.done.toLocaleString(), recordsTotal: records.total.toLocaleString(),
            passages: passages.done.toLocaleString(), passagesTotal: passages.total.toLocaleString() })
          : t('population.progress.index.countsRecords', { records: records.done.toLocaleString(), recordsTotal: records.total.toLocaleString() })}
    </p>}
    {state === 'failed' && index.lastErrorCode && !stopped && <p className='text-[11px] text-destructive'>{index.lastErrorCode}</p>}
    {stopped && <>
      <p className='text-[11px] text-muted-foreground'>{t('population.progress.index.stoppedHint')}</p>
      <Button variant='outline' size='sm' className='w-full' onClick={() => void buildAgain()}>{t('population.progress.index.buildAgain')}</Button>
    </>}
  </div>;
}
