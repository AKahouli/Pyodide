import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, CircleSlash, Hourglass, ListOrdered, Loader2, StopCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useApiAction } from '@/lib/use-api-action';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import type { MyJobsQuery, MySemanticJob } from '../../types';
import { runCanStop } from './PopulationStartedPanel';
import { errorText } from './RunHistoryPanel';
import { RuntimeFailureDetails } from './RuntimeFailureDetails';

const JOBS_KEY = ['semantic-models', 'my-jobs'] as const;
const ACTIVE = new Set(['queued', 'waiting_dependencies', 'running', 'cancel_requested']);
const QUEUED = new Set(['queued', 'waiting_dependencies']);

function useMyJobs(query: MyJobsQuery, monitoring = true) {
  return useQuery({
    queryKey: [...JOBS_KEY, query], queryFn: () => semanticModelApi.myJobs(query),
    refetchInterval: (state) => monitoring && state.state.data?.activeCount ? 3000 : 15000,
    staleTime: 3000, retry: false,
  });
}

/** Shared entry point: catalog defaults to all models; model/run surfaces start with that model. */
export function MyJobsButton({ modelId, queueLabel = false }: Readonly<{ modelId?: string; queueLabel?: boolean }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [open, setOpen] = useState(false);
  const summary = useMyJobs({ modelId, view: 'active', page: 1, limit: 20 }, false);
  return <>
    <Button variant='outline' size='sm' onClick={() => setOpen(true)} aria-haspopup='dialog'>
      <ListOrdered aria-hidden className='me-1.5 h-4 w-4' />{t(queueLabel ? 'myJobs.viewQueue' : 'myJobs.title')}
      {Boolean(summary.data?.activeCount) && <Badge variant='secondary' className='ms-2 tabular-nums'>{summary.data?.activeCount}</Badge>}
    </Button>
    {open && <MyJobsDrawer initialModelId={modelId} onClose={() => setOpen(false)} />}
  </>;
}

