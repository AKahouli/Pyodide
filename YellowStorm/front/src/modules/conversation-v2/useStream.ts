import { useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConversationV2Store } from './store';
import { conversationV2Api } from './api';
import type { AgentEvent } from './types';
import { AUTH_STORAGE_KEYS, API_CONFIG } from '@/lib/api';

const EVENT_TYPES: AgentEvent['type'][] = [
  'message', 'tool', 'step', 'plan', 'title', 'done', 'wait', 'error',
];

export function useConversationV2Stream() {
  const esRef = useRef<EventSource | null>(null);
  const { sessionId, handleEvent, setStreaming } = useConversationV2Store(
    useShallow((s) => ({
      sessionId: s.sessionId,
      handleEvent: s.handleEvent,
      setStreaming: s.setStreaming,
    })),
  );

  // Close any active stream when the active session changes or the hook unmounts.
  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [sessionId]);

  const attachListeners = useCallback(
    (es: EventSource, onComplete: () => void) => {
      EVENT_TYPES.forEach((type) => {
        es.addEventListener(type, (raw) => {
          const ev = raw as MessageEvent<string>;
          // EventSource fires a built-in `error` event (a plain Event, not a
          // MessageEvent) for connection problems — it has no `data`. Bail so
          // we don't crash on ev.data.slice; es.onerror below handles connection
          // failures via the proper teardown path.
          if (typeof ev.data !== 'string') return;
          try {
            const data = JSON.parse(ev.data) as Record<string, unknown> & {
              sequence?: number;
            };
            const event = { type, ...data } as AgentEvent;
            const seq = data.sequence;
            const currentLastSeq = useConversationV2Store.getState().lastSequence;
            if (
              typeof seq === 'number' &&
              seq > currentLastSeq + 1 &&
              sessionId
            ) {
              const fillFrom = currentLastSeq;
              const sid = sessionId;
              (async () => {
                let cursor = fillFrom;
                // Paginate up to the triggering event so an extra-large gap
                // (e.g., > backend cap of 500) is fully recovered.
                while (cursor < seq - 1) {
                  try {
                    const { items, nextSince } = await conversationV2Api.listEvents(sid, cursor, 200);
                    if (items.length === 0) break;
                    for (const e of items) handleEvent(e);
                    if (nextSince === cursor) break;
                    cursor = nextSince;
                  } catch {
                    return; // next event will trigger another attempt
                  }
                }
                handleEvent(event);
              })();
            } else {
              handleEvent(event);
            }
            if (type === 'done' || type === 'error') {
              es.close();
              setStreaming(false);
              onComplete();
            }
          } catch {
            /* ignore malformed frame */
          }
        });
      });
      es.onerror = () => {
        setStreaming(false);
        es.close();
        onComplete();
      };
    },
    [handleEvent, sessionId, setStreaming],
  );

  const send = useCallback(
    (message: string, model?: string) => {
      if (!sessionId) return;
      esRef.current?.close();

      // Optimistically echo the user message under a client-generated id so
      // the bubble appears instantly and stays positioned BEFORE any AI
      // events. The backend persists the same event_id (passed below as
      // `clientEventId`) and emits it via SSE — the store's `message` case
      // upserts by event_id, so the persisted version replaces this
      // optimistic one rather than duplicating it.
      const clientEventId = crypto.randomUUID();
      handleEvent({
        type: 'message',
        event_id: clientEventId,
        timestamp: Math.floor(Date.now() / 1000),
        role: 'user',
        content: message,
        attachments: [],
      });

      const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken) ?? '';
      const params = new URLSearchParams({ token, message });
      // Forward `model` only when the user actually picked one; absent → AI
      // service uses its own default. Match SendMessageQueryDto on the backend.
      if (model) params.set('model', model);
      params.set('clientEventId', clientEventId);
      const url = `${API_CONFIG.baseURL}/conversation-v2/sessions/${sessionId}/stream?${params.toString()}`;
      const es = new EventSource(url);
      esRef.current = es;
      setStreaming(true);

      attachListeners(es, () => {
        esRef.current = null;
      });
    },
    [sessionId, handleEvent, setStreaming, attachListeners],
  );

  const openLive = useCallback(() => {
    if (!sessionId) return;
    esRef.current?.close();
    const since = useConversationV2Store.getState().lastSequence;
    const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken) ?? '';
    const params = new URLSearchParams({ token, since: String(since) });
    const url = `${API_CONFIG.baseURL}/conversation-v2/sessions/${sessionId}/stream/live?${params.toString()}`;
    const es = new EventSource(url);
    esRef.current = es;
    setStreaming(true);
    attachListeners(es, () => {
      esRef.current = null;
    });
  }, [sessionId, setStreaming, attachListeners]);

  return { send, openLive };
}
