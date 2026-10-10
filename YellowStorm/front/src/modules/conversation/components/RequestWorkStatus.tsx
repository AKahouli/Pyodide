import { AlertCircle, CheckCircle2, Clock, Loader2, MessageCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/modules/auth/useAuth';
import { useModuleTranslation } from '@/modules/localization';
import { useRootWorkStore } from '../rootWorkStore';
import { useConversationUiStore } from '../uiStore';
import { groupRootWork, snapshotWork } from './root-work-groups';
import { WorkerAssignments, WorkerSummary } from './WorkerAssignments';

export function useRequestWorkGroups(conversationId: string, messageId: string) {
  const { user } = useAuth();
  const owner = useRootWorkStore((state) => state.userId);
  const snapshot = useRootWorkStore((state) => state.snapshots[conversationId]);
  if (!user?.id || owner !== user.id) return [];
  return groupRootWork(snapshotWork(snapshot)).filter((group) =>
    group.jobs.some((job) => job.originAssistantMessageId === messageId));
}

/** The foreground acknowledgement can finish while its requested work continues. */
export function RequestWorkStatus({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const { t } = useModuleTranslation('conversation');
  const groups = useRequestWorkGroups(conversationId, messageId);
  const open = useConversationUiStore((state) => state.setContextPanel);
  if (!groups.length) return null;
  return <div data-background-activity className='my-3 space-y-2' aria-live='polite'>
    {groups.map((group) => <div key={group.id} data-execution-id={group.id} className='border-t pt-3 text-sm'>
      <div role='status' className='flex flex-wrap items-center gap-x-3 gap-y-1'>
      {group.attention ? <AlertCircle className='size-4 shrink-0 text-destructive' aria-hidden='true' />
        : group.state === 'waiting' ? <MessageCircle className='size-4 shrink-0' aria-hidden='true' />
        : group.state === 'queued' ? <Clock className='size-4 shrink-0' aria-hidden='true' />
        : group.state === 'cancellation_requested' ? <Clock className='size-4 shrink-0' aria-hidden='true' />
        : group.active ? <Loader2 className='size-4 shrink-0 animate-spin motion-reduce:animate-none' aria-hidden='true' />
        : group.state === 'completed' ? <CheckCircle2 className='size-4 shrink-0 text-green-500' aria-hidden='true' />
        : <XCircle className='size-4 shrink-0' aria-hidden='true' />}
      <span className='font-medium'>{t('rootWork.title')}: {t(group.state === 'preparing' ? 'rootWork.preparing' : `rootWork.status.${group.state}`)}</span>
      <WorkerSummary jobs={group.jobs} />
      {!!group.counts.total && <span className='text-muted-foreground tabular-nums'>{t('rootWork.progress', { completed: group.counts.completed, total: group.counts.total })}</span>}
      {!!group.counts.unresolved && <span className='text-destructive'>{t('rootWork.unresolved', { count: group.counts.unresolved })}</span>}
      {group.active && <span className='text-muted-foreground'>{t('rootWork.canContinue')}</span>}
      <Button variant='link' size='sm' className='h-8 px-0' onClick={() => open('work')}>{t('rootWork.openDetails')}</Button>
      </div>
      <WorkerAssignments jobs={group.jobs} />
    </div>)}
  </div>;
}
