/**
 * Approach B AI client for generated apps.
 * OpenAI SDK → YellowStorm AI Proxy (`/api/v1`).
 * - Deployed / logged-in: App Data end-user JWT (`ym_app_auth_token`).
 * - NodePod preview: parent relay (`VITE_YM_AI_PROXY`) injects an opaque AI preview ticket.
 * LiteLLM keys never enter the browser.
 */
import OpenAI from 'openai';
import { getAuthToken, isDevPreview } from '@/lib/yellowmind-auth';
import { ymDiag } from '@/lib/ym-diag';

const proxyEnabled = import.meta.env.VITE_YM_AI_PROXY === 'true' && typeof window !== 'undefined';
const inIframe = proxyEnabled && window.parent !== window;
const inNewTab = proxyEnabled && window.parent === window;

ymDiag.debug('ai', 'client module loaded', { proxyEnabled, inIframe, inNewTab });

let proxyIdCounter = 0;
let broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel {
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel('ym-ai-proxy');
  }
  return broadcastChannel;
}

function sanitizeAiClientHeaders(
  raw: HeadersInit | undefined,
  options?: { includeAuthorization?: boolean },
): Record<string, string> | undefined {
  if (!raw) return undefined;
  // Nest CORS uses a fixed allowlist — OpenAI SDK adds x-stainless-* that break preflight.
  const allow = new Set(['content-type', 'accept', 'accept-language']);
  if (options?.includeAuthorization) {
    allow.add('authorization');
  }
  const out: Record<string, string> = {};
  const put = (key: string, value: string) => {
    if (allow.has(key.toLowerCase())) out[key] = value;
  };
  if (typeof Headers !== 'undefined' && raw instanceof Headers) {
    raw.forEach((value, key) => put(key, value));
  } else if (Array.isArray(raw)) {
    for (const [key, value] of raw) put(key, value);
  } else {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string') put(key, value);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Preview relay: drop Authorization (parent injects the AI preview ticket). */
function sanitizeProxyHeaders(raw: HeadersInit | undefined): Record<string, string> | undefined {
  return sanitizeAiClientHeaders(raw);
}

/** OpenAI-compatible base URL for YellowStorm AI Proxy (…/api/v1). */
export function resolveAiApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_YM_API_BASE_URL as string | undefined)?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  throw new Error(
    'AI is not ready yet. Refresh the preview after setup completes, or open the deployed app and sign in.',
  );
}

/** Avoid `/api/v1/api/v1/...` when the SDK passes root-relative or duplicated paths. */
function normalizeAiFetchUrl(url: string, baseURL: string): string {
  try {
    const origin = new URL(baseURL).origin;
    const basePath = new URL(baseURL).pathname.replace(/\/$/, '') || '/api/v1';
    let absolute: URL;
    if (/^https?:\/\//i.test(url)) {
      absolute = new URL(url);
    } else if (url.startsWith('/')) {
      absolute = new URL(url, `${origin}/`);
    } else if (url.startsWith('api/v1/') || url.startsWith('v1/')) {
      absolute = new URL(`/${url}`, `${origin}/`);
    } else {
      absolute = new URL(`${basePath}/${url}`.replace(/\/{2,}/g, '/'), `${origin}/`);
    }
    absolute.pathname = absolute.pathname.replace(/(\/api\/v1)+/g, '/api/v1');
    return absolute.href;
  } catch {
    return url;
  }
}

