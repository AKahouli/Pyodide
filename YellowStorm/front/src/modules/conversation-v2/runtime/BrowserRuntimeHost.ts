import { conversationV2Api } from '../api';
import { appRuntimeEnabled } from '../features';
import { useConversationV2Store } from '../store';
import type { FilesTreeNode } from '../types';
import { API_CONFIG } from '@/lib/api/config';
import { getModels } from '@/modules/models/api';
import { BrowserRuntimeClient } from './BrowserRuntimeClient';
import { RevisionHydrator, type VfsFiles } from './RevisionHydrator';
import { NodepodRuntimeAdapter, invalidateSession } from './NodepodRuntimeAdapter';
import { PreviewController } from './PreviewController';
import { dispatchTool, MUTATING_TOOLS, type ToolContext } from './RuntimeToolHandlers';
import { ToolError } from './ToolError';
import { WorkspaceRevisionStore } from './WorkspaceRevisionStore';
import { NODEPOD_CAPABILITIES } from './RuntimeCapabilities';
import {
  RuntimeErrorCodes,
  type RuntimeHostStatus,
  type ToolInvokePayload,
  type RuntimeRehydratePayload,
  type RuntimeTicketResponse,
} from './runtime.types';

const LOG = '[BrowserRuntimeHost]';
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 2_000;
const HIDDEN_IFRAME_LOAD_MS = 4_000;
/** Catalog lookup can lag briefly after yellowappdata_provision. */
const APP_DATA_ENV_REFRESH_ATTEMPTS = 5;
const APP_DATA_ENV_REFRESH_DELAY_MS = 400;
const INSPECTOR_ATTACH_POLL_MS = 250;
const INSPECTOR_ATTACH_ATTEMPTS = 8;
const HIDDEN_IFRAME_STYLE =
  'position:fixed;width:640px;height:480px;opacity:0;pointer-events:none;left:-10000px;top:0;border:0';
const HIDDEN_IFRAME_SANDBOX =
  'allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts';

let appDataFetchProxyInstalled = false;
let aiFetchProxyInstalled = false;

interface AppDataRelayPeer {
  source: WindowProxy;
  origin: string;
}

/**
 * Preview iframe windows the module-level relay may serve, each paired with
 * the preview origin it was registered for. A `ym-app-data-fetch` message is
 * only relayed when `event.source` matches a registered peer AND `event.origin`
 * equals that peer's origin — so an embedding page or sibling iframe can never
 * borrow the owner data ticket.
 */
const appDataRelayPeers: AppDataRelayPeer[] = [];

export function registerAppDataRelayFrame(source: WindowProxy, origin: string | null): void {
  const existing = appDataRelayPeers.findIndex((p) => p.source === source);
  if (existing === -1) appDataRelayPeers.push({ source, origin: origin ?? '' });
  else appDataRelayPeers[existing].origin = origin ?? '';
}

export function updateAppDataRelayFrameOrigin(source: WindowProxy, origin: string | null): void {
  registerAppDataRelayFrame(source, origin);
}

export function unregisterAppDataRelayFrame(source: WindowProxy): void {
  const index = appDataRelayPeers.findIndex((p) => p.source === source);
  if (index !== -1) appDataRelayPeers.splice(index, 1);
}

/** http(s) origin of a relayable sender, or null when unusable (e.g. 'null'). */
function validateRelayOrigin(origin: unknown): string | null {
  if (typeof origin !== 'string' || origin === 'null') return null;
  if (!origin.startsWith('http://') && !origin.startsWith('https://')) return null;
  return origin;
}

function isTrustedAppDataRelaySource(source: WindowProxy | null, origin: string): boolean {
  return appDataRelayPeers.some((p) => p.source === source && p.origin === origin);
}

/**
 * Resolves the owner's App Data data ticket for relayed preview requests,
 * **keyed by appDataId** so two concurrently open previews can never swap
 * tickets (the microservice binds each ticket to its appDataId — a swapped
 * one fails with 403 "Token binding mismatch"). Registered by the active
 * host (start()); the module-level relay stays install-once.
 */
type AppDataTicketFetcher = (appDataId: string, force?: boolean, env?: string) => Promise<string | null>;
let appDataTicketFetcher: AppDataTicketFetcher | null = null;

export function setAppDataTicketFetcher(fetcher: AppDataTicketFetcher | null): void {
  appDataTicketFetcher = fetcher;
}

type AiPreviewTicketFetcher = (force?: boolean) => Promise<string | null>;
let aiPreviewTicketFetcher: AiPreviewTicketFetcher | null = null;

export function setAiPreviewTicketFetcher(fetcher: AiPreviewTicketFetcher | null): void {
  aiPreviewTicketFetcher = fetcher;
}

/** appDataId from a data-plane URL (`/v1/apps/{id}/…` or legacy gateway). */
export function appDataIdFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url, window.location.href).pathname;
    const m =
      pathname.match(/\/v1\/apps\/([^/]+)/) || pathname.match(/\/app-data\/public\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export function isAppDataPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    // Gateway shape (monolith + remote proxy controllers) and the direct
    // app-data microservice data plane (`/v1/apps/:appDataId/:env/...`,
    // including its `/auth` subtree).
    return (
      parsed.pathname.includes('/app-data/public/') || parsed.pathname.startsWith('/v1/apps/')
    );
  } catch {
    return false;
  }
}

/** Only AI Proxy chat/models paths under the YellowStorm API base. */
export function isAiProxyUrl(url: string): boolean {
  try {
    const resolved = resolveAiProxyFetchUrlUnchecked(url);
    if (!resolved) return false;
    const parsed = new URL(resolved);
    const path = parsed.pathname.replace(/\/$/, '') || '/';
    return path.endsWith('/chat/completions') || /(?:^|\/)(?:api\/)?v1\/models(\/|$)/.test(path);
  } catch {
    return false;
  }
}

/**
 * Absolutize a relayed AI URL against API_CONFIG.baseURL for the parent fetch.
 * Root-relative `/api/v1/...` must resolve against the API **origin** only — joining
 * against a base that already ends in `/api/v1` yields `/api/v1/api/v1/...`.
 */
