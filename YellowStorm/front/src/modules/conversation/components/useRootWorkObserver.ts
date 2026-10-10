import { useCallback, useEffect } from 'react';
import type { ApiError } from '@/lib/api-error';
import { useApiAction } from '@/lib/use-api-action';
import { fetchRootWork, fetchRootWorkEvents } from '../api';
import { useConversationStore } from '../store';
import { useRootWorkStore } from '../rootWorkStore';
import { appendRootWorkEvents } from './root-work-replay';

/** Only the dock observes; the context pane subscribes to the same bounded state. */
export function useRootWorkObserver(conversationId: string, userId: string | undefined, enabled: boolean) {
  const onError = useCallback((error: ApiError) => {
    if (useRootWorkStore.getState().userId === userId && [403, 404].includes(error.statusCode)) useRootWorkStore.getState().clearConversation(conversationId);
  }, [conversationId, userId]);
  const { execute: fetch } = useApiAction(fetchRootWork, { showErrorToast: false, onError });
  const { execute: fetchEvents } = useApiAction(fetchRootWorkEvents, { showErrorToast: false });
  const revision = useRootWorkStore((state) => state.revision);
  useEffect(() => {
    if (!enabled) return;
    useRootWorkStore.getState().bindUser(userId ?? null);
    if (!userId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refreshedPublications = new Set<string>();
    const reconnect = () => useRootWorkStore.getState().refresh();
    window.addEventListener('online', reconnect);
    const current = () => !abort.signal.aborted && useRootWorkStore.getState().userId === userId;
    const poll = async () => {
      const snapshot = await fetch(conversationId, abort.signal);
      if (!current()) return;
      if (snapshot) {
        const state = useRootWorkStore.getState();
        const previous = state.activity[conversationId];
        if ((state.snapshots[conversationId]?.epoch ?? -1) <= snapshot.epoch) {
          state.update(conversationId, snapshot);
          const replay = appendRootWorkEvents(previous, snapshot.epoch, []);
          const events = await fetchEvents(conversationId, snapshot.epoch, replay.cursor, abort.signal);
          if (!current()) return;
          if (events) useRootWorkStore.getState().update(conversationId, snapshot, appendRootWorkEvents(replay, snapshot.epoch, events));
          const messages = useConversationStore.getState().messages;
          const missing = snapshot.jobs.flatMap((job) => job.publicationMessageId && !refreshedPublications.has(job.publicationMessageId)
            && !messages.some((message) => message.id === job.publicationMessageId) ? [job.publicationMessageId] : []);
          if (missing.length) {
            // Older results can remain outside the loaded page; hydrate once per observer/reconnect.
            missing.forEach((id) => refreshedPublications.add(id));
            await useConversationStore.getState().fetchMessages(conversationId);
          }
        }
      }
      if (current()) timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => { abort.abort(); clearTimeout(timer); window.removeEventListener('online', reconnect); };
  }, [conversationId, userId, enabled, fetch, fetchEvents, revision]);
}
