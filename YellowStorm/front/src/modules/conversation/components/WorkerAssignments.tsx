import { Clock, Loader2 } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkJob } from './root-work-groups';
import { workGroupWorkers } from './root-work-groups';
import { WorkDisclosure } from './WorkDisclosure';

export function WorkerSummary({ jobs }: { jobs: WorkJob[] }) {
  const { t } = useModuleTranslation('conversation');
  const workers = workGroupWorkers(jobs);
  if (!workers.length) return null;
  const counts = { temporary: workers.filter((worker) => worker.role === 'temporary_worker').length,
    specialist: workers.filter((worker) => worker.role === 'library_worker').length,
    unknown: workers.filter((worker) => !worker.role).length };
  const labels = (Object.entries(counts) as Array<[keyof typeof counts, number]>).filter(([, count]) => count)
    .map(([kind, count]) => t(`rootWork.${kind}Worker${count === 1 ? '' : 's'}`, { count }));
  const modes = new Set(workers.map((worker) => worker.mode));
  const activity = { running: workers.filter((worker) => worker.status === 'running').length,
    queued: workers.filter((worker) => worker.status === 'queued').length };
  return <span data-worker-summary className='font-medium'>
    {labels.join(' · ')} <span className='font-normal text-muted-foreground'>· {t(modes.size > 1 ? 'rootWork.mixedModes' :
      modes.has('foreground') ? 'rootWork.foreground' : 'rootWork.background')}
      {(activity.running > 0 || activity.queued > 0) && <> · {t('rootWork.batchActivity', activity)}</>}</span>
  </span>;
}

export function WorkerAssignments({ jobs }: { jobs: WorkJob[] }) {
  const { t } = useModuleTranslation('conversation');
  const workers = workGroupWorkers(jobs);
  if (!workers.length) return null;
  return <WorkDisclosure label={t('rootWork.assignments', { count: workers.length })}>
    <ul className='max-h-64 space-y-3 overflow-y-auto py-2 text-sm' aria-label={t('rootWork.assignments', { count: workers.length })}>
      {workers.map((worker) => <li key={worker.executionId} data-worker-id={worker.executionId} className='min-w-0 space-y-1'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
          {worker.status === 'running' && <Loader2 className='size-3 shrink-0 animate-spin motion-reduce:animate-none' aria-hidden='true' />}
          {worker.status === 'queued' && <Clock className='size-3 shrink-0' aria-hidden='true' />}
          <span className='font-medium'>{t(worker.role === 'temporary_worker' ? 'rootWork.temporaryWorkerLabel' :
            worker.role === 'library_worker' ? 'rootWork.specialistWorkerLabel' : 'rootWork.worker')}</span>
          <span className='text-muted-foreground'>{t(worker.mode === 'foreground' ? 'rootWork.foreground' : 'rootWork.background')}</span>
          <span className={['failed', 'outcome_unknown'].includes(worker.status) ? 'text-destructive' : 'text-muted-foreground'}>
            {t(`rootWork.status.${worker.status}`)}</span>
        </div>
        <p className='break-words'>{worker.task || t('rootWork.worker')}</p>
      </li>)}
    </ul>
  </WorkDisclosure>;
}