export function resolveAiProxyFetchUrl(url: string): string | null {
  const resolved = resolveAiProxyFetchUrlUnchecked(url);
  if (!resolved) return null;
  try {
    const path = new URL(resolved).pathname.replace(/\/$/, '') || '/';
    if (!path.endsWith('/chat/completions') && !/(?:^|\/)(?:api\/)?v1\/models(\/|$)/.test(path)) {
      return null;
    }
    const base = API_CONFIG.baseURL.replace(/\/$/, '');
    if (/^https?:\/\//i.test(base) && /^https?:\/\//i.test(url.trim())) {
      if (new URL(resolved).origin !== new URL(base).origin) return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

function collapseDuplicateApiV1(pathname: string): string {
  return pathname.replace(/(\/api\/v1)+/g, '/api/v1');
}

function resolveAiProxyFetchUrlUnchecked(url: string): string | null {
  try {
    const trimmed = (url || '').trim();
    if (!trimmed) return null;
    const base = API_CONFIG.baseURL.replace(/\/$/, '');
    const baseIsHttp = /^https?:\/\//i.test(base);
    const apiOrigin = baseIsHttp ? new URL(base).origin : 'http://localhost:3000';
    const basePath = baseIsHttp
      ? new URL(base).pathname.replace(/\/$/, '') || '/api/v1'
      : '/api/v1';

    let parsed: URL;
    if (/^https?:\/\//i.test(trimmed)) {
      parsed = new URL(trimmed);
    } else if (trimmed.startsWith('/')) {
      // `/api/v1/chat/completions` or `/chat/completions` — origin only
      parsed = new URL(trimmed, `${apiOrigin}/`);
    } else if (trimmed.startsWith('api/v1/') || trimmed.startsWith('v1/')) {
      parsed = new URL(`/${trimmed}`, `${apiOrigin}/`);
    } else {
      // `chat/completions` / `models` — under the API base path
      const joined = `${basePath}/${trimmed}`.replace(/\/{2,}/g, '/');
      parsed = new URL(joined, `${apiOrigin}/`);
    }

    parsed.pathname = collapseDuplicateApiV1(parsed.pathname);
    if (baseIsHttp && parsed.origin !== new URL(base).origin) {
      // Absolute foreign URL
      if (/^https?:\/\//i.test(trimmed)) return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function installAppDataFetchProxyOnce(): void {
  if (appDataFetchProxyInstalled || typeof window === 'undefined') return;
  appDataFetchProxyInstalled = true;

  const handleProxyRequest = async (
    data: Record<string, unknown>,
    reply: (response: Record<string, unknown>) => void,
  ) => {
    const { id, method, headers, body } = data;
    const url = typeof data.url === 'string' ? data.url : '';
    if (typeof id !== 'string') return;
    // Never drop silently: the caller waits 30 s for a reply before timing
    // out, so an unmatched URL gets an immediate explicit error.
    if (!url || !isAppDataPublicUrl(url)) {
      reply({
        type: 'ym-app-data-response',
        id,
        error: `App Data proxy: URL not relayed (${url || 'missing'})`,
      });
      return;
    }

    const attempt = async (ticket: string | null): Promise<Response> => {
      const forwardHeaders: Record<string, string> = {
        ...((headers as Record<string, string>) || {}),
      };
      // Attribute preview App Data calls to the YellowStorm owner — the dev
      // preview has no login inside the generated app.
      if (ticket) forwardHeaders['Authorization'] = `Bearer ${ticket}`;
      return fetch(url, {
        method: (method as string) || 'GET',
        headers: forwardHeaders,
        body: (body as BodyInit) || undefined,
      });
    };

    try {
      const appDataId = appDataIdFromUrl(url);
      const envMatch = url.match(/\/v1\/apps\/[^/]+\/(dev|prod)\//);
      const urlEnv = envMatch?.[1] ?? 'dev';
      let ticket =
        appDataId && appDataTicketFetcher ? await appDataTicketFetcher(appDataId, false, urlEnv) : null;
      let res = await attempt(ticket);
      if (res.status === 401 && appDataId && appDataTicketFetcher) {
        // Ticket expired/rotated — force-refresh once and retry.
        const fresh = await appDataTicketFetcher(appDataId, true, urlEnv);
        if (fresh) {
          ticket = fresh;
          res = await attempt(fresh);
        }
      }
      const responseBody = await res.text();
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });
      reply({
        type: 'ym-app-data-response',
        id,
        status: res.status,
        headers: responseHeaders,
        body: responseBody,
      });
    } catch (err) {
      reply({
        type: 'ym-app-data-response',
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  let lastUntrustedSenderWarn = 0;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type !== 'ym-app-data-fetch') return;
    const source = event.source as WindowProxy | null;
    if (!source) return;
    const origin = validateRelayOrigin(event.origin);
    if (!origin || !isTrustedAppDataRelaySource(source, origin)) {
      // Dropping untrusted senders must be quiet by default; rate-limit so a
      // probing page cannot flood the console.
      if (Date.now() - lastUntrustedSenderWarn > 5_000) {
        lastUntrustedSenderWarn = Date.now();
        console.warn(LOG, 'dropped ym-app-data-fetch from an untrusted sender', {
          origin: event.origin,
        });
      }
      return;
    }
    // Reply only to the verified preview frame, targeting the exact origin we
    // just validated. The sender may navigate away while the proxy fetch runs,
    // in which case the caller's own 30 s timeout fires — never fall back to '*'.
    void handleProxyRequest(event.data, (response) => {
      source.postMessage(response, origin);
    });
  });
}

function installAiFetchProxyOnce(): void {
  if (aiFetchProxyInstalled || typeof window === 'undefined') return;
  aiFetchProxyInstalled = true;

  /** Headers safe for Nest CORS allowlist — OpenAI SDK adds x-stainless-* that break preflight. */
  const AI_PROXY_FORWARD_HEADERS = new Set([
    'content-type',
    'accept',
    'accept-language',
  ]);

  const normalizeForwardHeaders = (
    raw: unknown,
  ): Record<string, string> => {
    const out: Record<string, string> = {};
    const put = (key: string, value: string) => {
      const lower = key.toLowerCase();
      if (!AI_PROXY_FORWARD_HEADERS.has(lower)) return;
      out[key] = value;
    };
    if (!raw) return out;
    if (typeof Headers !== 'undefined' && raw instanceof Headers) {
      raw.forEach((value, key) => put(key, value));
      return out;
    }
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (Array.isArray(entry) && entry.length >= 2) {
          put(String(entry[0]), String(entry[1]));
        }
      }
      return out;
    }
    if (typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'string') put(key, value);
      }
    }
    return out;
  };

  const handleProxyRequest = async (
    data: Record<string, unknown>,
    reply: (response: Record<string, unknown>) => void,
  ) => {
    const { id, method, headers, body } = data;
    const url = typeof data.url === 'string' ? data.url : '';
    if (typeof id !== 'string') return;
    const absoluteUrl = resolveAiProxyFetchUrl(url);
    if (!absoluteUrl) {
      reply({
        type: 'ym-ai-response',
        id,
        error: `AI proxy: URL not relayed (${url || 'missing'})`,
      });
      return;
    }

    // Preview AI is non-streaming through postMessage (full JSON body).
    let requestBody = body as BodyInit | undefined;
    if (typeof requestBody === 'string' && requestBody.length > 0) {
      try {
        const parsed = JSON.parse(requestBody) as Record<string, unknown>;
        if (parsed.stream === true) {
          parsed.stream = false;
          requestBody = JSON.stringify(parsed);
        }
      } catch {
        // leave body as-is
      }
    } else if (requestBody != null && typeof requestBody !== 'string') {
      // Structured-clone may yield ArrayBuffer/Uint8Array from the SDK.
      try {
        if (requestBody instanceof Uint8Array) {
          requestBody = new TextDecoder().decode(requestBody);
        } else if (requestBody instanceof ArrayBuffer) {
          requestBody = new TextDecoder().decode(requestBody);
        }
      } catch {
        // leave as-is; fetch may still accept it
      }
    }

    const attempt = async (ticket: string | null): Promise<Response> => {
      const forwardHeaders = normalizeForwardHeaders(headers);
      if (ticket) forwardHeaders.Authorization = `Bearer ${ticket}`;
      if (requestBody != null && !forwardHeaders['Content-Type'] && !forwardHeaders['content-type']) {
        forwardHeaders['Content-Type'] = 'application/json';
      }
      return fetch(absoluteUrl, {
        method: (method as string) || 'GET',
        headers: forwardHeaders,
        body: requestBody,
        credentials: 'omit',
      });
    };

    try {
      let ticket = aiPreviewTicketFetcher ? await aiPreviewTicketFetcher(false) : null;
      if (!ticket) {
        console.warn(LOG, 'AI proxy fetch without preview ticket', { url: absoluteUrl });
      }
      let res = await attempt(ticket);
      if (res.status === 401 && aiPreviewTicketFetcher) {
        const fresh = await aiPreviewTicketFetcher(true);
        if (fresh) {
          ticket = fresh;
          res = await attempt(fresh);
        }
      }
      const responseBody = await res.text();
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });
      reply({
        type: 'ym-ai-response',
        id,
        status: res.status,
        headers: responseHeaders,
        body: responseBody,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(LOG, 'AI proxy fetch failed', { url: absoluteUrl, error: message });
      reply({
        type: 'ym-ai-response',
        id,
        error:
          message === 'Failed to fetch'
            ? `AI proxy network error (Failed to fetch) for ${absoluteUrl}. Check backend is up and CORS allows this origin; OpenAI stainless headers are stripped by the relay.`
            : message,
      });
    }
  };

  let lastUntrustedSenderWarn = 0;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type !== 'ym-ai-fetch') return;
    const source = event.source as WindowProxy | null;
    if (!source) return;
    const origin = validateRelayOrigin(event.origin);
    if (!origin || !isTrustedAppDataRelaySource(source, origin)) {
      if (Date.now() - lastUntrustedSenderWarn > 5_000) {
        lastUntrustedSenderWarn = Date.now();
        console.warn(LOG, 'dropped ym-ai-fetch from an untrusted sender', {
          origin: event.origin,
        });
      }
      return;
    }
    void handleProxyRequest(event.data, (response) => {
      source.postMessage(response, origin);
    });
  });
}

