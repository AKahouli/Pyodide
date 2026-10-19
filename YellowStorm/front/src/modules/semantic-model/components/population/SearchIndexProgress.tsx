import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { AlertTriangle, CheckCircle2, Loader2, Search, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { useApiAction } from '@/lib/use-api-action';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import type { SearchIndexStatus } from '../../types';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { RuntimeFailureDetails } from './RuntimeFailureDetails';

const BUILDING = new Set(['queued', 'indexing']);
/** The steps of a build whose progress is the records handled so far (loadedCount) out of all of them. */
const COUNTED_STAGES = new Set(['comparing', 'carrying', 'documents']);
/** Why a build was full rather than incremental (the runtime's codes). */
const FULL_REASONS = ['no_previous_generation', 'previous_not_comparable', 'specification_changed', 'too_many_changes', 'empty_revision'] as const;
/** The runtime's error code of a build that was stopped on request. */
export const INDEX_STOPPED_CODE = 'cancelled';
/** The runtime's error code of a build whose worker vanished before it finished (it can be built again). */
export const INDEX_INTERRUPTED_CODE = 'index_interrupted';

/**
 * After a run: the search index of the new data, built in the background (cards, then passages of
 * long fields such as a body or an attachment's text). Followed every few seconds while it builds.
 */
export function SearchIndexProgress({ modelId, dataRevisionId }: Readonly<{ modelId: string; dataRevisionId?: string | null }>) {
  const { t, language } = useModuleTranslation('semantic-model');
  const queryClient = useQueryClient();
  const pending = useRef(false);
  const [lastFailure, setLastFailure] = useState<SearchIndexStatus | null>(null);
  const [retryConflict, setRetryConflict] = useState<{ modelId: string; revision: string | null; kind: 'revisionChanged' | 'identityChanged' } | null>(null);
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
  const buildAction = useApiAction(async (restart: boolean, snapshot: SearchIndexStatus) => {
    let result: SearchIndexStatus;
    try {
      result = await (restart ? semanticModelApi.restartSearchIndex(modelId)
      : semanticModelApi.ensureSearchIndex(modelId, snapshot.environment ?? 'draft', {
        ...(snapshot.dataRevisionId ? { expectedDataRevisionId: snapshot.dataRevisionId } : {}),
        ...(snapshot.index.state !== 'missing' && snapshot.index.indexId ? { expectedIndexId: snapshot.index.indexId } : {}),
      }));
    } catch (error) {
      // The public error code is shared by revision conflicts; its bounded runtime
      // reason distinguishes a changed binding from a changed profile/settings.
      const parsed = parseApiError(error);
      // The shared client unwraps error envelopes; keep the original Axios
      // envelope as a fallback for callers that have not normalized it yet.
      const reason: unknown = isAxiosError(error) ? error.response?.data?.error?.message : parsed.message;
      if (reason === 'active_binding_changed' || reason === 'index_identity_changed') {
        setRetryConflict({ modelId, revision: snapshot.dataRevisionId,
          kind: reason === 'active_binding_changed' ? 'revisionChanged' : 'identityChanged' });
      }
      throw error;
    }
    // Resume polling immediately, without waiting for a possibly slow status read.
    if (result.index) queryClient.setQueryData(semanticModelQueryKeys.searchIndex(modelId, dataRevisionId), result);
    await queryClient.invalidateQueries({ queryKey: ['semantic-model', modelId, 'search-index'] });
    return result;
  }, {
    showErrorToast: false,
    onError: (error) => showError(t('searchIndexRetry.error'), { description: error.message }),
  });
  const data = status.data;
  const refreshStatus = async () => {
    const result = await status.refetch();
    if (result.isSuccess) setRetryConflict(null);
  };
  const refreshButton = <Button variant='outline' size='sm' disabled={status.isFetching}
    onClick={() => void refreshStatus()}>{t('searchIndexRetry.refresh')}</Button>;
  if (!data) return <div className='space-y-1.5 rounded-lg border p-2.5' aria-label={t('population.progress.index.title')}>
    <p role={status.isPending ? 'status' : 'alert'} className='text-xs text-muted-foreground'>
      {t(status.isPending ? 'searchIndexRetry.loading' : 'searchIndexRetry.unavailable')}
    </p>
    {!status.isPending && refreshButton}
  </div>;
  const index = data.index;
  const unavailable = status.isError || index.state === 'unavailable';
  const stale = Boolean(dataRevisionId && data.dataRevisionId !== dataRevisionId);
  const state = stale ? 'queued' : index.state;
  const conflict = retryConflict?.modelId === modelId && retryConflict.revision === data.dataRevisionId ? retryConflict : null;
  const records = { done: (index.indexedCount ?? 0) + (index.exactOnlyCount ?? 0), total: index.expectedCount ?? 0 };
  const passages = { done: index.passageIndexedCount ?? 0, total: index.passageCount ?? 0 };
  // First steps: the records are compared with the previous index and carried over, or read into search
  // cards; the vectors (and the passages) come after.
  const reading = state === 'indexing' && COUNTED_STAGES.has(index.stage ?? '');
  const readingKey = index.stage === 'carrying' ? 'carrying' : index.stage === 'comparing' ? 'comparing' : 'reading';
  const done = reading ? index.loadedCount ?? 0 : records.done + passages.done;
  const total = reading ? records.total : records.total + passages.total;
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  // Steps without a measurable end: all records read but the next step not begun, and the reuse of earlier
  // vectors (its own count never reaches the total). A bar sitting at 100% would pass for a stuck build.
  const reusing = state === 'indexing' && index.stage === 'reusing';
  const readDone = reading && total > 0 && done >= total;
  const unmeasured = reusing || readDone;
  const building = BUILDING.has(state);
  // A build stopped on request is not a failure; only an explicit request builds it again.
  const stopped = !stale && state === 'failed' && index.lastErrorCode === INDEX_STOPPED_CODE;
  // A build whose worker vanished is a failure the administrator can retry.
  const interrupted = !stale && state === 'failed' && index.lastErrorCode === INDEX_INTERRUPTED_CODE;
  const failed = !stale && state === 'failed' && !stopped && !interrupted;
  const retained = !stale && BUILDING.has(state) && lastFailure?.modelId === modelId
    && lastFailure.dataRevisionId === data.dataRevisionId && lastFailure.index.indexId === index.indexId ? lastFailure.index : null;
  // Its worker stopped answering: what was embedded is kept, and the build can be restarted.
  const stalled = !stale && state === 'indexing' && Boolean(index.stalled);
  const stalledAt = index.lastProgressAt ? new Date(index.lastProgressAt) : null;
  // How the build runs: what an incremental one carried over, rebuilt and embedded; why a full one was full.
  const buildPath = stale || !(state === 'indexing' || state === 'ready') ? null : index.buildMode ?? null;
  const fullReason = FULL_REASONS.find((reason) => reason === index.buildReason);
  const buildAgain = async (restart = false) => {
    if (pending.current || unavailable || stale) return;
    pending.current = true;
    if (state === 'failed' && !stopped) setLastFailure(data);
    try {
      await buildAction.execute(restart, data);
    } finally {
      pending.current = false;
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
      {index.state !== 'unavailable' && <span className={cn('text-muted-foreground', state === 'failed' && !stopped && 'text-destructive')}>
        {stopped ? t('population.progress.index.stopped')
          : interrupted ? t('population.progress.index.interrupted')
          : reusing ? t('population.progress.index.reusing')
          : readDone ? t('population.progress.index.preparing')
          : t(`population.progress.index.${(['queued', 'indexing', 'ready', 'failed', 'missing'].includes(state) ? state : 'missing') as 'queued' | 'indexing' | 'ready' | 'failed' | 'missing'}`)}
      </span>}
      {state === 'indexing' && total > 0 && !unmeasured && <span className='tabular-nums text-muted-foreground'>{t('population.progress.index.percent', { percent })}</span>}
    </p>
    {unavailable && <div className='space-y-1.5'>
      <p role='alert' className='text-xs text-muted-foreground'>{t('searchIndexRetry.unavailable')}</p>
      {!conflict && refreshButton}
    </div>}
    {index.state === 'missing' && !data.dataRevisionId && <p className='text-[11px] text-muted-foreground'>{t('searchIndexRetry.noData')}</p>}
    {!stale && state === 'missing' && data.dataRevisionId && <>
      <p className='text-[11px] text-muted-foreground'>{t('searchIndexRetry.missingHint')}</p>
      <Button variant='outline' size='sm' className='w-full' disabled={buildAction.isLoading || unavailable || Boolean(conflict)}
        onClick={() => void buildAgain()}>{t(buildAction.isLoading ? 'searchIndexRetry.pending' : 'searchIndexRetry.buildMissing')}</Button>
    </>}
    {state === 'indexing' && total > 0 && !unmeasured && <div className='h-1 overflow-hidden rounded-full bg-muted' role='progressbar'
      aria-label={t('population.progress.index.title')} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <div className='h-full rounded-full bg-primary/70 transition-[width] duration-500' style={{ width: `${percent}%` }} />
    </div>}
    {!stale && total > 0 && !readDone && <p className='text-[11px] text-muted-foreground'>
      {reading
        ? t(`population.progress.index.${readingKey}`, { done: done.toLocaleString(), total: total.toLocaleString() })
        : passages.total > 0
          ? t('population.progress.index.counts', { records: records.done.toLocaleString(), recordsTotal: records.total.toLocaleString(),
            passages: passages.done.toLocaleString(), passagesTotal: passages.total.toLocaleString() })
          : t('population.progress.index.countsRecords', { records: records.done.toLocaleString(), recordsTotal: records.total.toLocaleString() })}
    </p>}
    {buildPath === 'incremental' && <p className='text-[11px] text-muted-foreground'>
      {t('population.progress.index.incremental', {
        carried: (index.carriedCount ?? 0).toLocaleString(), rebuilt: (index.rebuiltCount ?? 0).toLocaleString(), embedded: (index.embeddedCount ?? 0).toLocaleString(),
      })}
    </p>}
    {buildPath === 'full' && index.buildReason && <p className='text-[11px] text-muted-foreground'>
      {t('population.progress.index.full', { reason: fullReason ? t(`population.progress.index.fullReason.${fullReason}`) : index.buildReason })}
    </p>}
    {stalled && <>
      <p className='flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400' role='alert'>
        <AlertTriangle className='mt-px h-3.5 w-3.5 shrink-0' />
        <span>{stalledAt && !Number.isNaN(stalledAt.getTime())
          ? t('population.progress.index.stalled', { time: new Intl.DateTimeFormat(language, { timeStyle: 'short' }).format(stalledAt) })
          : t('population.progress.index.stalledUnknown')}</span>
      </p>
      <Button variant='outline' size='sm' className='w-full' disabled={buildAction.isLoading || unavailable} onClick={() => void buildAgain(true)}>{t('population.progress.index.restart')}</Button>
    </>}
    {state === 'failed' && !stopped && (!interrupted || index.errorDetails) && <RuntimeFailureDetails details={index.errorDetails} code={index.lastErrorCode} />}
    {retained && <><p className='text-[11px] font-medium text-muted-foreground'>{t('searchIndexRetry.previousFailure')}</p>
      <RuntimeFailureDetails details={index.errorDetails ?? retained.errorDetails} code={index.lastErrorCode ?? retained.lastErrorCode} /></>}
    {conflict && <div className='space-y-1.5'>
      <p role='alert' className='text-[11px] text-destructive'>{t(`searchIndexRetry.${conflict.kind}`)}</p>
      {refreshButton}
    </div>}
    {failed && <><p className='text-[11px] text-muted-foreground'>{t('searchIndexRetry.hint')}</p>
      <Button variant='outline' size='sm' className='w-full' disabled={buildAction.isLoading || unavailable || Boolean(conflict) || !data.dataRevisionId || !index.indexId}
        onClick={() => void buildAgain()}>{t(buildAction.isLoading ? 'searchIndexRetry.pending' : 'searchIndexRetry.action')}</Button></>}
    {(stopped || interrupted) && <>
      <p className='text-[11px] text-muted-foreground'>{t(stopped ? 'population.progress.index.stoppedHint' : 'population.progress.index.interruptedHint')}</p>
      <Button variant='outline' size='sm' className='w-full' disabled={buildAction.isLoading || unavailable || Boolean(conflict)} onClick={() => void buildAgain()}>{t('population.progress.index.buildAgain')}</Button>
    </>}
  </div>;
}
