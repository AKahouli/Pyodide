import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, CheckCircle2, ChevronRight, AlertTriangle, CircleSlash, Loader2, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { usePopulationFreshness } from '../../query/hooks';
import type { PopulationJob } from '../../types';

const RUNNING = new Set(['queued', 'waiting_dependencies', 'running', 'cancel_requested']);

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The model's last data updates, newest first: how each ended, when, how long it took, what it made and
 * changed, and what went wrong. Says first when the next run cannot start, and why.
 */
export function RunHistoryPanel({ modelId, onClose, onOpenRun, onOpenReview }: Readonly<{
  modelId: string;
  onClose: () => void;
  /** Shows a run still going on, with its progress and Stop. */
  onOpenRun?: (job: PopulationJob) => void;
  onOpenReview?: () => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const translate = t as Translate;
  const freshness = usePopulationFreshness(modelId);
  const runs = useQuery({
    queryKey: ['semantic-models', 'population-jobs', modelId],
    queryFn: () => semanticModelApi.listPopulationJobs(modelId),
    // A run still going on is followed until it ends.
    refetchInterval: (query) => (query.state.data ?? []).some((job) => RUNNING.has(job.state)) ? 3000 : false,
  });
  const [open, setOpen] = useState<string | null>(null);
  const blocked = freshness.data?.state === 'not_runnable' ? freshness.data.reason : undefined;
  return <aside className='relative z-20 flex h-full w-full max-w-sm shrink-0 flex-col border-l bg-background shadow-xl' aria-label={t('runHistory.title')}>
    <header className='flex items-start gap-3 border-b px-4 py-3'>
      <div className='min-w-0 flex-1'>
        <h2 className='font-semibold'>{t('runHistory.title')}</h2>
        <p className='mt-1 text-xs text-muted-foreground'>{t('runHistory.hint')}</p>
      </div>
      <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0' onClick={onClose} aria-label={t('action.close')}><X className='h-4 w-4' /></Button>
    </header>
    <div className='min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pt-3 pb-28'>
      {blocked && <div role='alert' className='space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs'>
        <p className='flex items-center gap-1.5 font-medium text-destructive'><AlertOctagon className='h-4 w-4 shrink-0' />{t('runHistory.blocked')}</p>
        <p className='break-words'>{blocked}</p>
        {onOpenReview && <Button size='sm' variant='outline' className='h-7' onClick={onOpenReview}>{t('runHistory.openReview')}</Button>}
      </div>}
      {runs.isLoading ? <Loader2 className='h-4 w-4 animate-spin' />
        : runs.isError ? <p className='text-xs text-destructive'>{t('runHistory.unavailable')}</p>
          : !runs.data?.length ? <p className='text-sm text-muted-foreground'>{t('runHistory.empty')}</p>
            : <ul className='divide-y rounded-lg border'>{runs.data.map((job) => <RunRow key={job.jobId} job={job} translate={translate}
              expanded={open === job.jobId} onToggle={() => setOpen(open === job.jobId ? null : job.jobId)} onOpenRun={onOpenRun} />)}</ul>}
    </div>
  </aside>;
}

function RunRow({ job, translate, expanded, onToggle, onOpenRun }: Readonly<{
  job: PopulationJob; translate: Translate; expanded: boolean; onToggle: () => void; onOpenRun?: (job: PopulationJob) => void;
}>) {
  const running = RUNNING.has(job.state);
  const result = (job.result ?? {}) as { entityCount?: number; relationshipCount?: number; purpose?: string;
    counts?: { gaps?: number }; changes?: { added?: number; changed?: number; removed?: number } };
  const changes = result.changes ?? job.progress?.changes;
  const started = job.startedAt ?? job.createdAt;
  const seconds = started && job.completedAt ? Math.max(0, Math.round((Date.parse(job.completedAt) - Date.parse(started)) / 1000)) : null;
  const summary = [
    result.entityCount != null ? translate('runHistory.records', { count: result.entityCount }) : '',
    result.relationshipCount != null ? translate('runHistory.links', { count: result.relationshipCount }) : '',
    result.counts?.gaps ? translate('runHistory.gaps', { count: result.counts.gaps }) : '',
  ].filter(Boolean).join(' · ');
  return <li>
    <button type='button' aria-expanded={expanded} onClick={onToggle} className='flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'>
      <StateIcon state={job.state} />
      <div className='min-w-0 flex-1'>
        <p className='text-sm font-medium'>{translate(`runHistory.state.${job.state}`, { defaultValue: job.state })}
          {result.purpose && <span className='ml-1.5 text-xs font-normal text-muted-foreground'>{translate(`runHistory.purpose.${result.purpose}`, { defaultValue: '' })}</span>}</p>
        <p className='text-[11px] text-muted-foreground'>
          {job.createdAt ? new Date(job.createdAt).toLocaleString() : ''}{seconds != null ? ` · ${duration(seconds, translate)}` : ''}
        </p>
        {summary && <p className='text-[11px] text-muted-foreground'>{summary}</p>}
        {job.state === 'failed' && <p className='mt-0.5 break-words text-[11px] text-destructive'>{errorText(job.errorCode, translate)}</p>}
      </div>
      <ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden />
    </button>
    {expanded && <div className='space-y-2 px-3 pb-3 pl-9 text-xs'>
      {changes && <p>{translate('runHistory.changes', { added: changes.added ?? 0, changed: changes.changed ?? 0, removed: changes.removed ?? 0 })}</p>}
      {(job.progress?.recent ?? []).length > 0 && <ul className='space-y-0.5'>{job.progress!.recent!.map((source, index) => <li key={`${source.name}-${index}`} className='flex gap-2'>
        <span className='min-w-0 flex-1 truncate' title={source.name}>{source.name}</span>
        <span className='shrink-0 tabular-nums text-muted-foreground'>{translate('runHistory.records', { count: source.records })}{source.reused ? ` · ${translate('runHistory.reused')}` : ''}</span>
      </li>)}</ul>}
      {running && onOpenRun && <Button size='sm' variant='outline' className='h-7' onClick={() => onOpenRun(job)}>{translate('runHistory.follow')}</Button>}
    </div>}
  </li>;
}

function StateIcon({ state }: Readonly<{ state: string }>) {
  const icon = 'mt-0.5 h-4 w-4 shrink-0';
  if (RUNNING.has(state)) return <Loader2 className={`${icon} animate-spin text-primary`} aria-hidden />;
  if (state === 'completed') return <CheckCircle2 className={`${icon} text-emerald-600`} aria-hidden />;
  if (state === 'completed_with_gaps') return <AlertTriangle className={`${icon} text-amber-600`} aria-hidden />;
  if (state === 'failed') return <XCircle className={`${icon} text-destructive`} aria-hidden />;
  return <CircleSlash className={`${icon} text-muted-foreground`} aria-hidden />;
}

function duration(seconds: number, translate: Translate) {
  if (seconds < 60) return translate('runHistory.seconds', { count: seconds });
  return translate('runHistory.minutes', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
}

/** A run's error code in words, when known; the code itself otherwise. */
export function errorText(code: string | null, translate: Translate) {
  if (!code) return translate('runHistory.error.unknown');
  return translate(`runHistory.error.${code}`, { defaultValue: translate('runHistory.error.other', { code }) });
}
