import { AUTH_STORAGE_KEYS, API_CONFIG } from '@/lib/api';
import type { StreamSSEEvent } from './types';
import { translateConversation } from './translation';

type StreamListener = (event: StreamSSEEvent) => void;

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

  connect(): void {
    if (this.isEvicted) return;
    if (this.eventSource) return; // Already connected or connecting

    const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    if (!token) {
      this.emit({ type: 'connection_failed', data: { reason: translateConversation('sse.connectionErrors.noToken') } });
      return;
    }

    const url = `${API_CONFIG.baseURL}/conversations/stream?token=${encodeURIComponent(token)}`;
    try {
      this.eventSource = new EventSource(url);
      this.setupEventHandlers();
    } catch (error) {
      console.error('[ConversationStream] Failed to create EventSource:', error);
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

  reconnectWithNewToken(): void {
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
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.eventSource = null;
        if (wasConnected) {
          this.scheduleReconnect();
        } else {
          this.emit({ type: 'connection_failed', data: { reason: translateConversation('sse.connectionErrors.rejected') } });
        }
      }
    };

    // NestJS SSE sends all events as generic messages with {type, data} payload
    this.eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const { type, data } = parsed;

        switch (type) {
          case 'connected':
            this.connectionId = data.connectionId;
            this.isConnected = true;
            this.resetHeartbeatTimer();
            this.emit({ type: 'connected', data });
            break;
          case 'heartbeat':
            this.resetHeartbeatTimer();
            break;
          case 'stream_start':
            this.emit({ type: 'stream_start', data });
            break;
          case 'stream_chunk':
            this.emit({ type: 'stream_chunk', data });
            break;
          case 'stream_complete':
            this.emit({ type: 'stream_complete', data });
            break;
          case 'stream_error':
            this.emit({ type: 'stream_error', data });
            break;
          case 'conversation_name_generated':
            this.emit({ type: 'conversation_name_generated', data });
            break;
          case 'message_created':
            this.emit({ type: 'message_created', data });
            break;
          case 'message_updated':
            this.emit({ type: 'message_updated', data });
            break;
          case 'mention_created':
            this.emit({ type: 'mention_created', data });
            break;
          case 'error':
            if (data?.code === 'TOO_MANY_TABS') {
              this.isEvicted = true;
              this.isConnected = false;
              this.emit({ type: 'error', data });
            }
            break;
        }
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
      this.scheduleReconnect();
    }, this.heartbeatTimeout);
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
