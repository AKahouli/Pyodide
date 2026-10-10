import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/modules/auth/useAuth';
import { useModuleTranslation } from '@/modules/localization';
import { useRootWorkStore } from '../rootWorkStore';
import { useConversationUiStore } from '../uiStore';
import { groupRootWork } from './root-work-groups';

/** The foreground acknowledgement can finish while its requested work continues. */
export function RequestWorkStatus({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const { user } = useAuth();
  const { t } = useModuleTranslation('conversation');
  const owner = useRootWorkStore((state) => state.userId);
  const snapshot = useRootWorkStore((state) => state.snapshots[conversationId]);
  const open = useConversationUiStore((state) => state.setContextPanel);
  if (!user?.id || owner !== user.id) return null;
  const groups = groupRootWork(snapshot?.jobs ?? []).filter((group) =>
    group.jobs.some((job) => job.originAssistantMessageId === messageId));
  if (!groups.length) return null;
  return <div className='mt-3 space-y-2' aria-live='polite'>
    {groups.map((group) => <div key={group.id} className='flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-sm'>
      {group.attention ? <AlertCircle className='size-4 shrink-0 text-destructive' aria-hidden='true' />
        : group.active ? <Loader2 className='size-4 shrink-0 animate-spin motion-reduce:animate-none' aria-hidden='true' /> : null}
      <span className='font-medium'>{t('rootWork.title')}: {t(group.state === 'preparing' ? 'rootWork.preparing' : `rootWork.status.${group.state}`)}</span>
      {!!group.counts.total && <span className='text-muted-foreground tabular-nums'>{t('rootWork.progress', { completed: group.counts.completed, total: group.counts.total })}</span>}
      {(group.counts.running > 0 || group.counts.queued > 0) && <span className='text-muted-foreground tabular-nums'>{t('rootWork.batchActivity', group.counts)}</span>}
      {!!group.counts.unresolved && <span className='text-destructive'>{t('rootWork.unresolved', { count: group.counts.unresolved })}</span>}
      {group.active && <span className='text-muted-foreground'>{t('rootWork.canContinue')}</span>}
      <Button variant='link' size='sm' className='h-8 px-0' onClick={() => open('work')}>{t('rootWork.openDetails')}</Button>
    </div>)}
  </div>;
}
