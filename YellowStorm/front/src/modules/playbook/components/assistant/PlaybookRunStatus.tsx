import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { cancelFlowExecution, getFlowExecutionDetail } from '../../api';
import type { ExecutionStatus } from '../../types';

const ACTIVE: readonly ExecutionStatus[] = ['queued', 'pending', 'running', 'pending_approval'];
const runKey = (executionId: string) => ['playbook', 'assistant-run', executionId];

/**
 * Under a chat button that opens a run: while the run is going, it says so and offers to stop it. Stopping
 * asks once more, since what the run was doing is lost.
 */
export function PlaybookRunStatus({ executionId }: Readonly<{ executionId: string }>) {
  const { t } = useModuleTranslation('platform-copilot');
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const run = useQuery({
    queryKey: runKey(executionId),
    queryFn: () => getFlowExecutionDetail(executionId),
    refetchInterval: (query) => (query.state.data && ACTIVE.includes(query.state.data.status) ? 4000 : false),
    retry: false,
  });
  const stop = useMutation({
    mutationFn: () => cancelFlowExecution(executionId),
    onSettled: () => {
      setConfirming(false);
      void client.invalidateQueries({ queryKey: runKey(executionId) });
    },
  });

  const status = run.data?.status;
  if (status === 'cancelled' && stop.isSuccess) {
    return <p className='px-1 text-xs text-muted-foreground'>{t('playbookRun.stopped')}</p>;
  }
  if (!status || !ACTIVE.includes(status)) return null;
  return (
    <div className='flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground'>
      <Loader2 className='size-3.5 animate-spin text-primary' />
      <span className='min-w-0 flex-1'>{t(status === 'pending_approval' ? 'playbookRun.waiting' : 'playbookRun.running')}</span>
      {confirming
        ? <>
          <span>{t('playbookRun.confirm')}</span>
          <Button type='button' size='sm' variant='destructive' className='h-7 px-2 text-xs' disabled={stop.isPending} onClick={() => stop.mutate()}>
            {stop.isPending ? <Loader2 className='size-3.5 animate-spin' /> : t('playbookRun.stopConfirm')}
          </Button>
          <Button type='button' size='sm' variant='ghost' className='h-7 px-2 text-xs' disabled={stop.isPending} onClick={() => setConfirming(false)}>{t('playbookRun.keep')}</Button>
        </>
        : <Button type='button' size='sm' variant='outline' className='h-7 gap-1 px-2 text-xs' onClick={() => setConfirming(true)}>
          <StopCircle className='size-3.5' />{t('playbookRun.stop')}
        </Button>}
      {stop.isError && <span role='alert' className='w-full text-destructive'>{t('playbookRun.stopFailed')}</span>}
    </div>
  );
}