export type HostStateListener = (state: HostState) => void;

export interface HostState {
  status: RuntimeHostStatus;
  previewUrl: string | null;
  error: string | null;
  files: VfsFiles | null;
  revisionId: string;
}

/**
 * Long-lived orchestrator for one workspace (= conversation-v2 session).
 * Not a React hook — consumed via a thin hook or effect.
 */
export class BrowserRuntimeHost {
  private client = new BrowserRuntimeClient();
  private hydrator = new RevisionHydrator();
  private adapter = new NodepodRuntimeAdapter();
  private previewCtrl = new PreviewController();
  private revisions = new WorkspaceRevisionStore();

  private sessionId: string | null = null;
  private workspaceId: string | null = null;
  private ticket: RuntimeTicketResponse | null = null;
  private appDataTickets = new Map<string, { ticket: string; at: number; env: string }>();
  private revisionId = 'rev_0';
  private _status: RuntimeHostStatus = 'idle';
  private _error: string | null = null;
  private _destroyed = false;
  private reconnectAttempts = 0;
  private listeners = new Set<HostStateListener>();
  private pendingIframe: HTMLIFrameElement | null = null;
  private refreshPreviewInFlight: Promise<void> | null = null;
  /** Popup relay peers from "Open in New Tab", dropped on teardown. */
  private externalRelayPeers: WindowProxy[] = [];
  /** Provision completed before host reached ready — restart once ready. */
  private pendingAppDataRestart = false;
  /** Active chat model id from platform catalog — injected as VITE_YM_AI_DEFAULT_MODEL. */
  private defaultAiModelId: string | null = null;

  /**
   * Vite env for NodePod Dev Preview.
   * Always sets `VITE_YM_APP_DATA_ENV=dev` so starter `isDevPreview()` /
   * `ProtectedRoute` bypass works even before App Data is provisioned
   * (AI-only apps). Full App Data URL/id/proxy are added once the catalog
   * row is visible on the runtime ticket.
   */
  private buildAppDataViteEnv(): Record<string, string> | undefined {
    const env = this.ticket?.appDataRuntimeEnv;
    const apiBaseUrl = API_CONFIG.baseURL.replace(/\/$/, '');
    const aiEnv = {
      ...(apiBaseUrl ? { VITE_YM_API_BASE_URL: apiBaseUrl, VITE_YM_AI_PROXY: 'true' } : {}),
      ...(this.defaultAiModelId ? { VITE_YM_AI_DEFAULT_MODEL: this.defaultAiModelId } : {}),
    };
    // Dev Preview marker — required for ProtectedRoute bypass without prod auth.
    const previewBase: Record<string, string> = {
      VITE_YM_APP_DATA_ENV: 'dev',
      ...aiEnv,
    };
    if (!env) {
      return previewBase;
    }
    return {
      ...previewBase,
      VITE_YM_APP_DATA_URL: env.publicUrl,
      VITE_YM_APP_DATA_ID: env.appDataId,
      VITE_YM_APP_DATA_ENV: env.environment || 'dev',
      VITE_YM_APP_DATA_PROXY: 'true',
    };
  }

