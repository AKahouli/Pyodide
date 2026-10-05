import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useApiAction } from '@/lib/use-api-action';
import { useAuth } from '@/modules/auth/useAuth';
import { useModuleTranslation } from '@/modules/localization';
import { fetchRootWork, fetchRootWorkEvents, stopRootWork } from '../api';
import { useConversationStore } from '../store';
import type { RootWorkSnapshot } from '../types';
import { appendRootWorkEvents, rootWorkActivityText, type RootWorkReplay } from './root-work-replay';

function RootWorkPanelContent({ conversationId, creatorId }: { conversationId: string; creatorId: string }) {
  const { user } = useAuth();
  const { t } = useModuleTranslation('conversation');
  const [snapshot, setSnapshot] = useState<RootWorkSnapshot>();
  const [pendingStop, setPendingStop] = useState<Parameters<typeof stopRootWork>[1]>();
  const [activity, setActivity] = useState<RootWorkReplay>();
  const replay = useRef<RootWorkReplay>();
  const refreshing = useRef(false);
  const observer = useRef<AbortController>();
  const streamingConversationId = useConversationStore((state) => state.streamingConversationId);
  const streamingMessageId = useConversationStore((state) => state.streamingMessageId);
  const fetchMessages = useConversationStore((state) => state.fetchMessages);
  const { execute: fetch } = useApiAction(fetchRootWork, { showErrorToast: false });
  const { execute: fetchEvents } = useApiAction(fetchRootWorkEvents, { showErrorToast: false });
  const { execute: stop, isLoading, error } = useApiAction(stopRootWork, { showErrorToast: false });
  const refresh = useCallback(async (signal: AbortSignal) => {
    if (refreshing.current || signal.aborted) return;
    refreshing.current = true;
    try {
      const result = await fetch(conversationId, signal);
      if (signal.aborted) return;
      setSnapshot((previous) => result && previous && result.epoch < previous.epoch ? previous : result ?? undefined);
      if (!result) { replay.current = undefined; setActivity(undefined); return; }
      if (replay.current && result.epoch < replay.current.epoch) return;
      if (result.jobs.some((job) => job.publicationMessageId
        && !useConversationStore.getState().messages.some((message) => message.id === job.publicationMessageId))) {
        await fetchMessages(conversationId);
        if (signal.aborted) return;
      }
      if (replay.current && result.epoch < replay.current.epoch) return;
      replay.current = appendRootWorkEvents(replay.current, result.epoch, []);
      // Keep the cursor from before the snapshot: events committed between
      // snapshot and polling are included. Each page is bounded server-side.
      const events = await fetchEvents(conversationId, result.epoch, replay.current.cursor, signal);
      if (signal.aborted) return;
      if (!events) { replay.current = undefined; setActivity(undefined); setSnapshot(undefined); return; }
      if (replay.current.epoch > result.epoch) return;
      const previousCursor = replay.current.cursor;
      replay.current = appendRootWorkEvents(replay.current, result.epoch, events);
      setActivity(replay.current);
      if (events.some((event) => event.payload.kind === 'followup_published'
        && event.payload.conversationEpoch === result.epoch && /^[0-9]{1,20}$/.test(event.sequence)
        && BigInt(event.sequence) > BigInt(previousCursor))) await fetchMessages(conversationId);
    } finally { refreshing.current = false; }
  }, [fetch, fetchEvents, fetchMessages, conversationId]);
  useEffect(() => {
    if (user?.id !== creatorId) return;
    const abort = new AbortController();
    observer.current = abort;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh(abort.signal);
      if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => { abort.abort(); observer.current = undefined; clearTimeout(timer); };
  }, [refresh, creatorId, user?.id]);
  const active = snapshot?.jobs.filter((job): job is RootWorkSnapshot['jobs'][number]
    & { status: 'queued' | 'running' | 'waiting' | 'outcome_unknown' } =>
    ['queued', 'running', 'waiting', 'outcome_unknown'].includes(job.status)) ?? [];
  const failed = snapshot?.jobs.filter((job) => job.status === 'failed') ?? [];
  if (user?.id !== creatorId || !snapshot || active.length === 0 && failed.length === 0 && !pendingStop && !activity?.events.length) return null;
  return <section aria-label={t('rootWork.title')} className='mx-auto flex w-full max-w-6xl items-start justify-between gap-4 px-4 py-3'>
    <div className='min-w-0 space-y-1'>
      <p className='text-sm font-medium'>{t('rootWork.title')}</p>
      <ul className='space-y-1 text-sm text-muted-foreground' aria-live='polite'>
        {active.map((job) => <li key={job.executionId}>
          {t(job.role === 'followup' ? 'rootWork.synthesis' : job.role === 'fanout_driver' ? 'rootWork.fanout' : 'rootWork.worker')}: {t(`rootWork.status.${job.status}`)}
        </li>)}
        {failed.map((job) => <li key={job.executionId} className='text-destructive'>
          {t(job.role === 'followup' ? 'rootWork.synthesis' : job.role === 'fanout_driver' ? 'rootWork.fanout' : 'rootWork.worker')}: {t('rootWork.status.failed')}
        </li>)}
      </ul>
      {error && <p role='alert' className='text-sm text-destructive'>{error.message}</p>}
      {pendingStop && <p role='status' className='text-sm text-muted-foreground'>{t('rootWork.cancellationPending')}</p>}
      {!!activity?.events.length && <details className='text-sm text-muted-foreground'>
        <summary className='cursor-pointer'>{t('rootWork.activity')}</summary>
        <p className='py-1 text-xs'>{t('rootWork.activityBound')}</p>
        <ol className='space-y-1'>{activity.events.map((event) => <li key={event.eventId}>
          {rootWorkActivityText(event) ?? t(event.payload.kind === 'followup_published' ? 'rootWork.activityPublished'
            : event.payload.kind === 'component' ? 'rootWork.activityComponent'
            : event.payload.kind === 'usage' ? 'rootWork.activityUsage' : 'rootWork.activityProgress')}
        </li>)}</ol>
      </details>}
    </div>
    {(active.length > 0 || pendingStop) && <Button variant='destructive' disabled={isLoading} onClick={async () => {
      const request = pendingStop ?? { expectedEpoch: snapshot.epoch, stopRequestId: snapshot.stopRequestId,
        ...(streamingConversationId === conversationId && streamingMessageId ? { foregroundMessageId: streamingMessageId } : {}) };
      const result = await stop(conversationId, request);
      if (result) setPendingStop(result.foregroundCancellationPending ? request : undefined);
      if (result && result.barrierEpoch > snapshot.epoch) {
        replay.current = appendRootWorkEvents(replay.current, result.barrierEpoch, []);
        setActivity(replay.current);
        setSnapshot((previous) => previous && previous.epoch < result.barrierEpoch
          ? { ...previous, epoch: result.barrierEpoch, jobs: [], watermark: '0' } : previous);
      } else if (result && observer.current) await refresh(observer.current.signal);
    }}>{t(pendingStop ? 'rootWork.retryCancellation' : 'rootWork.stopAll')}</Button>}
  </section>;
}

export function RootWorkPanel(props: { conversationId: string; creatorId: string }) {
  return <RootWorkPanelContent key={`${props.conversationId}:${props.creatorId}`} {...props} />;
}
