import { API_CONFIG } from '@/lib/api/config';
import type { StreamSSEEvent } from './types';
import { translateConversation } from './translation';

type StreamListener = (event: StreamSSEEvent) => void;

function safeJsonParse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeChartPayload(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;

  const payload = data as Record<string, unknown>;
  return {
    ...payload,
    data: safeJsonParse(payload.data),
    chartData: safeJsonParse(payload.chartData),
    config: safeJsonParse(payload.config),
    series: safeJsonParse(payload.series),
  };
}

/**
 * ConversationStreamService - SSE-based streaming for AI responses.
 * Handles connection management, reconnection with exponential backoff,
 * and event distribution to subscribers.
 */
class ConversationStreamService {
  private eventSource: EventSource | null = null;
  private listeners: Set<StreamListener> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isConnected = false;
  private connectionId: string | null = null;
  private isEvicted = false;

  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelay = 1000;
  private readonly maxReconnectDelay = 60000;
  private readonly heartbeatTimeout = 30000;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionWaiters = new Set<(connected: boolean) => void>();

  connect(): void {
    if (this.isEvicted) return;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
      this.connectionId = null;
    }

    const url = `${API_CONFIG.baseURL}/conversations/stream`;
    try {
      this.eventSource = new EventSource(url, { withCredentials: true });
      this.setupEventHandlers();
    } catch (error) {
      console.error('[ConversationStream] Failed to create EventSource:', error);
      this.resolveConnectionWaiters(false);
      this.emit({ type: 'connection_failed', data: { reason: translateConversation('sse.connectionErrors.creationFailed') } });
    }
  }

  disconnect(): void {
    this.clearTimers();

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.isConnected = false;
    this.connectionId = null;
    this.reconnectAttempts = 0;
    this.resolveConnectionWaiters(false);
  }

  subscribe(listener: StreamListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  /** Wait briefly for the shared pipe before starting a new stream-producing request. */
  waitForConnection(timeoutMs = 2000): Promise<boolean> {
    if (this.isConnected) return Promise.resolve(true);

    return new Promise((resolve) => {
      let timeout: ReturnType<typeof setTimeout>;
      const settle = (connected: boolean) => {
        clearTimeout(timeout);
        this.connectionWaiters.delete(settle);
        resolve(connected);
      };

      this.connectionWaiters.add(settle);
      timeout = setTimeout(() => settle(false), timeoutMs);
      this.connect();
    });
  }

  reconnectWithNewToken(): void {
    this.clearTimers();
    this.eventSource?.close();
    this.eventSource = null;
    this.isConnected = false;
    this.connectionId = null;
    this.reconnectAttempts = 0;
    this.isEvicted = false;
    this.connect();
  }

  // ==================== Private Methods ====================

  private setupEventHandlers(): void {
    if (!this.eventSource) return;

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.eventSource.onerror = () => {
      const wasConnected = this.isConnected;
      this.isConnected = false;
      if (!this.eventSource) return;

      if (this.eventSource.readyState === EventSource.CONNECTING) {
        // Disable native retry because it reuses the original tokenized URL.
        this.eventSource.close();
      }
      if (this.eventSource.readyState === EventSource.CLOSED) {
        this.eventSource = null;
        if (wasConnected) this.scheduleReconnect();
        else {
          this.resolveConnectionWaiters(false);
          this.scheduleReconnect();
          this.emit({ type: 'connection_failed', data: { reason: translateConversation('sse.connectionErrors.rejected') } });
        }
      }
    };

    const namedEventTypes: StreamSSEEvent['type'][] = [
      'connected',
      'heartbeat',
      'stream_start',
      'stream_chunk',
      'stream_complete',
      'stream_error',
      'conversation_name_generated',
      'message_created',
      'message_updated',
      'mention_created',
      'error',
    ];
    for (const type of namedEventTypes) {
      this.eventSource.addEventListener(type, (rawEvent) => {
        const data = safeJsonParse((rawEvent as MessageEvent<string>).data);
        this.handleEvent(type, data);
      });
    }

    // Retain compatibility with deployments that wrap the type in a default event.
    this.eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        this.handleEvent(parsed.type, parsed.data);
      } catch (error) {
        console.error('[ConversationStream] Failed to parse SSE event:', error);
      }
    };
  }

  private resetHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
    }

    this.heartbeatTimer = setTimeout(() => {
      console.warn('[ConversationStream] Heartbeat timeout, reconnecting...');
      this.disconnect();
      if (typeof document !== 'undefined' && document.hidden) return;
      this.scheduleReconnect();
    }, this.heartbeatTimeout);
  }

  private handleEvent(type: StreamSSEEvent['type'], rawData: unknown): void {
    const data = (rawData && typeof rawData === 'object' ? rawData : {}) as Record<string, unknown>;
    switch (type) {
      case 'connected':
        this.connectionId = typeof data.connectionId === 'string' ? data.connectionId : null;
        this.isConnected = true;
        this.resolveConnectionWaiters(true);
        this.resetHeartbeatTimer();
        this.emit({ type, data: { connectionId: this.connectionId ?? '' } });
        break;
      case 'heartbeat':
        this.resetHeartbeatTimer();
        break;
      case 'stream_chunk':
        if (
          data.component &&
          typeof data.component === 'object' &&
          (data.component as { type?: string }).type === 'chart'
        ) {
          const component = data.component as { type: string; data?: unknown };
          data.component = {
            ...component,
            data: normalizeChartPayload(component.data),
          };
        }
        this.emit({ type, data } as unknown as StreamSSEEvent);
        break;
      case 'stream_start':
      case 'stream_complete':
      case 'stream_error':
      case 'conversation_name_generated':
      case 'message_created':
      case 'message_updated':
      case 'mention_created':
        this.resetHeartbeatTimer();
        this.emit({ type, data } as StreamSSEEvent);
        break;
      case 'error':
        if (data.code === 'TOO_MANY_TABS' || data.code === 'ERR_1405') {
          this.isEvicted = true;
          this.isConnected = false;
          this.eventSource?.close();
          this.eventSource = null;
          this.resolveConnectionWaiters(false);
          this.emit({ type, data: { code: String(data.code), message: typeof data.message === 'string' ? data.message : undefined } });
        }
        break;
      default:
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.isEvicted) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[ConversationStream] Max reconnection attempts reached');
      this.emit({ type: 'connection_failed', data: { reason: translateConversation('sse.connectionErrors.lost') } });
      return;
    }

    const delay = Math.min(this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);

    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private clearTimers(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private resolveConnectionWaiters(connected: boolean): void {
    for (const resolve of this.connectionWaiters) {
      resolve(connected);
    }
    this.connectionWaiters.clear();
  }

  private emit(event: StreamSSEEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ConversationStream] Listener error:', error);
      }
    }
  }
}

export const conversationStreamService = new ConversationStreamService();
