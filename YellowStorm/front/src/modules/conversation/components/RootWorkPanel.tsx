import { Button } from '@/components/ui/button';
import { useApiAction } from '@/lib/use-api-action';
import { useAuth } from '@/modules/auth/useAuth';
import { useModuleTranslation } from '@/modules/localization';
import { stopRootWork } from '../api';
import { useConversationStore } from '../store';
import { useConversationUiStore } from '../uiStore';
import { useRootWorkStore } from '../rootWorkStore';
import { rootWorkActivityText } from './root-work-replay';
import { WorkMessageLink } from './WorkMessageLink';
import { RootBackgroundJobRow } from './RootBackgroundJobRow';
import { groupRootWork, snapshotWork } from './root-work-groups';
import { WorkerSummary, WorkerAssignments } from './WorkerAssignments';
import { useRootWorkObserver } from './useRootWorkObserver';
import { WorkDisclosure } from './WorkDisclosure';

export function RootWorkPanel({ conversationId, creatorId, variant = 'dock' }: {
  conversationId: string; creatorId: string; variant?: 'dock' | 'details';
}) {
  const { user } = useAuth();
  const { t } = useModuleTranslation('conversation');
  const storeUserId = useRootWorkStore((state) => state.userId);
  const snapshot = useRootWorkStore((state) => state.snapshots[conversationId]);
  const activity = useRootWorkStore((state) => state.activity[conversationId]);
  const unread = useRootWorkStore((state) => state.unreadPublicationIds[conversationId]);
  const refresh = useRootWorkStore((state) => state.refresh);
  const setContextPanel = useConversationUiStore((state) => state.setContextPanel);

  const pendingStop = useRootWorkStore((state) => state.pendingStops[conversationId]);
  const setPendingStop = (request: Parameters<typeof stopRootWork>[1] | undefined) => useRootWorkStore.getState().setPendingStop(conversationId, request);
  const { execute: stop, isLoading, error } = useApiAction(stopRootWork, { showErrorToast: false });
  useRootWorkObserver(conversationId, user?.id === creatorId ? user.id : undefined, variant === 'dock');
  if (user?.id !== creatorId || storeUserId !== user?.id) return null;
  const groups = groupRootWork(snapshotWork(snapshot));
  const active = groups.filter((group) => group.active);
  const attention = groups.filter((group) => group.attention);
  const fresh = groups.filter((group) => group.publicationMessageId && unread?.includes(group.publicationMessageId));
  const history = groups.filter((group) => !group.active && !group.attention && !fresh.includes(group));
  const visible = groups.filter((group) => group.active || group.attention || fresh.includes(group));
  if (variant === 'dock') {
    if (!groups.length && !unread?.length) return null;
    const summary = [attention.length ? t('rootWork.attentionCount', { count: attention.length }) : '',
      active.length ? t('rootWork.workingCount', { count: active.length }) : '',
      unread?.length ? t('rootWork.unreadCount', { count: unread.length }) : ''].filter(Boolean).join(' · ');
    return <section aria-label={t('rootWork.title')} className='mx-auto w-full max-w-6xl shrink-0 px-4'>
      <Button variant='ghost' className='h-9 w-full justify-between gap-3 overflow-hidden px-2 text-xs'
        aria-label={t('rootWork.openDetails')} onClick={() => setContextPanel('work')}>
        <span className='truncate' aria-live='polite'>{t('rootWork.title')}: {summary || t('rootWork.noActiveWork')}</span>
        <span className='shrink-0 text-muted-foreground'>{t('rootWork.details')}</span>
      </Button>
    </section>;
  }
  const renderGroup = (group: typeof groups[number]) => <li key={group.id} className='border-b py-4 first:pt-0 last:border-0'>
    <p className='line-clamp-2 break-words text-sm font-medium' title={group.title}>{group.title || t('rootWork.request')}</p>
    <p className='mt-1 text-xs text-muted-foreground'>
      {t(group.state === 'preparing' ? 'rootWork.preparing' : `rootWork.status.${group.state}`)}
      {group.publicationMessageId && unread?.includes(group.publicationMessageId) && <span className='ms-2 text-primary'>{t('rootWork.newResult')}</span>}
    </p>
    <div className='mt-2 text-xs'><WorkerSummary jobs={group.jobs} /></div>
    <WorkerAssignments jobs={group.jobs} />
    <div className='space-y-1 py-1'>
      {group.publicationMessageId && <WorkMessageLink conversationId={conversationId} messageId={group.publicationMessageId}
        executionId={group.jobs.find((job) => job.publicationMessageId === group.publicationMessageId)?.executionId} />}
      {group.jobs[0].originQuestionMessageId && <WorkMessageLink conversationId={conversationId}
        messageId={group.jobs[0].originQuestionMessageId} kind='request' />}
    </div>    {group.jobs.some((job) => job.mode !== 'foreground') && <WorkDisclosure label={<>{t('rootWork.details')} ({group.jobs.filter((job) => job.mode !== 'foreground').length})</>}>
      <ul className='space-y-3 pb-2 text-xs'><>{group.jobs.filter((job) => job.mode !== 'foreground').map((job) => <RootBackgroundJobRow key={job.executionId}
        job={job} conversationId={conversationId} epoch={snapshot!.epoch} onCancelled={refresh} />)}</></ul>
    </WorkDisclosure>}
  </li>;
  return <section aria-label={t('rootWork.title')} className='min-w-0 space-y-4 p-4'>
    {(unread ?? []).filter((id) => !groups.some((group) => group.publicationMessageId === id)).map((id) => <WorkMessageLink key={id} conversationId={conversationId} messageId={id} />)}
    {!groups.length && !unread?.length && <p className='text-sm text-muted-foreground'>{t('rootWork.empty')}</p>}
    <ul>{visible.map(renderGroup)}</ul>
    {!!history.length && <details><summary className='cursor-pointer text-sm text-muted-foreground'>{t('rootWork.history')} ({history.length})</summary>
      <ul className='mt-3'>{history.map(renderGroup)}</ul></details>}
    {error && <p role='alert' className='text-sm text-destructive'>{error.message}</p>}
    {pendingStop && <p role='status' className='text-sm text-muted-foreground'>{t('rootWork.cancellationPending')}</p>}
    {snapshot && (!!active.length || groups.some((group) => group.state === 'outcome_unknown') || pendingStop) && <Button variant='outline' className='text-destructive' disabled={isLoading} onClick={async () => {
      const stream = useConversationStore.getState();
      const request = pendingStop ?? { expectedEpoch: snapshot.epoch, stopRequestId: snapshot.stopRequestId,
        ...(stream.streamingConversationId === conversationId && stream.streamingMessageId ? { foregroundMessageId: stream.streamingMessageId } : {}) };
      const result = await stop(conversationId, request);
      if (!result) return;
      setPendingStop(result.foregroundCancellationPending ? request : undefined);
      if (result.barrierEpoch > snapshot.epoch) useRootWorkStore.getState().update(conversationId,
        { ...snapshot, epoch: result.barrierEpoch, jobs: [], foregroundWorkers: [], watermark: '0' });
      refresh();
    }}>{t(pendingStop ? 'rootWork.retryCancellation' : 'rootWork.stopAll')}</Button>}
    {!!activity?.events.length && <WorkDisclosure label={t('rootWork.activity')} className='text-xs text-muted-foreground'>
      <p className='py-1'>{t('rootWork.activityBound')}</p>
      <ol className='max-h-48 space-y-2 overflow-y-auto break-words'>{activity.events.map((event) => <li key={event.eventId}>
        {rootWorkActivityText(event) ?? t(event.payload.kind === 'followup_published' ? 'rootWork.activityPublished'
          : event.payload.kind === 'component' ? 'rootWork.activityComponent' : event.payload.kind === 'usage' ? 'rootWork.activityUsage' : 'rootWork.activityProgress')}
      </li>)}</ol>
    </WorkDisclosure>}
  </section>;
}
