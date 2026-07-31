import { useEffect, useRef } from 'react';
import { conversationStreamService } from '../stream';
import { useConversationStore } from '../store';
import { useAuth } from '@/modules/auth';
import { useUsage } from '@/modules/usage/UsageContext';
import { normalizeChartComponentData } from '../utils';
import type { StreamSSEEvent, StreamingComponent } from '../types';

/**
 * Hook that connects the ConversationStreamService to the Zustand store.
 * Should be called on conversation pages where streaming is needed.
 */
export function useConversationStream() {
  const { isAuthenticated } = useAuth();
  const { fetchUsageStatus } = useUsage();
  const fetchUsageRef = useRef(fetchUsageStatus);
  fetchUsageRef.current = fetchUsageStatus;

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleVisibilityChange = () => {
      if (document.hidden) return;
      const store = useConversationStore.getState();
      void store.reconcilePendingStream();
      if (!conversationStreamService.getIsConnected()) {
        conversationStreamService.reconnectWithNewToken();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const unsubscribe = conversationStreamService.subscribe((event: StreamSSEEvent) => {
      const store = useConversationStore.getState();
      switch (event.type) {
        case 'connected':
          store.onSSEConnected();
          break;
        case 'connection_failed':
          store.onConnectionFailed(event.data.reason);
          break;
        case 'stream_start':
          store.onStreamStart(event.data);
          break;
        case 'stream_chunk':
          if (event.data?.component?.type === 'chart') {
            const normalizedData = normalizeChartComponentData(event.data.component.data);
            if (normalizedData) {
              event.data = {
                ...event.data,
                component: {
                  ...event.data.component,
                  data: normalizedData,
                } as StreamingComponent,
              };
            }
          }
          store.onStreamChunk(event.data);
          break;
        case 'stream_complete':
          store.onStreamComplete(event.data);
          fetchUsageRef.current();
          break;
        case 'stream_error':
          store.onStreamError(event.data);
          break;
        case 'conversation_name_generated':
          store.onConversationNameGenerated(event.data);
          break;
        case 'message_created':
          store.onMessageCreated(event.data);
          break;
        case 'message_updated':
          store.onMessageUpdated(event.data);
          break;
        case 'mention_created':
          store.onMentionCreated(event.data);
          break;
        }

    });

    // Subscribe before opening the pipe so its initial `connected` frame is observed.
    conversationStreamService.connect();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribe();
      conversationStreamService.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);
}
