import { AUTH_STORAGE_KEYS, API_CONFIG } from '@/lib/api/config';
import type { StreamSSEEvent } from './types';
import { translateConversation } from './translation';

type StreamListener = (event: StreamSSEEvent) => void;

/**
 * Mirrors the backend replay-cursor shape (`<bootId>:<generation>:<seq>`;
 * two-segment legacy cursors from an older backend are still accepted so a
 * mixed deployment keeps resuming). Native SSE `lastEventId` values that
 * don't match (e.g. the server's auto-assigned heartbeat counters) must never
 * be stored as a cursor. The cursor stays opaque here: parsing happens
 * server-side, which rejects a foreign namespace or generation with an
 * explicit `stream_resync_required`.
 */
const REPLAY_CURSOR_SHAPE = /^[A-Za-z0-9_-]{1,100}(?::[0-9]{1,15}){1,2}$/;

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
  private connectionToken: string | null = null;
  private isEvicted = false;
  /**
   * Last replay cursor received from the server. Sent back on reconnect so
   * the server can replay events missed while disconnected.
   */
  private lastSeenCursor: string | null = null;

  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelay = 1000;
  private readonly maxReconnectDelay = 60000;
  private readonly heartbeatTimeout = 30000;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    if (this.isEvicted) return;

    const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    if (!token) {
      this.emit({ type: 'connection_failed', data: { reason: translateConversation('sse.connectionErrors.noToken') } });
      return;
    }

    if (this.eventSource && this.connectionToken === token) return;
    if (this.eventSource) {
      // Another singleton may have refreshed the shared token. Never let the
      // browser keep retrying an EventSource URL carrying the revoked token.
      // The cursor belongs to the previous identity context — drop it.
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
      this.connectionId = null;
      this.lastSeenCursor = null;
    }

    const cursorParam = this.lastSeenCursor ? `&cursor=${encodeURIComponent(this.lastSeenCursor)}` : '';
    const url = `${API_CONFIG.baseURL}/conversations/stream?token=${encodeURIComponent(token)}${cursorParam}`;
    try {
      this.eventSource = new EventSource(url);
      this.connectionToken = token;
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
    this.connectionToken = null;
    this.lastSeenCursor = null;
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

  /**
   * Non-blocking nudge for the send path. POST must never wait on the SSE
   * handshake: the server replays whatever the connecting pipe misses.
   * A no-op when the shared pipe is already connected.
   */
  ensureConnected(): void {
    if (this.isEvicted) return;
    this.connect();
  }

  reconnectWithNewToken(): void {
    this.clearTimers();
    this.eventSource?.close();
    this.eventSource = null;
    this.isConnected = false;
    this.connectionId = null;
    this.connectionToken = null;
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
        this.connectionToken = null;
        if (wasConnected) this.scheduleReconnect();
        else {
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
      'stream_resync_required',
      'error',
    ];
    for (const type of namedEventTypes) {
      this.eventSource.addEventListener(type, (rawEvent) => {
        const data = safeJsonParse((rawEvent as MessageEvent<string>).data);
        const payloadCursor = (data as { id?: unknown } | null)?.id;
        this.captureReplayCursor(
          typeof payloadCursor === 'string' ? payloadCursor : (rawEvent as MessageEvent<string>).lastEventId,
        );
        this.handleEvent(type, data);
      });
    }

    // Retain compatibility with deployments that wrap the type in a default event.
    this.eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        this.captureReplayCursor(parsed?.id);
        this.handleEvent(parsed.type, parsed.data);
      } catch (error) {
        console.error('[ConversationStream] Failed to parse SSE event:', error);
      }
    };
  }

  /**
   * The replay cursor reaches the client in the frame payload (`id` field of
   * the JSON body): the global response envelope re-wraps SSE frames, so the
   * wire carries only auto-numbered `id:` lines and the real cursor survives
   * inside the serialized frame. On deployments without that envelope the
   * native `lastEventId` carries it instead. Both sources are accepted only
   * when they match the cursor shape.
   */
  private captureReplayCursor(raw: unknown): void {
    if (typeof raw === 'string' && REPLAY_CURSOR_SHAPE.test(raw)) {
      this.lastSeenCursor = raw;
    }
  }

  private resetHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
    }

    this.heartbeatTimer = setTimeout(() => {
      console.warn('[ConversationStream] Heartbeat timeout, reconnecting...');
      this.teardownForReconnect();
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
      case 'stream_resync_required':
        this.resetHeartbeatTimer();
        this.emit({ type, data } as StreamSSEEvent);
        break;
      case 'error':
        if (data.code === 'TOO_MANY_TABS' || data.code === 'ERR_1405') {
          this.isEvicted = true;
          this.isConnected = false;
          this.eventSource?.close();
          this.eventSource = null;
          this.connectionToken = null;
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

  /**
   * Tear the pipe down for an error-driven reconnect (heartbeat timeout)
   * while keeping the replay cursor: the server replays whatever this pipe
   * missed while it was dead. Only explicit disconnect() drops the cursor.
   */
  private teardownForReconnect(): void {
    this.clearTimers();
    this.eventSource?.close();
    this.eventSource = null;
    this.isConnected = false;
    this.connectionId = null;
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
