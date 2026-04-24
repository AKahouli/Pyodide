import { useEffect, useRef } from 'react';
import { conversationStreamService } from '../stream';
import { useConversationStore } from '../store';
import { useAuth } from '@/modules/auth';
import { useUsage } from '@/modules/usage';
import type { StreamSSEEvent } from '../types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeJsonParse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeChartComponent(component: unknown): unknown {
  if (!isObject(component) || component.type !== 'chart' || !isObject(component.data)) return component;

  const data = component.data;
  const normalizeArray = (value: unknown): unknown => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return value;

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : value;
    } catch {
      return value;
    }
  };

  return {
    ...component,
    data: {
      ...data,
      data: normalizeArray(data.data),
      chartData: normalizeArray(data.chartData),
      config: safeJsonParse(data.config),
      series: normalizeArray(data.series),
    },
  };
}

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

    conversationStreamService.connect();

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
            event.data = {
              ...event.data,
              component: normalizeChartComponent(event.data.component),
            };
            console.debug('[useConversationStream][stream_chunk][chart]', {
              action: event.data.action,
              id: event.data.component?.id,
              componentKeys: Object.keys(event.data.component || {}),
              data: event.data.component?.data,
              dataType: typeof event.data.component?.data,
              dataKeys: event.data.component?.data ? Object.keys(event.data.component.data) : [],
              chartData: event.data.component?.data?.chartData,
              chartDataLength: Array.isArray(event.data.component?.data?.chartData) ? event.data.component.data.chartData.length : 'not array',
              dataData: event.data.component?.data?.data,
              dataDataLength: Array.isArray(event.data.component?.data?.data) ? event.data.component.data.data.length : 'not array',
            });
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

    return () => {
      unsubscribe();
      conversationStreamService.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);
}