function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const id = `ym-ai-${++proxyIdCounter}-${Date.now()}`;
    const started = performance.now();
    ymDiag.info('ai', 'proxy fetch start', {
      id,
      url,
      method: init?.method || 'GET',
      transport: inIframe ? 'postMessage' : 'BroadcastChannel',
    });
    const timeout = setTimeout(() => {
      cleanup();
      ymDiag.error('ai', 'proxy timeout', { id, url, ms: Math.round(performance.now() - started) });
      reject(
        new Error(
          inNewTab
            ? 'AI proxy timeout (60 s). Keep the YellowStorm tab open — the proxy runs there.'
            : 'AI proxy timeout (60 s). Is the preview panel open?',
        ),
      );
    }, 60_000);

    const payload = {
      type: 'ym-ai-fetch',
      id,
      url,
      method: init?.method || 'GET',
      // Strip OpenAI SDK stainless headers — parent CORS allowlist rejects them.
      headers: sanitizeProxyHeaders(init?.headers),
      body: init?.body || undefined,
    };

    function onResponse(data: Record<string, unknown>) {
      if (data?.type !== 'ym-ai-response' || data.id !== id) return;
      cleanup();
      if (data.error) {
        ymDiag.error('ai', 'proxy error response', {
          id,
          error: data.error,
          ms: Math.round(performance.now() - started),
        });
        reject(new Error(data.error as string));
        return;
      }
      ymDiag.info('ai', 'proxy fetch ok', {
        id,
        status: data.status,
        ms: Math.round(performance.now() - started),
      });
      const headers = new Headers((data.headers as Record<string, string>) || {});
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      // Unwrap YellowStorm `{ success, data }` if present — OpenAI SDK expects raw completion JSON.
      let bodyText = (data.body as string) ?? '';
      try {
        const parsed = JSON.parse(bodyText) as Record<string, unknown>;
        if (
          parsed
          && parsed.success === true
          && parsed.data
          && typeof parsed.data === 'object'
          && !Array.isArray(parsed.data)
        ) {
          bodyText = JSON.stringify(parsed.data);
        }
      } catch {
        // leave body as-is
      }
      resolve(
        new Response(bodyText, {
          status: (data.status as number) ?? 200,
          headers,
        }),
      );
    }

    let cleanup: () => void;

    if (inIframe) {
      const handler = (event: MessageEvent) => onResponse(event.data);
      window.addEventListener('message', handler);
      cleanup = () => {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
      };
      window.parent.postMessage(payload, '*');
    } else {
      const bc = getBroadcastChannel();
      const handler = (event: MessageEvent) => onResponse(event.data);
      bc.addEventListener('message', handler);
      cleanup = () => {
        clearTimeout(timeout);
        bc.removeEventListener('message', handler);
      };
      bc.postMessage(payload);
    }
  });
}

/**
 * Build an OpenAI client pointed at the YellowStorm reverse proxy.
 * Preview (`VITE_YM_AI_PROXY`): custom fetch via parent relay — no end-user JWT required.
 * Otherwise: App Data end-user session token as `apiKey`.
 */
export function createAIClient(accessToken?: string): OpenAI {
  const baseURL = resolveAiApiBaseUrl();

  if (proxyEnabled) {
    ymDiag.info('ai', 'createAIClient (preview relay)', { baseURL });
    return new OpenAI({
      baseURL,
      // Placeholder only — parent relay replaces Authorization with the AI preview ticket.
      apiKey: 'ym-ai-preview',
      dangerouslyAllowBrowser: true,
      fetch: (url, init) => proxyFetch(normalizeAiFetchUrl(String(url), baseURL), init),
    });
  }

  const token = accessToken ?? getAuthToken();
  if (!token) {
    ymDiag.warn('ai', 'createAIClient missing token', { isDevPreview: isDevPreview() });
    if (isDevPreview()) {
      throw new Error(
        'AI is not available in this preview yet. Refresh after setup completes, or use the deployed app and sign in.',
      );
    }
    throw new Error('Not authenticated — log in before using AI.');
  }

  ymDiag.info('ai', 'createAIClient (end-user JWT)', { baseURL, hasToken: true });
  return new OpenAI({
    baseURL,
    apiKey: token,
    dangerouslyAllowBrowser: true,
    // Strip x-stainless-* so Nest CORS preflight succeeds (same as preview relay).
    fetch: (url, init) =>
      fetch(normalizeAiFetchUrl(String(url), baseURL), {
        ...init,
        headers: sanitizeAiClientHeaders(init?.headers, { includeAuthorization: true }),
      }),
  });
}

/** List models exposed by the AI proxy (active catalog / allowlist). */
export async function listAIModels(accessToken?: string) {
  const client = createAIClient(accessToken);
  return client.models.list();
}

let cachedDefaultModelId: string | null = null;

