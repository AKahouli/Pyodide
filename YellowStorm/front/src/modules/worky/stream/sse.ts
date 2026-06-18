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
import { AUTH_STORAGE_KEYS, API_ENDPOINTS } from '@/lib/api/config';

export type WorkyEventHandler = (event: WorkyEvent) => void;
export type WorkyEventUnsubscribe = () => void;

interface SseConfig {
  baseURL: string;
  getAccessToken: () => string | null;
}

const defaultConfig: SseConfig = {
  baseURL: (() => {
    // The apiClient base includes `/api/v1`; strip it for the raw
    // SSE fetch so we can pass the full path explicitly.
    if (typeof window === 'undefined') return 'http://localhost:3000';
    const configured = (window as unknown as { __API_BASE__?: string }).__API_BASE__;
    return configured ?? `${window.location.origin}/api/v1`;
  })(),
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
  const token = config.getAccessToken();
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  void (async () => {
    try {
      const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      if (!res.ok || !res.body) {
        onEvent({
          type: 'stream.terminal',
          data: { error: true, source: 'sse-non-ok', status: res.status },
        });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventName = '';
      let dataLines: string[] = [];
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
            const type = (eventName as WorkyEventType) || 'stream.updated';
            onEvent({ type, data: parsed });
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
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      onEvent({
        type: 'stream.terminal',
        data: { error: true, source: 'sse-exception', message: (err as Error).message },
      });
    }
  })();
  return () => {
    controller.abort();
  };
}
