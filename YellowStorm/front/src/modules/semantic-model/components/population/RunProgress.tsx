import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { PopulationProgress } from '../../types';

const ISSUE_STATUSES = new Set(['processed_with_gaps', 'budget_exhausted', 'unresolved_identity', 'index_unavailable',
  'index_ambiguous', 'source_unavailable']);

/** "about 3 min left": whole seconds under a minute, whole minutes under an hour, then hours. */
export function durationParts(seconds: number): { unit: 'seconds' | 'minutes' | 'hours'; count: number } {
  if (seconds < 60) return { unit: 'seconds', count: Math.max(1, Math.round(seconds)) };
  if (seconds < 3600) return { unit: 'minutes', count: Math.round(seconds / 60) };
  return { unit: 'hours', count: Math.round((seconds / 3600) * 10) / 10 };
}

/**
 * What a run is doing right now: how far it got, what it found, what it is reading, and what it just read.
 * Reported by the reader about once a second; the time left is estimated from the pace so far.
 */
export function RunProgress({ progress, running, conceptLabels = {} }: Readonly<{
  progress: Partial<PopulationProgress>;
  running: boolean;
  conceptLabels?: Record<string, string>;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const total = progress.total ?? 0;
  const done = Math.min(progress.done ?? 0, total || Number.MAX_SAFE_INTEGER);
  const percent = total ? Math.round((done / total) * 100) : 0;
  const started = progress.startedAt ? Date.parse(progress.startedAt) : Number.NaN;
  const elapsed = Number.isFinite(started) ? Math.max(0, (now - started) / 1000) : null;
  // Reused files take no time, so they are left out of the pace.
  const readFresh = done - (progress.reused ?? 0);
  const left = running && elapsed !== null && readFresh > 0 && done < total
    ? (elapsed / readFresh) * (total - done) : null;
  const phase = progress.phase ?? 'starting';
  const concept = (id?: string) => (id ? conceptLabels[id] : undefined);
  const duration = (seconds: number) => {
    const { unit, count } = durationParts(seconds);
    return t(`population.progress.${unit}`, { count });
  };

  return <section aria-label={t('population.progress.title')} className='space-y-3'>
    <div>
      <div className='flex items-baseline justify-between gap-2 text-sm'>
        <span className='font-medium'>{running ? t(`population.progress.phase.${phase}`) : t('population.progress.finished')}</span>
        {total > 0 && <span className='tabular-nums text-muted-foreground'>{percent}%</span>}
      </div>
      <div className='mt-1.5 h-2 overflow-hidden rounded-full bg-muted' role='progressbar' aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done}
        aria-label={t('population.progress.filesRead', { done, total })}>
        <div className={cn('h-full rounded-full bg-primary transition-[width] duration-500', running && phase !== 'reading' && 'animate-pulse')}
          style={{ width: `${phase === 'reading' || phase === 'starting' ? percent : 100}%` }} />
      </div>
      <p className='mt-1.5 text-xs text-muted-foreground'>
        {t('population.progress.filesRead', { done: done.toLocaleString(), total: total.toLocaleString() })}
        {left !== null && <> · {t('population.progress.left', { time: duration(left) })}</>}
        {!running && elapsed !== null && <> · {t('population.progress.took', { time: duration(elapsed) })}</>}
      </p>
    </div>

    <dl className='grid grid-cols-3 gap-2 text-center'>
      <div className='rounded-lg border p-2'>
        <dt className='text-[10px] uppercase tracking-wide text-muted-foreground'>{t('population.progress.records')}</dt>
        <dd className='text-base font-semibold tabular-nums'>{(progress.records ?? 0).toLocaleString()}</dd>
      </div>
      <div className='rounded-lg border p-2' title={t('population.progress.reusedHint')}>
        <dt className='text-[10px] uppercase tracking-wide text-muted-foreground'>{t('population.progress.reused')}</dt>
        <dd className='text-base font-semibold tabular-nums'>{(progress.reused ?? 0).toLocaleString()}</dd>
      </div>
      <div className='rounded-lg border p-2'>
        <dt className='text-[10px] uppercase tracking-wide text-muted-foreground'>{t('population.progress.gaps')}</dt>
        <dd className={cn('text-base font-semibold tabular-nums', (progress.gaps ?? 0) > 0 && 'text-amber-700 dark:text-amber-400')}>{(progress.gaps ?? 0).toLocaleString()}</dd>
      </div>
    </dl>

    {running && progress.current && <div className='flex items-center gap-2 rounded-lg bg-primary/5 p-2.5 text-xs'>
      <Loader2 className='h-3.5 w-3.5 shrink-0 animate-spin text-primary' />
      <div className='min-w-0'>
        <p className='text-muted-foreground'>{t('population.progress.reading')}</p>
        <p className='truncate font-medium' title={progress.current.name}>{progress.current.name}</p>
        {concept(progress.current.conceptId) && <p className='text-muted-foreground'>{t('population.progress.for', { name: concept(progress.current.conceptId) })}</p>}
      </div>
    </div>}

    {(progress.recent?.length ?? 0) > 0 && <div>
      <h3 className='mb-1.5 text-xs font-semibold text-muted-foreground'>{t('population.progress.latest')}</h3>
      <ul className='space-y-1'>
        {progress.recent!.map((item, index) => {
          const issue = ISSUE_STATUSES.has(item.status);
          return <li key={`${item.name}-${index}`} className='flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted/50'>
            {item.reused ? <RotateCcw className='h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-label={t('population.progress.reusedOne')} />
              : issue ? <AlertTriangle className='h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400' aria-label={t('population.progress.issueOne')} />
              : <CheckCircle2 className='h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400' aria-label={t('population.progress.readOne')} />}
            <span className='min-w-0 flex-1 truncate' title={item.name}>{item.name}</span>
            <span className='shrink-0 tabular-nums text-muted-foreground'>{t('population.progress.recordCount', { count: item.records })}</span>
          </li>;
        })}
      </ul>
    </div>}
  </section>;
}
