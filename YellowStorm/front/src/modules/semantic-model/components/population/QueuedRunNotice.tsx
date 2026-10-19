import { useEffect, useState } from 'react';
import { AlertTriangle, Hourglass } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { PopulationJobQueue } from '../../types';

/** A queue with no worker is only worth a warning once the job has had time to be picked up. */
export const NO_WORKER_GRACE_SECONDS = 10;

/** Whether nobody is consuming the queue of a job that has waited past the grace period. */
export function queueUnattended(queue: PopulationJobQueue, queuedSeconds: number | null): boolean {
  return queue.workersOnline === 0 && queuedSeconds !== null && queuedSeconds > NO_WORKER_GRACE_SECONDS;
}

/**
 * What a run waiting in the queue is waiting for: its place behind the other jobs of the queue, or,
 * when no worker is consuming the queue, a warning that it starts only once one is back online.
 * The panel shows it only while the job is `queued`; the normal progress takes over once it starts.
 */
export function QueuedRunNotice({ queue, queuedSince }: Readonly<{
  queue: PopulationJobQueue;
  /** When the job was created (ISO), to time the grace period. */
  queuedSince?: string;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const since = queuedSince ? Date.parse(queuedSince) : Number.NaN;
  const queuedSeconds = Number.isFinite(since) ? Math.max(0, (now - since) / 1000) : null;

  if (queueUnattended(queue, queuedSeconds)) {
    return <section role='alert' className='space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300'>
      <p className='flex items-center gap-2 font-semibold'><AlertTriangle className='h-4 w-4 shrink-0' />{t('population.queued.noWorkerTitle')}</p>
      <p>{t('population.queued.noWorkerHint')}</p>
      <p>{t('population.queued.noWorkerDevHint')}</p>
    </section>;
  }
  const { running, queued } = queue.ahead;
  return <p role='status' className='flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground'>
    <Hourglass className='h-4 w-4 shrink-0' />
    {running + queued === 0
      ? t('myJobs.waitingWorker')
      : t('population.queued.position', { position: queue.position, running, queued })}
  </p>;
}
