/**
 * Worky stream event SSE client. Uses `fetch` with a `ReadableStream`
 * reader to consume the `text/event-stream` response. This is
 * preferred over the native `EventSource` because it supports
 * custom headers (e.g. the JWT bearer token), which `EventSource`
 * does not.
 *
 * Each server-sent frame's `data:` line is JSON; we re-parse it
 * before handing the event to the registered handler. Multiple
 * `data:` lines per frame are joined with `\n` (canonical SSE).
 */
import type { WorkyEvent, WorkyEventType } from '../types';
import { AUTH_STORAGE_KEYS, API_CONFIG, API_ENDPOINTS } from '@/lib/api/config';

export type WorkyEventHandler = (event: WorkyEvent) => void;
export type WorkyEventUnsubscribe = () => void;

const MAX_RETRY_ATTEMPTS = 6;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;

interface SseConfig {
  baseURL: string;
  getAccessToken: () => string | null;
}

const defaultConfig: SseConfig = {
  baseURL: API_CONFIG.baseURL,
  getAccessToken: () => {
    try {
      return window.localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    } catch {
      return null;
    }
  },
};

export function subscribeToStreamEvents(
  streamId: string,
  onEvent: WorkyEventHandler,
  config: SseConfig = defaultConfig,
): WorkyEventUnsubscribe {
  const controller = new AbortController();
  const url = `${config.baseURL}${API_ENDPOINTS.worky.streamEvents(streamId)}`;
  let isStopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempts = 0;

  const buildHeaders = (): Record<string, string> => {
    const token = config.getAccessToken();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const shouldRetryStatus = (status: number): boolean => {
    return status >= 500 || status === 408 || status === 429;
  };

  const scheduleReconnect = (): boolean => {
    if (isStopped || controller.signal.aborted) return false;
    if (retryAttempts >= MAX_RETRY_ATTEMPTS) return false;
    if (retryTimer) clearTimeout(retryTimer);
    retryAttempts += 1;
    const delay = Math.min(
      RETRY_BASE_DELAY_MS * 2 ** (retryAttempts - 1),
      RETRY_MAX_DELAY_MS,
    );
    const jitteredDelay = Math.round(delay * (0.5 + Math.random() * 0.5));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, jitteredDelay);
    return true;
  };

  const emitTerminal = (data: Record<string, unknown>): void => {
    if (isStopped) return;
    onEvent({ type: 'stream.terminal', data: { ...data, error: true } });
  };

  const connect = async (): Promise<void> => {
    if (isStopped || controller.signal.aborted) return;
    try {
      const res = await fetch(url, { method: 'GET', headers: buildHeaders(), signal: controller.signal });
      if (!res.ok || !res.body) {
        if (!shouldRetryStatus(res.status) || !scheduleReconnect()) {
          emitTerminal({ source: 'sse-non-ok', status: res.status });
        }
        return;
      }
      retryAttempts = 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventName = '';
      let dataLines: string[] = [];
      let shouldReconnect = true;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const raw of lines) {
          const line = raw.replace(/\r$/, '');
          if (line === '') {
            if (dataLines.length === 0 && !eventName) continue;
            const data = dataLines.join('\n');
            let parsed: Record<string, unknown> = {};
            try {
              parsed = data ? (JSON.parse(data) as Record<string, unknown>) : {};
            } catch {
              parsed = { raw: data };
            }
            if (eventName === 'error') {
              shouldReconnect = false;
              emitTerminal({ source: 'sse-error-frame', ...parsed });
            } else {
              // The backend (NestJS @Sse) serializes each frame as
              // `data: {type, data}` WITHOUT an SSE `event:` name line, so
              // `eventName` is empty and the real type/payload are nested inside
              // `parsed`. Unwrap them so typed handlers route correctly — without
              // this, every event fell through to the 'stream.updated' default
              // and e.g. `stream.terminal` never cleared the working flag / Stop
              // button. Only unwrap when there's no explicit event name AND
              // `parsed.type` is a string (the wrapped shape); a named frame's
              // payload is used as-is (its own `type` field is payload data).
              const wrappedType =
                !eventName && typeof (parsed as { type?: unknown }).type === 'string'
                  ? ((parsed as { type: string }).type as WorkyEventType)
                  : null;
              const type = (eventName as WorkyEventType) || wrappedType || 'stream.updated';
              const eventData = wrappedType
                ? ((parsed as { data?: Record<string, unknown> }).data ?? {})
                : parsed;
              onEvent({ type, data: eventData });
            }
            eventName = '';
            dataLines = [];
            continue;
          }
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) {
            eventName = line.slice('event:'.length).trim();
            continue;
          }
          if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trimStart());
          }
        }
      }
      if (shouldReconnect) scheduleReconnect();
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      if (!scheduleReconnect()) {
        emitTerminal({ source: 'sse-exception', message: (err as Error).message });
      }
    }
  };

  void (async () => {
    await connect();
  })();
  return () => {
    isStopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    controller.abort();
  };
}
