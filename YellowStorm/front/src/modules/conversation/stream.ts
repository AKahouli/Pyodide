import { API_CONFIG } from '@/lib/api/config';
import { getAccessToken } from '@/lib/api/access-token-store';
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
  private eventSource: AbortController | null = null;
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

    const token = getAccessToken();
    if (!token) {
      this.disconnect();
      this.emit({ type: 'connection_failed', data: { reason: translateConversation('sse.connectionErrors.noToken') } });
      return;
    }

    if (this.eventSource && this.connectionToken === token) return;
    if (this.eventSource) {
      // Another singleton may have refreshed the shared token. Never let the
      // stream keep running with a revoked token.
      // The cursor belongs to the previous identity context — drop it.
      this.eventSource.abort();
      this.eventSource = null;
      this.isConnected = false;
      this.connectionId = null;
      this.lastSeenCursor = null;
    }

    const cursorParam = this.lastSeenCursor ? `?cursor=${encodeURIComponent(this.lastSeenCursor)}` : '';
    const url = `${API_CONFIG.baseURL}/conversations/stream${cursorParam}`;
    const controller = new AbortController();
    this.eventSource = controller;
    this.connectionToken = token;
    void this.readStream(url, token, controller);
  }

  disconnect(): void {
    this.clearTimers();

    if (this.eventSource) {
      this.eventSource.abort();
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
    // Refreshes within the same authenticated session can resume; a session
    // replacement must never carry the previous actor's cursor.
    const identity = (token: string | null): string | null => {
      try {
        const payload = JSON.parse(atob((token ?? '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: unknown; sessionId?: unknown };
        return typeof payload.sub === 'string' ? `${payload.sub}:${String(payload.sessionId ?? '')}` : null;
      } catch { return null; }
    };
    const previous = identity(this.connectionToken);
    const next = identity(getAccessToken());
    if (previous && previous !== next) this.lastSeenCursor = null;
    this.clearTimers();
    this.eventSource?.abort();
    this.eventSource = null;
    this.isConnected = false;
    this.connectionId = null;
    this.connectionToken = null;
    this.reconnectAttempts = 0;
    this.isEvicted = false;
    this.connect();
  }

  // ==================== Private Methods ====================

  private async readStream(url: string, token: string, controller: AbortController): Promise<void> {
    const current = () => this.eventSource === controller && !controller.signal.aborted;
    const active = () => current() && getAccessToken() === token;
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!active()) return;
      if (response.status === 401) {
        // Reuse the shared refresh lock/subscriber queue; it reconnects this
        // singleton after success. Lazy import avoids the client's stream import cycle.
        const { refreshAccessToken } = await import('@/lib/api/client');
        if (!active()) return;
        await refreshAccessToken(token);
        return;
      }
      if (!response.ok || !response.body ||
          !response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error('SSE response unavailable');
      }
      this.reconnectAttempts = 0;
      this.resetHeartbeatTimer();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventName = '';
      let eventId = '';
      let dataLines: string[] = [];
      let frameLength = 0;
      const line = (raw: string) => {
        frameLength += raw.length + 1;
        if (frameLength > 1100000) throw new Error('SSE frame limit exceeded');
        if (raw === '') {
          if (dataLines.length) {
            const parsed = safeJsonParse(dataLines.join('\n'));
            const payload = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
            this.captureReplayCursor(typeof payload.id === 'string' ? payload.id : eventId);
            const type = eventName || payload.type;
            if (typeof type === 'string') {
              this.handleEvent(type as StreamSSEEvent['type'], eventName ? parsed : payload.data);
            }
          }
          eventName = '';
          dataLines = [];
          frameLength = 0;
          return;
        }
        if (raw.startsWith(':')) return;
        const colon = raw.indexOf(':');
        const field = colon < 0 ? raw : raw.slice(0, colon);
        let value = colon < 0 ? '' : raw.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') eventName = value;
        if (field === 'data') dataLines.push(value);
        if (field === 'id' && !value.includes('\0')) eventId = value;
      };
      try {
        while (active()) {
          const { value, done } = await reader.read();
          if (!active() || done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 1100000) throw new Error('SSE frame limit exceeded');
          // Preserve a trailing CR until its possible LF arrives in the next chunk.
          let match: RegExpExecArray | null;
          while ((match = /\r\n|\r(?!$)|\n/.exec(buffer))) {
            line(buffer.slice(0, match.index));
            buffer = buffer.slice(match.index + match[0].length);
            if (!active()) break;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch {
      // No token, URL, provider content or raw transport error in diagnostics.
    } finally {
      if (current()) {
        if (getAccessToken() !== token) this.lastSeenCursor = null;
        this.teardownForReconnect();
        this.scheduleReconnect();
      }
    }
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
        if (type === 'stream_resync_required') {
          // The server proved it cannot replay from this cursor (stale boot,
          // swept window, overload). Keeping it would re-trigger the resync on
          // every reconnect; the store reconciles canonical state instead, so
          // the next connection must start cursor-less.
          this.lastSeenCursor = null;
        }
        this.resetHeartbeatTimer();
        this.emit({ type, data } as StreamSSEEvent);
        break;
      case 'error':
        if (data.code === 'TOO_MANY_TABS' || data.code === 'ERR_1405') {
          this.clearTimers();
          this.isEvicted = true;
          this.isConnected = false;
          this.eventSource?.abort();
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
    if (this.isEvicted || this.reconnectTimeout) return;

    const delay = Math.min(this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);

    // Retry indefinitely: a backend restart can outlast any finite attempt
    // budget. The counter only shapes the backoff curve and stops growing at
    // the cap, so a late recovery resets to fast retries via onopen.
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
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
    this.eventSource?.abort();
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