/**
 * Resolve a chat model id that the AI proxy will accept.
 * Prefer `VITE_YM_AI_DEFAULT_MODEL` (host-injected), else first catalog entry.
 * Never hardcode `gpt-4o` — it may be absent from the tenant catalog.
 */
export async function resolveDefaultAiModel(accessToken?: string): Promise<string> {
  const fromEnv = (import.meta.env.VITE_YM_AI_DEFAULT_MODEL as string | undefined)?.trim();
  if (fromEnv) {
    cachedDefaultModelId = fromEnv;
    return fromEnv;
  }
  if (cachedDefaultModelId) return cachedDefaultModelId;

  const listed = await listAIModels(accessToken);
  const first = listed.data?.[0]?.id?.trim();
  if (!first) {
    throw new Error(
      'No AI models are available right now. Please try again later or contact support.',
    );
  }
  cachedDefaultModelId = first;
  ymDiag.info('ai', 'resolved default model from catalog', { model: first });
  return first;
}

/** Build chat.completions.create params; omit optional sampling fields unless set. */
function buildChatCompletionParams(
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options: {
    temperature?: number;
    max_tokens?: number;
    stream: boolean;
  },
): OpenAI.Chat.ChatCompletionCreateParams {
  const params: OpenAI.Chat.ChatCompletionCreateParams = {
    model,
    messages,
    stream: options.stream,
  };
  if (options.temperature !== undefined) {
    params.temperature = options.temperature;
  }
  if (options.max_tokens !== undefined) {
    params.max_tokens = options.max_tokens;
  }
  return params;
}

/**
 * Extract visible assistant text from a chat completion.
 * Reasoning models may return empty `message.content` while still 200 —
 * prefer content, then common alternate fields.
 */
export function getAssistantText(
  completion: OpenAI.Chat.ChatCompletion | null | undefined,
): string {
  const choice = completion?.choices?.[0];
  const message = choice?.message as
    | (OpenAI.Chat.ChatCompletionMessage & Record<string, unknown>)
    | undefined;
  if (!message) return '';

  if (typeof message.content === 'string' && message.content.trim()) {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    const joined = message.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join('')
      .trim();
    if (joined) return joined;
  }

  for (const key of ['reasoning_content', 'refusal'] as const) {
    const value = message[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

/** Non-streaming chat completion helper. */
export async function chatCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: {
    model?: string;
    /** Optional — omit for reasoning models that reject temperature. */
    temperature?: number;
    max_tokens?: number;
    accessToken?: string;
  },
) {
  const model = options?.model?.trim() || (await resolveDefaultAiModel(options?.accessToken));
  ymDiag.info('ai', 'chatCompletion', {
    model,
    messageCount: messages.length,
    stream: false,
    hasTemperature: options?.temperature !== undefined,
  });
  const client = createAIClient(options?.accessToken);
  try {
    const result = await client.chat.completions.create(
      buildChatCompletionParams(model, messages, {
        temperature: options?.temperature,
        max_tokens: options?.max_tokens,
        stream: false,
      }),
    );
    const text = getAssistantText(result);
    ymDiag.debug('ai', 'chatCompletion ok', {
      model,
      id: result.id,
      choices: result.choices?.length,
      finishReason: result.choices?.[0]?.finish_reason,
      textChars: text.length,
    });
    if (!text) {
      ymDiag.warn('ai', 'chatCompletion empty assistant text', {
        model,
        finishReason: result.choices?.[0]?.finish_reason,
        usage: result.usage,
      });
    }
    return result;
  } catch (err) {
    ymDiag.error('ai', 'chatCompletion failed', {
      model,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Streaming chat completion helper.
 * In preview relay mode, streaming is coerced to a single JSON response by the parent.
 */
export async function streamChatCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: {
    model?: string;
    /** Optional — omit for reasoning models that reject temperature. */
    temperature?: number;
    max_tokens?: number;
    accessToken?: string;
  },
) {
  const model = options?.model?.trim() || (await resolveDefaultAiModel(options?.accessToken));
  const client = createAIClient(options?.accessToken);
  const params = buildChatCompletionParams(model, messages, {
    temperature: options?.temperature,
    max_tokens: options?.max_tokens,
    stream: !proxyEnabled,
  });
  return client.chat.completions.create(params);
}