export function MyJobsDrawer({ initialModelId, onClose }: Readonly<{ initialModelId?: string; onClose: () => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const [modelId, setModelId] = useState(initialModelId ?? 'all');
  const [view, setView] = useState<'active' | 'history'>('active');
  const [page, setPage] = useState(1);
  const [bulk, setBulk] = useState<{ modelId?: string; label: string; count: number } | null>(null);
  const [stop, setStop] = useState<MySemanticJob | null>(null);
  const query = useMyJobs({ modelId: modelId === 'all' ? undefined : modelId, view, page, limit: 20 });
  const refresh = () => {
    setPage(1);
    void client.invalidateQueries({ queryKey: JOBS_KEY });
    void client.invalidateQueries({ queryKey: ['semantic-models', 'population-jobs'] });
    void client.invalidateQueries({ queryKey: ['semantic-models', 'population-job'] });
    void client.invalidateQueries({ queryKey: ['semantic-models', 'population-active'] });
  };
  const remove = useApiAction(semanticModelApi.removeMyQueuedJobs, {
    showSuccessToast: true,
    successMessage: (result) => t('myJobs.removed', { count: result.cancelled, skipped: result.skipped }),
    onSuccess: () => { setBulk(null); refresh(); },
  });
  const cancel = useApiAction(semanticModelApi.stopMyJob, {
    onSuccess: () => { setStop(null); refresh(); },
  });
  const busy = remove.isLoading || cancel.isLoading;
  const models = query.data?.models ?? [];
  const editable = models.some((model) => model.canManage && (modelId === 'all' || model.id === modelId));
  const queuedCount = query.data?.queuedCount ?? 0;
  const totalPages = query.data?.pagination.totalPages ?? 0;

  return <>
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className='flex w-full flex-col gap-0 p-0 sm:max-w-xl'>
        <SheetHeader className='border-b px-5 py-4 text-start'>
          <SheetTitle>{t('myJobs.title')}</SheetTitle>
          <SheetDescription>{t('myJobs.hint')}</SheetDescription>
        </SheetHeader>
        <div className='space-y-3 border-b px-5 py-4'>
          <label className='block space-y-1.5 text-xs text-muted-foreground'>
            <span>{t('myJobs.modelFilter')}</span>
            <select value={modelId} onChange={(event) => { setModelId(event.target.value); setPage(1); }}
              className='h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'>
              <option value='all'>{t('myJobs.allModels')}</option>
              {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <Tabs value={view} onValueChange={(value) => { setView(value as 'active' | 'history'); setPage(1); }}>
              <TabsList aria-label={t('myJobs.views')}><TabsTrigger value='active'>{t('myJobs.active')}
                {query.data && <span className='ms-1.5 tabular-nums'>{query.data.activeCount}</span>}
              </TabsTrigger><TabsTrigger value='history'>{t('myJobs.history')}</TabsTrigger></TabsList>
            </Tabs>
            {view === 'active' && queuedCount > 0 && editable && <Button variant='outline' size='sm' disabled={busy || query.isError}
              onClick={() => setBulk({ modelId: modelId === 'all' ? undefined : modelId,
                label: models.find((model) => model.id === modelId)?.name ?? t('myJobs.allModels'), count: queuedCount })}>
              <Trash2 aria-hidden className='me-1.5 h-4 w-4' />{t('myJobs.removeAll')}
            </Button>}
          </div>
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto px-5 pb-8'>
          {query.isLoading ? <p role='status' className='flex items-center gap-2 py-6 text-sm text-muted-foreground'><Loader2 aria-hidden className='h-4 w-4 animate-spin' />{t('myJobs.loading')}</p>
            : query.isError ? <div role='alert' className='space-y-3 py-6 text-sm'><p className='text-destructive'>{t('myJobs.unavailable')}</p><Button variant='outline' size='sm' onClick={() => void query.refetch()}>{t('action.retry')}</Button></div>
              : !query.data?.items.length ? <div className='py-10 text-center'><ListOrdered aria-hidden className='mx-auto mb-3 h-6 w-6 text-muted-foreground' /><p className='text-sm font-medium'>{t(view === 'active' ? 'myJobs.emptyActive' : 'myJobs.emptyHistory')}</p><p className='mt-2 text-xs text-muted-foreground'>{t('myJobs.emptyHint')}</p></div>
                : <ul className='divide-y'>{query.data.items.map((job) => <MyJobRow key={job.jobId} job={job} busy={busy}
                  onOpenModel={onClose} onRemove={() => void cancel.execute(job.jobId, true)} onStop={() => setStop(job)} />)}</ul>}
        </div>
        {totalPages > 1 && <footer className='flex items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground'>
          <span>{t('myJobs.page', { page, total: totalPages })}</span>
          <div className='flex gap-1'><Button variant='outline' size='icon' disabled={page <= 1 || busy} onClick={() => setPage(page - 1)} aria-label={t('myJobs.previous')}><ChevronLeft className='h-4 w-4' /></Button>
            <Button variant='outline' size='icon' disabled={page >= totalPages || busy} onClick={() => setPage(page + 1)} aria-label={t('myJobs.next')}><ChevronRight className='h-4 w-4' /></Button></div>
        </footer>}
      </SheetContent>
    </Sheet>
    <AlertDialog open={Boolean(bulk)} onOpenChange={(open) => { if (!open && !remove.isLoading) setBulk(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('myJobs.bulkTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('myJobs.bulkHint', { count: bulk?.count ?? 0, model: bulk?.label ?? '' })}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={remove.isLoading}>{t('myJobs.keepQueued')}</AlertDialogCancel>
          <AlertDialogAction disabled={remove.isLoading} onClick={(event) => { event.preventDefault(); void remove.execute(bulk?.modelId); }}>{remove.isLoading ? t('myJobs.removing') : t('myJobs.confirmRemoveAll')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={Boolean(stop)} onOpenChange={(open) => { if (!open && !cancel.isLoading) setStop(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('runStop.confirmTitle')}</AlertDialogTitle><AlertDialogDescription>{t('myJobs.stopHint')}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={cancel.isLoading}>{t('runStop.keepGoing')}</AlertDialogCancel><AlertDialogAction disabled={cancel.isLoading}
          onClick={(event) => { event.preventDefault(); if (stop) void cancel.execute(stop.jobId, false); }}>{t('runStop.confirmAction')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

function MyJobRow({ job, busy, onRemove, onStop, onOpenModel }: Readonly<{
  job: MySemanticJob; busy: boolean; onRemove: () => void; onStop: () => void; onOpenModel: () => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const queued = QUEUED.has(job.state);
  const active = ACTIVE.has(job.state);
  const saving = active && !queued && job.state !== 'cancel_requested' && !runCanStop(job.progress);
  const translate = t as (key: string, options?: Record<string, unknown>) => string;
  const status = saving ? t('myJobs.saving') : job.state === 'cancelled' && !job.startedAt ? t('myJobs.cancelledQueued')
    : translate(`runHistory.state.${job.state}`, { defaultValue: job.state });
  const operation = job.jobType === 'datasource.discovery' ? t('myJobs.discovery')
    : job.jobType.startsWith('graph_search.') ? t('myJobs.searchIndex')
      : job.purpose === 'build' ? t('runHistory.purpose.build') : t('runHistory.purpose.refresh');
  const when = queued ? job.createdAt : job.startedAt ?? job.createdAt;
  const elapsed = when ? Math.max(0, Math.floor(((job.completedAt ? Date.parse(job.completedAt) : Date.now()) - Date.parse(when)) / 60000)) : 0;
  return <li className='space-y-2 py-4'>
    <div className='flex items-start gap-3'>
      {queued ? <Hourglass aria-hidden className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />
        : active ? <Loader2 aria-hidden className='mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary' />
          : job.state === 'failed' ? <AlertCircle aria-hidden className='mt-0.5 h-4 w-4 shrink-0 text-destructive' />
            : job.state === 'completed' || job.state === 'completed_with_gaps' ? <CheckCircle2 aria-hidden className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />
              : <CircleSlash aria-hidden className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />}
      <div className='min-w-0 flex-1'>
        <Link to={`/semantic-models/${job.modelId}`} onClick={onOpenModel} className='break-words text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'>{job.modelName}</Link>
        <p className='mt-0.5 break-words text-xs text-muted-foreground'>{job.conceptLabel ?? t('myJobs.wholeModel')} · {operation}</p>
        <p role='status' className='mt-2 text-xs font-medium'>{status}</p>
        <p className='mt-1 text-xs tabular-nums text-muted-foreground'>{t(queued ? 'myJobs.waitingMinutes' : 'myJobs.elapsedMinutes', { count: elapsed })}</p>
        {queued && <p className='mt-1 text-xs text-muted-foreground'>{t(job.state === 'waiting_dependencies' ? 'myJobs.waitingDependencies' : 'myJobs.waitingWorker')}</p>}
        {saving && <p className='mt-1 text-xs text-muted-foreground'>{t('myJobs.savingHint')}</p>}
        {job.state === 'failed' && <div className='mt-2 space-y-2'>
          <p className='break-words text-xs text-destructive'>{errorText(job.errorCode, t as Parameters<typeof errorText>[1])}</p>
          <RuntimeFailureDetails details={job.errorDetails} code={job.errorCode} jobId={job.jobId} />
        </div>}
      </div>
      {job.canManage && active && job.state !== 'cancel_requested' && <Button variant='outline' size='sm' className='shrink-0' disabled={busy || saving} onClick={queued ? onRemove : onStop}>
        {queued ? <Trash2 aria-hidden className='me-1.5 h-4 w-4' /> : <StopCircle aria-hidden className='me-1.5 h-4 w-4' />}{t(queued ? 'myJobs.removeQueued' : 'runStop.stop')}
      </Button>}
    </div>
  </li>;
}
