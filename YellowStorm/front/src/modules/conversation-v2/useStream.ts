import { useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConversationV2Store } from './store';
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

  const send = useCallback(
    (message: string) => {
      if (!sessionId) return;
      esRef.current?.close();

      handleEvent({
        type: 'message',
        event_id: crypto.randomUUID(),
        timestamp: Date.now(),
        role: 'user',
        content: message,
        attachments: [],
      });

      const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken) ?? '';
      const params = new URLSearchParams({ token, message });
      const url = `${API_CONFIG.baseURL}/conversation-v2/sessions/${sessionId}/stream?${params.toString()}`;
      const es = new EventSource(url);
      esRef.current = es;
      setStreaming(true);

      EVENT_TYPES.forEach((type) => {
        es.addEventListener(type, (raw) => {
          const ev = raw as MessageEvent<string>;
          try {
            const data = JSON.parse(ev.data);
            const event = { type, ...data } as AgentEvent;
            handleEvent(event);
            if (type === 'done' || type === 'error') {
              es.close();
              setStreaming(false);
            }
          } catch {
            /* ignore malformed frame */
          }
        });
      });

      es.onerror = () => {
        setStreaming(false);
        es.close();
      };
    },
    [sessionId, handleEvent, setStreaming],
  );

  return { send };
}
