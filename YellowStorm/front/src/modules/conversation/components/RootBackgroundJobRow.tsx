import { Button } from '@/components/ui/button';
import { useApiAction } from '@/lib/use-api-action';
import { useModuleTranslation } from '@/modules/localization';
import { cancelRootBackgroundJob } from '../api';
import type { RootWorkSnapshot } from '../types';

export function RootBackgroundJobRow({ job, conversationId, epoch, onCancelled }: {
  job: RootWorkSnapshot['jobs'][number]; conversationId: string; epoch: number; onCancelled: () => void;
}) {
  const { t } = useModuleTranslation('conversation');
  const { execute: cancel, isLoading, error } = useApiAction(cancelRootBackgroundJob, { showErrorToast: false });
  const label = job.task || t(job.role === 'followup' ? 'rootWork.synthesis' : job.role === 'fanout_driver' ? 'rootWork.fanout' : 'rootWork.worker');
  const active = ['queued', 'running', 'waiting', 'outcome_unknown'].includes(job.status);
  return <li className='space-y-1'>
    <div className='flex items-start justify-between gap-3'>
      <span className={job.status === 'failed' ? 'min-w-0 break-words text-destructive' : 'min-w-0 break-words'}>
        {label}: {t(`rootWork.status.${job.status}`)}
      </span>
      {active && <Button size='sm' variant='outline' className='shrink-0' disabled={isLoading}
        aria-label={t('rootWork.stopTaskLabel', { task: label })} onClick={async () => {
          const result = await cancel(conversationId, job.executionId, { expectedEpoch: epoch });
          if (result) onCancelled();
        }}>{t('rootWork.stopTask')}</Button>}
    </div>
    {job.status === 'cancelled' && <p className='text-xs text-muted-foreground'>{t('rootWork.taskCancelled')}</p>}
    {error && <p role='alert' className='text-sm text-destructive'>{error.message}</p>}
  </li>;
}
