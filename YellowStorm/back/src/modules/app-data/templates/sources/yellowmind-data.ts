/**
 * YellowMind App Data client for generated React/Vite apps.
 *
 * The Nodepod service worker intercepts all fetch calls from the preview.
 * It strips POST/PATCH request bodies when forwarding to the backend.
 * This client bypasses the SW via two proxy transports:
 *  - postMessage to window.parent (when running inside the preview iframe)
 *  - BroadcastChannel (when the preview is opened in a new browser tab)
 */
import { ymDiag } from '@/lib/ym-diag';

const baseUrl = import.meta.env.VITE_YM_APP_DATA_URL as string | undefined;
const appDataId = import.meta.env.VITE_YM_APP_DATA_ID as string | undefined;
const environment = (import.meta.env.VITE_YM_APP_DATA_ENV as string | undefined) ?? 'dev';

const proxyEnabled = import.meta.env.VITE_YM_APP_DATA_PROXY === 'true' && typeof window !== 'undefined';
const inIframe = proxyEnabled && window.parent !== window;
const inNewTab = proxyEnabled && window.parent === window;

ymDiag.debug('data', 'client module loaded', {
  hasBaseUrl: Boolean(baseUrl),
  hasAppDataId: Boolean(appDataId),
  environment,
  proxyEnabled,
  inIframe,
  inNewTab,
});

function compactRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function assertNonEmptyRow(row: Record<string, unknown>, action: string): void {
  if (Object.keys(row).length === 0) {
    throw new Error(
      `App Data ${action}: row is empty. Map form fields to schema column names exactly (undefined values are omitted from JSON).`,
    );
  }
}

function requireConfig() {
  if (!baseUrl || !appDataId) {
    throw new Error(
      'App data is not ready yet. Wait a moment and try again, or refresh the preview.',
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), appDataId, environment };
}

let proxyIdCounter = 0;
let broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel {
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel('ym-app-data-proxy');
  }
  return broadcastChannel;
}

function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const id = `ym-${++proxyIdCounter}-${Date.now()}`;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(
        inNewTab
          ? 'App Data proxy timeout (30 s). Keep the YellowStorm tab open — the proxy runs there.'
          : 'App Data proxy timeout (30 s). Is the preview panel open?',
      ));
    }, 30_000);

    const payload = {
      type: 'ym-app-data-fetch',
      id,
      url,
      method: init?.method || 'GET',
      headers: init?.headers || undefined,
      body: init?.body || undefined,
    };

    function onResponse(data: Record<string, unknown>) {
      if (data?.type !== 'ym-app-data-response' || data.id !== id) return;
      cleanup();
      if (data.error) {
        reject(new Error(data.error as string));
        return;
      }
      const headers = new Headers((data.headers as Record<string, string>) || {});
      resolve(new Response((data.body as string) ?? '', { status: (data.status as number) ?? 200, headers }));
    }

    let cleanup: () => void;

    if (inIframe) {
      const handler = (event: MessageEvent) => onResponse(event.data);
      window.addEventListener('message', handler);
      cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', handler); };
      window.parent.postMessage(payload, '*');
    } else {
      const bc = getBroadcastChannel();
      const handler = (event: MessageEvent) => onResponse(event.data);
      bc.addEventListener('message', handler);
      cleanup = () => { clearTimeout(timeout); bc.removeEventListener('message', handler); };
      bc.postMessage(payload);
    }
  });
}

async function appDataFetch(url: string, init?: RequestInit): Promise<Response> {
  if (proxyEnabled) return proxyFetch(url, init);
  return fetch(url, init);
}

async function request(
  method: string,
  table: string,
  options?: { id?: string; body?: Record<string, unknown>; query?: Record<string, string> },
) {
  const started = performance.now();
  const cfg = requireConfig();
  const query = options?.query ? `?${new URLSearchParams(options.query).toString()}` : '';
  const path = options?.id
    ? `${cfg.baseUrl}/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(options.id)}`
    : `${cfg.baseUrl}/tables/${encodeURIComponent(table)}/rows${query}`;
  const body = options?.body ? compactRow(options.body) : undefined;
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  // Dev preview: no app token — the preview relay attributes calls to the
  // workspace owner via its injected data ticket. A stale token here would
  // be rejected with "Invalid token".
  const token =
    typeof window !== 'undefined' && !import.meta.env.DEV
      ? sessionStorage.getItem('ym_app_auth_token')
      : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  ymDiag.info('data', `${method} ${table}`, {
    table,
    method,
    hasId: Boolean(options?.id),
    bodyKeys: body ? Object.keys(body) : [],
    proxy: proxyEnabled,
    hasAuthHeader: Boolean(token),
  });

  try {
    const res = await appDataFetch(path, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      ymDiag.error('data', 'non-JSON response', {
        table,
        method,
        status: res.status,
        contentType,
        ms: Math.round(performance.now() - started),
      });
      throw new Error(
        `App Data expected JSON but received ${contentType || 'unknown content-type'} (status ${res.status}).`,
      );
    }
    let payload: unknown;
    try { payload = JSON.parse(text); } catch {
      ymDiag.error('data', 'invalid JSON', { table, method, status: res.status });
      throw new Error(`App Data response was not valid JSON (status ${res.status})`);
    }
    if (!res.ok) {
      let message = `App Data ${method} failed (${res.status})`;
      if (payload && typeof payload === 'object' && payload !== null) {
        const w = payload as { error?: { message?: unknown }; message?: unknown };
        if (w.error?.message) message = String(w.error.message);
        else if (w.message) message = String(w.message);
      }
      ymDiag.warn('data', 'request failed', {
        table,
        method,
        status: res.status,
        message,
        ms: Math.round(performance.now() - started),
      });
      throw new Error(message);
    }
    ymDiag.debug('data', 'request ok', {
      table,
      method,
      status: res.status,
      ms: Math.round(performance.now() - started),
    });
    return payload;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('App Data')) throw err;
    ymDiag.error('data', 'request error', {
      table,
      method,
      message: err instanceof Error ? err.message : String(err),
      ms: Math.round(performance.now() - started),
    });
    throw err;
  }
}

export async function insert(table: string, row: Record<string, unknown>) {
  const payload = compactRow(row);
  assertNonEmptyRow(payload, 'insert');
  const data = (await request('POST', table, { body: payload })) as { row: Record<string, unknown> };
  return data.row;
}

export async function list(table: string, query?: Record<string, string>) {
  const data = (await request('GET', table, { query })) as { rows?: unknown[] } | null;
  return { rows: data?.rows ?? [], ...(data ?? {}) };
}

export async function get(table: string, id: string) {
  return request('GET', table, { id });
}

export async function update(table: string, id: string, patch: Record<string, unknown>) {
  const payload = compactRow(patch);
  assertNonEmptyRow(payload, 'update');
  const data = (await request('PATCH', table, { id, body: payload })) as { row: Record<string, unknown> };
  return data.row;
}

export async function remove(table: string, id: string) {
  const data = (await request('DELETE', table, { id })) as { row: Record<string, unknown> };
  return data.row;
}

export default { insert, list, get, update, remove };
