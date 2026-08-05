import { AUTH_STORAGE_KEYS, API_CONFIG } from '@/lib/api/config';
import type { AgentEvent, PipeEvent } from './interfaces';

type Listener = (event: PipeEvent) => void;
type ConnectionListener = () => void;

const EVENT_TYPES: AgentEvent['type'][] = [
  'message', 'tool', 'step', 'plan', 'title', 'done', 'wait', 'error', 'application_component',
];

/**
 * ConversationV2StreamService — the single, per-user SSE pipe.
 *
 * Mirrors the v1 `ConversationStreamService`: one EventSource for the whole
 * authenticated session (mounted at the app shell), with reconnect/backoff and
 * a heartbeat watchdog. It is NOT per-conversation — every conversation's
 * events arrive on this one connection, each tagged with its `sessionId`, and
 * the store routes them. Because the connection is never tied to a conversation
 * view, switching conversations never tears down a running stream.
 */
class ConversationV2StreamService {
  private eventSource: EventSource | null = null;
  private listeners = new Set<Listener>();
  private connectionListeners = new Set<ConnectionListener>();
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnected = false;

  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelay = 1000;
  private readonly maxReconnectDelay = 60000;
  private readonly heartbeatTimeout = 35000; // > server heartbeat (15s) + slack

  connect(): void {
    if (this.eventSource) return; // already connected/connecting

    const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    if (!token) return;

    const url = `${API_CONFIG.baseURL}/conversation-v2/stream?token=${encodeURIComponent(token)}`;
    try {
      this.eventSource = new EventSource(url);
      this.setupEventHandlers();
    } catch (err) {
      console.error('[ConversationV2Stream] Failed to create EventSource:', err);
    }
  }

  disconnect(): void {
    this.clearTimers();
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.isConnected = false;
    this.reconnectAttempts = 0;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  subscribeConnected(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  reconnectWithNewToken(): void {
    this.clearTimers();
    this.eventSource?.close();
    this.eventSource = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.connect();
  }

  // ==================== internals ====================

  private setupEventHandlers(): void {
    const es = this.eventSource;
    if (!es) return;

    es.addEventListener('connected', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.resetHeartbeatTimer();
      for (const listener of this.connectionListeners) listener();
    });

    es.addEventListener('heartbeat', () => {
      this.resetHeartbeatTimer();
    });

    EVENT_TYPES.forEach((type) => {
      es.addEventListener(type, (raw) => {
        const ev = raw as MessageEvent<string>;
        if (typeof ev.data !== 'string') return;
        this.resetHeartbeatTimer();
        try {
          const data = JSON.parse(ev.data) as Record<string, unknown>;
          // The server reuses `event: error` for connection-level rejections
          // (e.g. the SSE connection cap), which carry no `sessionId`. Those
          // aren't agent events — ignore them here; onerror handles transport.
          if (type === 'error' && typeof data.sessionId !== 'string') return;
          this.emit({ type, data });
        } catch {
          /* ignore malformed frame */
        }
      });
    });

    es.onopen = () => {
      this.reconnectAttempts = 0;
    };

    es.onerror = () => {
      const wasConnected = this.isConnected;
      this.isConnected = false;
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.eventSource = null;
        if (wasConnected) {
          this.scheduleReconnect();
        } else {
          // Initial connection rejected (e.g. bad token) — retry with backoff
          // too; a token refresh will eventually let it through.
          this.scheduleReconnect();
        }
      }
    };
  }

  private resetHeartbeatTimer(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      console.warn('[ConversationV2Stream] Heartbeat timeout, reconnecting...');
      this.disconnect();
      if (typeof document !== 'undefined' && document.hidden) return;
      this.scheduleReconnect();
    }, this.heartbeatTimeout);
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[ConversationV2Stream] Max reconnection attempts reached');
      return;
    }
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;
    this.reconnectTimeout = setTimeout(() => this.connect(), delay);
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

  private emit(event: PipeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[ConversationV2Stream] Listener error:', err);
      }
    }
  }
}

export const conversationV2StreamService = new ConversationV2StreamService();