  /** Prefer platform isDefault, else first active chat model. Best-effort. */
  private async ensureDefaultAiModelId(): Promise<void> {
    if (this.defaultAiModelId) return;
    try {
      const { models } = await getModels();
      const pick =
        models.find((m) => m.isDefault && m.isActive)?.id
        ?? models.find((m) => m.isActive)?.id
        ?? models[0]?.id
        ?? null;
      if (pick) {
        this.defaultAiModelId = pick;
        console.log(LOG, 'default AI model', { model: pick });
      }
    } catch (err) {
      console.warn(
        LOG,
        'default AI model lookup failed',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private setupAppDataFetchProxy(): void {
    installAppDataFetchProxyOnce();
    installAiFetchProxyOnce();
  }

  /**
   * Owner data ticket for the relay (`Authorization: Bearer <ticket>` on
   * preview App Data calls), keyed by appDataId. Acquired from the backend
   * (owner-guarded) and cached; force-refreshed once when the microservice
   * returns 401. `expectedEnv` validates the cached ticket's environment;
   * a mismatch discards the stale entry and re-fetches.
   */
  private async acquireAppDataTicket(
    appDataId: string,
    force = false,
    expectedEnv: string = 'dev',
  ): Promise<string | null> {
    const TICKET_TTL_MS = 10 * 60_000;
    const cached = this.appDataTickets.get(appDataId);
    if (!force && cached && cached.env === expectedEnv && Date.now() - cached.at < TICKET_TTL_MS) {
      return cached.ticket;
    }
    if (!this.sessionId) return cached?.ticket ?? null;
    try {
      const res = await conversationV2Api.getAppDataTicket(this.sessionId);
      this.appDataTickets.set(res.appDataId, { ticket: res.ticket, at: Date.now(), env: expectedEnv });
      console.log(LOG, 'app-data ticket acquired', { appDataId: res.appDataId, env: expectedEnv });
    } catch (err) {
      // Not provisioned yet, backend hiccup, or local mode — the relay then
      // sends the call without Authorization, which the microservice rejects.
      console.warn(LOG, 'app-data ticket unavailable', err instanceof Error ? err.message : err);
    }
    return this.appDataTickets.get(appDataId)?.ticket ?? null;
  }

  /** Opaque AI preview ticket — parent memory only; never injected into Vite. */
  private aiPreviewTicketCache: { ticket: string; at: number; expiresAt: number } | null = null;

  private async acquireAiPreviewTicket(force = false): Promise<string | null> {
    const now = Date.now();
    const cached = this.aiPreviewTicketCache;
    if (
      !force
      && cached
      && now - cached.at < 9 * 60_000
      && cached.expiresAt > now + 30_000
    ) {
      return cached.ticket;
    }
    if (!this.sessionId) return cached?.ticket ?? null;
    try {
      const res = await conversationV2Api.createAiPreviewTicket(this.sessionId);
      this.aiPreviewTicketCache = {
        ticket: res.ticket,
        at: now,
        expiresAt: Date.parse(res.expiresAt) || now + 600_000,
      };
      console.log(LOG, 'ai-preview ticket acquired', { workspaceId: res.workspaceId });
    } catch (err) {
      console.warn(LOG, 'ai-preview ticket unavailable', err instanceof Error ? err.message : err);
    }
    return this.aiPreviewTicketCache?.ticket ?? null;
  }

  /** Off-screen iframe so preview_inspect works when the user panel is closed. */
  private hiddenIframe: HTMLIFrameElement | null = null;

  /** Serializes mutating tools; the backend also serializes, this is depth. */
  private mutationLock: Promise<unknown> = Promise.resolve();
  private rehydrating = false;
  /** When true, Nodepod runs without Socket.IO (flag off / ticket failure + cephPath). */
  private legacyMode = false;

  // -------------------------------------------------------------------------
  // App Data relay peer registration
  // -------------------------------------------------------------------------

  /**
   * Compute the preview origin from the current preview URL. Returns `null`
   * when the dev server has not started or the URL is invalid.
   */
  private previewRelayOrigin(): string | null {
    const url = this.previewCtrl.previewUrl;
    if (!url) return null;
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
    } catch {
      return null;
    }
  }

  private registerPreviewRelayPeer(iframe: HTMLIFrameElement | null): void {
    const win = iframe?.contentWindow;
    const origin = this.previewRelayOrigin();
    if (win && origin) registerAppDataRelayFrame(win, origin);
  }

  private unregisterPreviewRelayPeer(iframe: HTMLIFrameElement | null): void {
    const win = iframe?.contentWindow;
    if (win) unregisterAppDataRelayFrame(win);
  }

  /**
   * Called after the dev-server URL is set or changes so that previously
   * registered peers pick up the new origin (e.g. port change on restart).
   */
  private syncPreviewRelayOrigins(): void {
    const origin = this.previewRelayOrigin();
    if (!origin) return;
    for (const frame of [this.pendingIframe, this.hiddenIframe]) {
      const win = frame?.contentWindow;
      if (win) updateAppDataRelayFrameOrigin(win, origin);
    }
  }

  /**
   * Registers a preview-wrapper popup (opened via "Open in New Tab") as an App
   * Data relay peer. preview-wrapper.html is served from this host's origin,
   * so its messages arrive with `event.origin` equal to it; the peer is paired
   * with that exact origin and only served along exact-origin replies. Tracked
   * on the host so teardown drops the peer — a stale popup WindowProxy must
   * never be served by a later session's host.
   */
  registerExternalPreviewRelayPeer(source: WindowProxy, origin: string): void {
    const validated = validateRelayOrigin(origin);
    if (!validated) return;
    this.externalRelayPeers.push(source);
    registerAppDataRelayFrame(source, validated);
  }

  get state(): HostState {
    return {
      status: this._status,
      previewUrl: this.previewCtrl.previewUrl,
      error: this._error,
      files: this.adapter.files,
      revisionId: this.revisionId,
    };
  }

  subscribe(listener: HostStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const s = this.state;
    for (const l of this.listeners) {
      try { l(s); } catch { /* noop */ }
    }
  }

  private setStatus(status: RuntimeHostStatus, error?: string): void {
    this._status = status;
    this._error = error ?? null;
    this.emit();
    if (status === 'ready') {
      this.flushPendingAppDataRestart();
    }
  }

  /**
   * Full lifecycle: ticket -> connect -> hydrate -> boot -> install -> dev server -> register -> heartbeat.
   *
   * Legacy path (VITE_APP_RUNTIME_ENABLED=false, or ticket API failure with an
   * existing cephPath): boot Nodepod only — no Socket.IO, no runtime.register.
   * Ticket / mcpToken never enter HostState, the Zustand store, or the preview iframe.
   */
  async start(
    sessionId: string,
    existingCephPath?: string | null,
    existingFilesTree?: unknown | null,
  ): Promise<void> {
    if (this._destroyed) return;
    if (this._status !== 'idle') return;
    this.sessionId = sessionId;
    this.reconnectAttempts = 0;
    this.legacyMode = false;
    this.setupAppDataFetchProxy();
    // Owner data tickets for relayed preview App Data calls (refreshed on 401).
    setAppDataTicketFetcher((appDataId, force, env) => this.acquireAppDataTicket(appDataId, force, env));
    setAiPreviewTicketFetcher((force) => this.acquireAiPreviewTicket(force));

    const cephPath = existingCephPath ?? null;
    const filesTree = (existingFilesTree as FilesTreeNode | null) ?? null;
    const canLegacy = !!cephPath && !!filesTree;

    // Flag off: legacy only when we have Ceph sources; otherwise stay idle.
    if (!appRuntimeEnabled) {
      if (canLegacy) {
        await this.startLegacy(sessionId, cephPath!, filesTree!);
      }
      return;
    }

    try {
      // 1. Get ticket (one-shot; kept private on this.host — never in HostState)
      this.setStatus('connecting');
      console.log(LOG, 'requesting ticket', { sessionId });
      this.ticket = await conversationV2Api.createRuntimeTicket(sessionId);
      this.revisionId = this.ticket.revisionId;
      this.workspaceId = this.ticket.workspaceId;

      // 2. Connect socket — ticket string is handed to the client then discarded from React surface
      await this.client.connect(this.ticket.ticket);
      if (this._destroyed) return;

      // 2b. Proactively acquire the owner data ticket so the relay has it
      //     before the preview makes its first app-data call.
      if (this.ticket.appDataRuntimeEnv) {
        void this.acquireAppDataTicket(
          this.ticket.appDataRuntimeEnv.appDataId,
          false,
          this.ticket.appDataRuntimeEnv.environment,
        );
      }
      void this.acquireAiPreviewTicket(false);

      // 3. Wire event handlers
      this.wireClientEvents();

      // 4. Hydrate from ticket revision (Ceph starter / workspace), then legacy fallbacks
      this.setStatus('hydrating');
      const files = await this.resolveHydrationFiles(sessionId, {
        revisionId: this.revisionId,
        cephPath: canLegacy ? cephPath : null,
        filesTree: canLegacy ? filesTree : null,
      });
      if (this._destroyed) return;

      // 5. Boot Nodepod
      await this.adapter.boot(files, sessionId, this.revisionId);
      if (this._destroyed) return;

      // 6. Seed the local revision history at the backend's revision
      this.revisions.seed(await this.adapter.shaManifest(), this.revisionId);

      // 7. Install deps (skipped when the manifest fingerprint is unchanged)
      this.setStatus('installing');
      await this.adapter.ensureDeps({
        onProgress: (phase, msg) => console.log(LOG, 'install progress', { phase, msg }),
      });
      if (this._destroyed) return;

      // 8. Start dev server (refresh ticket so App Data env is present if already provisioned)
      this.setStatus('starting');
      const viteEnv = await this.refreshAppDataViteEnv();
      await this.adapter.startDevServer(this.previewCtrl, () => this._destroyed, undefined, viteEnv);
      if (this._destroyed) return;
      this.syncPreviewRelayOrigins();
      this.flushPendingIframe();
      await this.ensureHiddenPreviewIframe();

      // 9. Register
      this.setStatus('registering');
      const ack = await this.client.register({
        runtimeSessionId: this.ticket.runtimeSessionId,
        workspaceId: this.ticket.workspaceId,
        revisionId: this.revisionId,
        capabilities: NODEPOD_CAPABILITIES,
      });
      if (!ack.ok) {
        this.setStatus('error', `Registration failed: ${ack.error ?? 'unknown'}`);
        return;
      }

      // 10. Start heartbeat
      this.client.startHeartbeat(this.ticket.workspaceId, () => this.revisionId);

      this.setStatus('ready');
      this.reconnectAttempts = 0;
      console.log(LOG, 'ready', { previewUrl: this.previewCtrl.previewUrl });
    } catch (err) {
      if (this._destroyed) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(LOG, 'start failed', msg);
      // Ticket / connect failure with existing Ceph sources → legacy Nodepod boot.
      if (canLegacy) {
        console.warn(LOG, 'falling back to legacy Nodepod boot', { reason: msg });
        await this.startLegacy(sessionId, cephPath!, filesTree!);
        return;
      }
      this.setStatus('error', msg);
    }
  }

  /**
   * Rollback path for already-generated apps: hydrate from Ceph and run Nodepod
   * without a runtime ticket / Socket.IO. No MCP tool dispatch in this mode.
   */
  private async startLegacy(
    sessionId: string,
    cephPath: string,
    filesTree: FilesTreeNode,
  ): Promise<void> {
    this.legacyMode = true;
    this.ticket = null;
    try {
      this.setStatus('hydrating');
      const files = await this.hydrator.hydrateFromCeph(sessionId, cephPath, filesTree);
      if (this._destroyed) return;

      this.revisionId = 'rev_legacy';
      await this.adapter.boot(files, sessionId, this.revisionId);
      if (this._destroyed) return;

      this.revisions.seed(await this.adapter.shaManifest(), this.revisionId);

      this.setStatus('installing');
      await this.adapter.ensureDeps({
        onProgress: (phase, msg) => console.log(LOG, 'legacy install', { phase, msg }),
      });
      if (this._destroyed) return;

      this.setStatus('starting');
      await this.ensureDefaultAiModelId();
      await this.adapter.startDevServer(this.previewCtrl, () => this._destroyed, undefined, this.buildAppDataViteEnv());
      if (this._destroyed) return;
      this.syncPreviewRelayOrigins();
      this.flushPendingIframe();
      await this.ensureHiddenPreviewIframe();

      this.setStatus('ready');
      console.log(LOG, 'legacy ready', { previewUrl: this.previewCtrl.previewUrl });
    } catch (err) {
      if (this._destroyed) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(LOG, 'legacy start failed', msg);
      this.setStatus('error', msg);
    }
  }

  private wireClientEvents(): void {
    this.client.onToolInvoke((payload: ToolInvokePayload) => {
      void this.handleToolInvoke(payload);
    });

    this.client.onRehydrate((payload: RuntimeRehydratePayload) => {
      void this.handleRehydrate(payload);
    });

    this.client.onDisconnect((reason: string) => {
      if (this._destroyed) return;
      console.warn(LOG, 'disconnected', reason);
      this.setStatus('disconnected');
      void this.tryReconnect();
    });
  }

  /** Chain `task` onto the mutation lock so mutating tools never interleave. */
  private withMutationLock<T>(task: () => Promise<T>): Promise<T> {
    const run = this.mutationLock.then(task, task);
    // Swallow rejections on the chain itself; the caller still sees them.
    this.mutationLock = run.catch(() => undefined);
    return run;
  }

  private buildToolContext(toolCallId: string): ToolContext {
    return {
      adapter: this.adapter,
      previewCtrl: this.previewCtrl,
      revisions: this.revisions,
      workspaceId: this.workspaceId ?? this.sessionId ?? 'unknown',
      sessionId: this.sessionId ?? this.workspaceId ?? 'unknown',
      toolCallId,
      onProgress: (progress) => {
        if (this._destroyed) return;
        this.client.emitToolProgress({ toolCallId, ...progress });
      },
      ensurePreviewAttached: () => this.ensureHiddenPreviewIframe({ force: true }),
      openPreviewPanel: () => {
        useConversationV2Store.getState().setRightPanelView('preview');
      },
      resolveAppDataViteEnv: () =>
        this.refreshAppDataViteEnv({ retries: APP_DATA_ENV_REFRESH_ATTEMPTS }),
    };
  }

  /**
   * Re-issue runtime ticket metadata so VITE_YM_* reflects a newly provisioned
   * App Data store. Retries briefly — catalog rows can lag behind provision.
   */
  private async refreshAppDataViteEnv(options?: {
    retries?: number;
    requireAppData?: boolean;
  }): Promise<Record<string, string> | undefined> {
    const retries = Math.max(1, options?.retries ?? 1);
    const requireAppData = options?.requireAppData === true;

    if (this.sessionId && appRuntimeEnabled) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const fresh = await conversationV2Api.createRuntimeTicket(this.sessionId);
          if (fresh.appDataRuntimeEnv) {
            this.ticket = this.ticket
              ? { ...this.ticket, appDataRuntimeEnv: fresh.appDataRuntimeEnv }
              : fresh;
            break;
          }
          if (requireAppData && attempt < retries) {
            await new Promise((r) => setTimeout(r, APP_DATA_ENV_REFRESH_DELAY_MS));
            continue;
          }
        } catch (err) {
          console.warn(
            LOG,
            'refreshAppDataViteEnv failed',
            err instanceof Error ? err.message : String(err),
          );
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, APP_DATA_ENV_REFRESH_DELAY_MS));
          }
        }
      }
    }
    await this.ensureDefaultAiModelId();
    return this.buildAppDataViteEnv();
  }

  /** Restart Vite after App Data provision so preview receives VITE_YM_* env. */
  async restartDevServerForAppData(): Promise<void> {
    if (this._destroyed || this.legacyMode) return;
    if (this._status !== 'ready' && this._status !== 'starting') {
      this.pendingAppDataRestart = true;
      console.log(LOG, 'queue App Data restart until host is ready');
      return;
    }
    this.pendingAppDataRestart = false;
    const viteEnv = await this.refreshAppDataViteEnv({
      retries: APP_DATA_ENV_REFRESH_ATTEMPTS,
      requireAppData: true,
    });
    if (!viteEnv?.VITE_YM_APP_DATA_ENV) {
      console.warn(LOG, 'skip App Data restart: VITE_YM_APP_DATA_ENV still missing');
      return;
    }
    if (!this.ticket?.appDataRuntimeEnv) {
      console.warn(
        LOG,
        'App Data restart with DEV marker only — catalog appDataRuntimeEnv still missing after retries',
      );
    } else {
      void this.acquireAppDataTicket(
        this.ticket.appDataRuntimeEnv.appDataId,
        true,
        this.ticket.appDataRuntimeEnv.environment,
      );
    }
    console.log(LOG, 'restarting dev server for App Data env', {
      hasAppDataId: Boolean(this.ticket?.appDataRuntimeEnv?.appDataId),
    });
    await this.adapter.startDevServer(this.previewCtrl, () => this._destroyed, undefined, viteEnv);
    this.syncPreviewRelayOrigins();
    await this.ensureHiddenPreviewIframe({ force: true });
    await this.refreshPreview();
  }

  /** Flush a provision-triggered restart that arrived before the host was ready. */
  private flushPendingAppDataRestart(): void {
    if (!this.pendingAppDataRestart || this._destroyed || this.legacyMode) return;
    if (this._status !== 'ready') return;
    void this.restartDevServerForAppData();
  }

  private async handleToolInvoke(payload: ToolInvokePayload): Promise<void> {
    const { toolCallId, tool, arguments: args } = payload;
    console.log(LOG, 'tool.invoke', { toolCallId, tool });

    const isMutation = MUTATING_TOOLS.has(tool);
    try {
      if (isMutation && this.rehydrating) {
        throw new ToolError(
          RuntimeErrorCodes.REVISION_CONFLICT,
          'Workspace is rehydrating; retry once the runtime re-registers.',
          { tool, revisionId: this.revisionId },
        );
      }

      const ctx = this.buildToolContext(toolCallId);
      const run = () => dispatchTool(tool, args, ctx);
      const result = isMutation ? await this.withMutationLock(run) : await run();

      if (isMutation) {
        this.revisionId = this.revisions.latestRevisionId;
        await this.refreshSourceFiles();
        if (this.ticket) {
          const ack = await this.client.register({
            runtimeSessionId: this.ticket.runtimeSessionId,
            workspaceId: this.ticket.workspaceId,
            revisionId: this.revisionId,
            capabilities: NODEPOD_CAPABILITIES,
          });
          if (!ack.ok) {
            throw new ToolError(
              RuntimeErrorCodes.INTERNAL_ERROR,
              `Re-registration failed after mutation: ${ack.error ?? 'unknown'}`,
              { revisionId: this.revisionId, tool },
            );
          }
        }
      }
      if (this._destroyed) return;
      this.client.emitToolCompleted({ toolCallId, result });
      if (tool === 'finalize') {
        await this.refreshPreview();
      }
      this.emit();
    } catch (err) {
      if (this._destroyed) return;
      const error =
        err instanceof ToolError
          ? { code: err.code, message: err.message, data: err.data }
          : {
              code: RuntimeErrorCodes.INTERNAL_ERROR,
              message: err instanceof Error ? err.message : String(err),
            };
      this.client.emitToolFailed({ toolCallId, error });
    }
  }

  /**
   * The backend saw our revision drift. Re-pull the workspace sources, write
   * them into the live pod, reseed the revision history at the expected id,
   * then re-emit `runtime.register` — the backend has no `runtime.ready`
   * event, so re-registration is the readiness signal.
   */
  /** Refresh the split-view source cache from the live Nodepod VFS. */
  private async refreshSourceFiles(): Promise<void> {
    if (this._destroyed || !this.adapter.currentPod) return;
    try {
      await this.adapter.refreshFileCache();
      this.emit();
    } catch (err) {
      console.warn(
        LOG,
        'refreshSourceFiles failed',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Align the live pod + source cache with a persisted workspace revision (e.g.
   * after backend finalize pushes application_component with revision_id).
   */
  async syncRevisionSources(revisionId: string): Promise<void> {
    if (this._destroyed || !this.sessionId || !revisionId) return;
    const pod = this.adapter.currentPod;
    if (!pod) return;

    try {
      const appComp = useConversationV2Store.getState().applicationComponent;
      const files = await this.resolveHydrationFiles(this.sessionId, {
        revisionId,
        cephPath: appComp?.cephPath ?? null,
        filesTree: (appComp?.filesTree as FilesTreeNode | undefined) ?? null,
      });
      if (this._destroyed) return;

      await this.hydrator.syncToRevision(pod, files);
      this.revisionId = revisionId;
      this.revisions.seed(await this.adapter.shaManifest(), revisionId);
      await this.adapter.refreshFileCache();

      this.setStatus('starting');
      const viteEnv = await this.refreshAppDataViteEnv();
      await this.adapter.startDevServer(this.previewCtrl, () => this._destroyed, undefined, viteEnv);
      if (this._destroyed) return;
      this.syncPreviewRelayOrigins();

      await this.refreshPreview();
      this.setStatus('ready');
      console.log(LOG, 'syncRevisionSources ok', { revisionId });
    } catch (err) {
      console.warn(
        LOG,
        'syncRevisionSources failed, falling back to VFS refresh',
        err instanceof Error ? err.message : String(err),
      );
      await this.refreshSourceFiles();
      await this.refreshPreview();
      if (!this._destroyed && this._status === 'starting') {
        this.setStatus('ready');
      }
    }
  }

  private async handleRehydrate(payload: RuntimeRehydratePayload): Promise<void> {
    console.log(LOG, 'rehydrate', payload);
    if (this.rehydrating || this._destroyed || !this.sessionId) return;
    this.rehydrating = true;

    try {
      this.setStatus('hydrating');
      const files = await this.resolveHydrationFiles(this.sessionId, {
        revisionId: payload.expectedRevisionId,
        cephPath: useConversationV2Store.getState().applicationComponent?.cephPath ?? null,
        filesTree:
          (useConversationV2Store.getState().applicationComponent?.filesTree as
            | FilesTreeNode
            | undefined) ?? null,
      });
      if (this._destroyed) return;

      const pod = this.adapter.currentPod;
      if (pod) await this.hydrator.syncToRevision(pod, files);

      this.revisionId = payload.expectedRevisionId;
      this.revisions.seed(await this.adapter.shaManifest(), this.revisionId);
      this.adapter.markDepsDirty();

      if (this.ticket) {
        const ack = await this.client.register({
          runtimeSessionId: this.ticket.runtimeSessionId,
          workspaceId: this.ticket.workspaceId,
          revisionId: this.revisionId,
          capabilities: NODEPOD_CAPABILITIES,
        });
        if (!ack.ok) {
          this.setStatus('error', `Re-registration failed: ${ack.error ?? 'unknown'}`);
          return;
        }
      }
      this.setStatus('ready');
    } catch (err) {
      if (this._destroyed) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(LOG, 'rehydrate failed', msg);
      this.setStatus('error', msg);
    } finally {
      this.rehydrating = false;
    }
  }

  /**
   * Hydrate from Ceph revision APIs only. Legacy cephPath is a fallback for
   * already-generated apps; bundled starter files are never used.
   */
  private async resolveHydrationFiles(
    sessionId: string,
    opts: {
      revisionId: string;
      cephPath?: string | null;
      filesTree?: FilesTreeNode | null;
    },
  ): Promise<VfsFiles> {
    try {
      return await this.hydrator.hydrateFromRevision(sessionId, opts.revisionId);
    } catch (err) {
      console.warn(
        LOG,
        'revision hydration failed',
        { revisionId: opts.revisionId },
        err instanceof Error ? err.message : String(err),
      );
    }

    if (opts.cephPath && opts.filesTree) {
      return await this.hydrator.hydrateFromCeph(
        sessionId,
        opts.cephPath,
        opts.filesTree,
      );
    }

    throw new Error(
      `Cannot hydrate workspace from Ceph for revision ${opts.revisionId}. ` +
        'Ensure the starter manifest exists in Ceph and revision APIs are reachable.',
    );
  }

  // ---------------------------------------------------------------------------
  // Preview iframe wiring
  // ---------------------------------------------------------------------------

  /**
   * Register the preview iframe for `preview_inspect` / `preview_action`. The
   * iframe usually mounts before the pod exists, so it is queued until boot.
   */
  attachPreviewIframe(iframe: HTMLIFrameElement): void {
    this.removeHiddenPreviewIframe();
    if (this.pendingIframe && this.pendingIframe !== iframe) {
      this.unregisterPreviewRelayPeer(this.pendingIframe);
    }
    this.pendingIframe = iframe;
    this.registerPreviewRelayPeer(iframe);
    this.flushPendingIframe();
    const url = this.previewCtrl.previewUrl;
    if (!url) return;
    if (iframe.src && iframe.src !== 'about:blank' && iframe.src === url) {
      return;
    }
    this.reloadPreviewIframe(iframe);
  }

  /**
   * Re-probe the Nodepod SW route and reload attached preview iframes so the
   * visible panel matches what finalize / preview_inspect verified.
   */
  async refreshPreview(): Promise<void> {
    if (this.refreshPreviewInFlight) return this.refreshPreviewInFlight;
    this.refreshPreviewInFlight = this.runRefreshPreview().finally(() => {
      this.refreshPreviewInFlight = null;
    });
    return this.refreshPreviewInFlight;
  }

  private async runRefreshPreview(): Promise<void> {
    if (this._destroyed) return;
    const pod = this.adapter.currentPod;
    const url = this.previewCtrl.previewUrl;
    const port = this.previewCtrl.port;
    if (pod && url && port) {
      console.log(LOG, 'refreshPreview', { url });
      await this.previewCtrl.probeAndPromote(pod, url, port, () => this._destroyed);
    }
    if (this._destroyed) return;
    this.syncPreviewRelayOrigins();
    this.flushPendingIframe();
    if (this.pendingIframe) {
      this.reloadPreviewIframe(this.pendingIframe);
    }
    await this.ensureHiddenPreviewIframe();
    this.emit();
  }

  private reloadPreviewIframe(iframe: HTMLIFrameElement): void {
    const url = this.previewCtrl.previewUrl;
    if (!url) return;
    const current = iframe.src;
    if (!current || current === 'about:blank') {
      iframe.src = url;
      return;
    }
    if (current !== url) {
      iframe.src = url;
      return;
    }
    iframe.src = 'about:blank';
    window.requestAnimationFrame(() => {
      if (this._destroyed || this.previewCtrl.previewUrl !== url) return;
      iframe.src = url;
    });
  }

  detachPreviewIframe(): void {
    this.unregisterPreviewRelayPeer(this.pendingIframe);
    this.pendingIframe = null;
    this.previewCtrl.detachIframe(this.adapter.currentPod ?? undefined);
    void this.ensureHiddenPreviewIframe();
  }

  /**
   * Mount an off-screen iframe when the dev server is up but the user has not
   * opened the preview panel — required for `preview_inspect` / `finalize`.
   */
  async ensureHiddenPreviewIframe(options?: { force?: boolean }): Promise<void> {
    const force = options?.force === true;
    const url = this.previewCtrl.previewUrl;
    const pod = this.adapter.currentPod;
    if (!url || !pod || this._destroyed) return;
    if (this.pendingIframe) {
      this.flushPendingIframe();
      // Visible panel iframe takes precedence; still wait for attach when possible.
      await this.waitForInspectorAttach();
      return;
    }

    if (!this.hiddenIframe) {
      this.hiddenIframe = document.createElement('iframe');
      this.hiddenIframe.setAttribute('aria-hidden', 'true');
      this.hiddenIframe.setAttribute('sandbox', HIDDEN_IFRAME_SANDBOX);
      this.hiddenIframe.style.cssText = HIDDEN_IFRAME_STYLE;
      this.hiddenIframe.title = 'YellowMind runtime preview';
      document.body.appendChild(this.hiddenIframe);
    }
    this.registerPreviewRelayPeer(this.hiddenIframe);

    const needsReload = force || this.hiddenIframe.src !== url;
    if (needsReload) {
      await new Promise<void>((resolve) => {
        const iframe = this.hiddenIframe!;
        const timer = window.setTimeout(resolve, HIDDEN_IFRAME_LOAD_MS);
        const done = () => {
          window.clearTimeout(timer);
          iframe.removeEventListener('load', done);
          resolve();
        };
        iframe.addEventListener('load', done, { once: true });
        // Force a reload even when the URL string is unchanged (post restart).
        if (force && iframe.src === url) {
          iframe.src = '';
        }
        iframe.src = url;
      });
    }

    await this.previewCtrl.attachIframe(pod, this.hiddenIframe, { force });
    const attached = await this.waitForInspectorAttach();
    console.log(LOG, 'hidden preview iframe attached', { url, attached });
  }

  private async waitForInspectorAttach(): Promise<boolean> {
    for (let i = 0; i < INSPECTOR_ATTACH_ATTEMPTS; i++) {
      if (this.previewCtrl.isInspectorAttached()) return true;
      await new Promise((r) => setTimeout(r, INSPECTOR_ATTACH_POLL_MS));
    }
    return this.previewCtrl.isInspectorAttached();
  }

  private removeHiddenPreviewIframe(): void {
    if (!this.hiddenIframe) return;
    this.unregisterPreviewRelayPeer(this.hiddenIframe);
    this.previewCtrl.detachIframe(this.adapter.currentPod ?? undefined);
    this.hiddenIframe.remove();
    this.hiddenIframe = null;
  }

  private flushPendingIframe(): void {
    const pod = this.adapter.currentPod;
    if (!pod || !this.pendingIframe) return;
    void this.previewCtrl.attachIframe(pod, this.pendingIframe);
  }

  private async tryReconnect(): Promise<void> {
    if (this._destroyed || !this.sessionId || this.legacyMode) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setStatus('error', 'Reconnection failed after multiple attempts.');
      return;
    }

    this.reconnectAttempts += 1;
    console.log(LOG, 'reconnecting', { attempt: this.reconnectAttempts });
    await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
    if (this._destroyed) return;

    try {
      this.setStatus('connecting');
      this.ticket = await conversationV2Api.createRuntimeTicket(this.sessionId);
      this.appDataTickets.clear();
      this.aiPreviewTicketCache = null;
      await this.client.connect(this.ticket.ticket);
      if (this._destroyed) return;

      this.wireClientEvents();

      const ack = await this.client.register({
        runtimeSessionId: this.ticket.runtimeSessionId,
        workspaceId: this.ticket.workspaceId,
        revisionId: this.revisionId,
        capabilities: NODEPOD_CAPABILITIES,
      });
      if (!ack.ok) {
        this.setStatus('error', `Re-registration failed: ${ack.error ?? 'unknown'}`);
        return;
      }

      this.client.startHeartbeat(this.ticket.workspaceId, () => this.revisionId);
      this.setStatus('ready');
      this.reconnectAttempts = 0;
    } catch (err) {
      if (this._destroyed) return;
      console.error(LOG, 'reconnect failed', err instanceof Error ? err.message : String(err));
      void this.tryReconnect();
    }
  }

  retry(): void {
    if (!this.sessionId) return;
    const sid = this.sessionId;
    this.teardownRuntime({ clearListeners: false, clearSession: false });
    this._destroyed = false;
    this.emit();
    void this.start(sid);
  }

  destroy(): void {
    this.teardownRuntime({ clearListeners: true, clearSession: true });
  }

  /**
   * Tear down sockets, preview, and pod state. Retry keeps React subscribers
   * so connecting/ready/error still reach the mounted preview hook.
   */
  private teardownRuntime(options: {
    clearListeners: boolean;
    clearSession: boolean;
  }): void {
    this._destroyed = true;
    this.client.disconnect();
    this.removeHiddenPreviewIframe();
    this.unregisterPreviewRelayPeer(this.pendingIframe);
    for (const peer of this.externalRelayPeers) unregisterAppDataRelayFrame(peer);
    this.externalRelayPeers = [];
    this.previewCtrl.detachIframe(this.adapter.currentPod ?? undefined);
    this.previewCtrl.reset();
    this.pendingIframe = null;
    if (this.sessionId) invalidateSession(this.sessionId);
    if (options.clearSession) this.sessionId = null;
    this.workspaceId = null;
    this.ticket = null;
    this.aiPreviewTicketCache = null;
    this.legacyMode = false;
    this.rehydrating = false;
    this.reconnectAttempts = 0;
    this.mutationLock = Promise.resolve();
    this.revisionId = 'rev_0';
    this._status = 'idle';
    this._error = null;
    if (options.clearListeners) this.listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// Host registry — one host per session, reusable across component mounts.
// ---------------------------------------------------------------------------

const hostRegistry = new Map<string, BrowserRuntimeHost>();

export function getOrCreateHost(sessionId: string): BrowserRuntimeHost {
  let host = hostRegistry.get(sessionId);
  if (!host) {
    host = new BrowserRuntimeHost();
    hostRegistry.set(sessionId, host);
  }
  return host;
}

export function removeHost(sessionId: string): void {
  const host = hostRegistry.get(sessionId);
  if (host) {
    host.destroy();
    hostRegistry.delete(sessionId);
  }
}

/** Sync split-view sources after SSE application_component (best-effort). */
export function syncHostRevisionSources(sessionId: string, revisionId: string): void {
  const host = hostRegistry.get(sessionId);
  if (!host || !revisionId) return;
  void host.syncRevisionSources(revisionId);
}

/** Re-probe and reload preview iframes when the agent finishes (best-effort). */
export function refreshHostPreview(sessionId: string | null | undefined): void {
  if (!sessionId) return;
  const host = hostRegistry.get(sessionId);
  if (!host) return;
  void host.refreshPreview();
}

const APP_DATA_DEV_SERVER_RESTART_TOOL_MARKERS = [
  'yellowappdata_provision',
  'appdata_provision',
  'app_data_provision',
];

const APP_DATA_TOOL_SUCCESS_STATUSES = new Set(['success', 'completed', 'done', 'ok', 'finished']);

/** Restart Nodepod Vite when App Data provision completes so preview env is injected. */
export function maybeRestartDevServerAfterAppDataTool(
  sessionId: string | null | undefined,
  event: { type: string; function?: string; name?: string; status?: string },
): void {
  if (!sessionId || event.type !== 'tool') return;
  const status = (event.status ?? '').toLowerCase();
  if (status && !APP_DATA_TOOL_SUCCESS_STATUSES.has(status)) return;
  const label = `${event.function ?? ''} ${event.name ?? ''}`.toLowerCase();
  const isProvision =
    APP_DATA_DEV_SERVER_RESTART_TOOL_MARKERS.some((marker) => label.includes(marker)) ||
    ((label.includes('yellowappdata') || label.includes('appdata') || label.includes('app_data')) &&
      label.includes('provision'));
  if (!isProvision) return;
  const host = hostRegistry.get(sessionId);
  if (!host) return;
  void host.restartDevServerForAppData();
}
