import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useApiAction } from '@/lib/use-api-action';
import { useModuleTranslation } from '@/modules/localization';
import { cancelRootBackgroundJob, fetchRootResult } from '../api';
import type { RootExecutionTextResult, RootWorkSnapshot } from '../types';

function itemStatus(status: string) {
  switch (status) {
    case 'queued': case 'running': case 'waiting': case 'outcome_unknown': case 'completed': case 'failed': case 'cancelled': case 'cancellation_requested': case 'not_started': return status;
    default: return 'outcome_unknown';
  }
}

export function RootBackgroundJobRow({ job, conversationId, epoch, onCancelled }: {
  job: RootWorkSnapshot['jobs'][number]; conversationId: string; epoch: number; onCancelled: () => void;
}) {
  const { t } = useModuleTranslation('conversation');
  const { execute: cancel, isLoading, error } = useApiAction(cancelRootBackgroundJob, { showErrorToast: false });
  const { execute: loadResult, isLoading: loadingResult, error: resultError } = useApiAction(fetchRootResult, { showErrorToast: false });
  const [result, setResult] = useState<RootExecutionTextResult>();
  const [cancellationRequested, setCancellationRequested] = useState(false);
  const label = job.role === 'followup' ? t('rootWork.synthesis') : job.role === 'fanout_driver'
    ? t('rootWork.fanout') : job.task || t('rootWork.worker');
  const active = ['queued', 'running', 'waiting', 'outcome_unknown'].includes(job.status);
  return <li className='space-y-1'>
    <div className='flex items-start justify-between gap-3'>
      <span className={job.status === 'failed' ? 'min-w-0 break-words text-destructive' : 'min-w-0 break-words'}>
        {label}: {t(`rootWork.status.${job.status}`)}
      </span>
      {active && <Button size='sm' variant='outline' className='shrink-0' disabled={isLoading || cancellationRequested}
        aria-label={t('rootWork.stopTaskLabel', { task: label })} onClick={async () => {
          const response = await cancel(conversationId, job.executionId, { expectedEpoch: epoch });
          if (response) { setCancellationRequested(true); onCancelled(); }
        }}>{t(cancellationRequested ? 'rootWork.cancellationPending' : 'rootWork.stopTask')}</Button>}
    </div>
    {!!job.fanoutItems?.length && <p className='text-muted-foreground'>{t('rootWork.progress', { completed: job.fanoutItems.filter((item) => item.status === 'completed').length, total: job.fanoutItems.length })}</p>}
    {!!job.fanoutItems?.length && <ul className='max-h-48 space-y-1 overflow-y-auto pl-3'>
      {job.fanoutItems.map((item, index) => <li key={item.executionId} className='break-words'>
        {item.label || t('rootWork.item', { number: index + 1 })}: {t(`rootWork.status.${itemStatus(item.status)}`)}
        {item.status === 'completed' && <Button size='sm' variant='link' className='h-8 px-2' disabled={loadingResult} aria-busy={loadingResult}
          onClick={async () => { const response = await loadResult(conversationId, item.executionId); if (response) setResult(response); }}>{t('rootWork.viewFullResult')}</Button>}
      </li>)}
    </ul>}
    {job.status === 'completed' && <Button size='sm' variant='link' className='h-8 px-0' disabled={loadingResult}
      onClick={async () => { const response = await loadResult(conversationId, job.executionId); if (response) setResult(response); }}>
      {t('rootWork.viewFullResult')}</Button>}
    {result && <details open><summary className='cursor-pointer'>{t('rootWork.result')}</summary>
      {!result.complete && <p className='text-muted-foreground'>{t('rootWork.partialResult')}</p>}
      <pre className='max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs'>{result.text}</pre>
    </details>}
    {job.status === 'cancelled' && <p className='text-xs text-muted-foreground'>{t('rootWork.taskCancelled')}</p>}
    {(error || resultError) && <p role='alert' className='text-sm text-destructive'>{(error || resultError)?.message}</p>}
  </li>;
}
