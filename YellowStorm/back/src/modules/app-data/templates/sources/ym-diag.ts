/**
 * YellowMind diagnostic logger for generated apps (preview + local debug).
 * Safe-by-default: no secrets, tokens, passwords, or Authorization values.
 *
 * Console filter: `[ym-diag]`
 * Browser console: `window.__YM_DIAG__.dump()` / `.snapshot()` / `.clear()`
 *
 * Enabled when `VITE_YM_DEBUG=true` (explicit). Silent by default in Preview Dev
 * so end users never see diagnostic noise; agents still use preview_inspect.
 */
export type YmDiagLevel = 'debug' | 'info' | 'warn' | 'error';

export interface YmDiagEntry {
  t: string;
  level: YmDiagLevel;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
}

const MAX_ENTRIES = 200;
const PREFIX = '[ym-diag]';

const SECRET_KEY =
  /^(authorization|api[-_]?key|token|password|secret|cookie|set-cookie|ym_app_auth_token|accessToken|refreshToken)$/i;
const SECRET_VALUE = /^(Bearer\s+\S+|aiprev_\S+|sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.)/i;

function isEnabled(): boolean {
  try {
    return import.meta.env.VITE_YM_DEBUG === 'true';
  } catch {
    return false;
  }
}

const entries: YmDiagEntry[] = [];

function redactValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) return '[redacted]';
    if (value.length > 500) return `${value.slice(0, 200)}…(+${value.length - 200} chars)`;
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(redactValue);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : redactValue(v);
    }
    return out;
  }
  return value;
}

function push(
  level: YmDiagLevel,
  scope: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!isEnabled()) return;
  const entry: YmDiagEntry = {
    t: new Date().toISOString(),
    level,
    scope,
    message,
    data: data ? (redactValue(data) as Record<string, unknown>) : undefined,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  const label = `${PREFIX} ${scope} — ${message}`;
  const payload = entry.data ?? '';
  switch (level) {
    case 'error':
      console.error(label, payload);
      break;
    case 'warn':
      console.warn(label, payload);
      break;
    case 'debug':
      console.debug(label, payload);
      break;
    default:
      console.info(label, payload);
  }
}

export const ymDiag = {
  enabled: isEnabled,
  debug: (scope: string, message: string, data?: Record<string, unknown>) => { push('debug', scope, message, data); },
  info: (scope: string, message: string, data?: Record<string, unknown>) => { push('info', scope, message, data); },
  warn: (scope: string, message: string, data?: Record<string, unknown>) => { push('warn', scope, message, data); },
  error: (scope: string, message: string, data?: Record<string, unknown>) => { push('error', scope, message, data); },

  /** Safe env / runtime snapshot for Preview debugging. */
  snapshot(): Record<string, unknown> {
    const env = import.meta.env as Record<string, unknown>;
    const viteKeys = Object.keys(env)
      .filter((k) => k.startsWith('VITE_') || k === 'DEV' || k === 'MODE' || k === 'PROD' || k === 'BASE_URL')
      .sort();
    const viteEnv: Record<string, unknown> = {};
    for (const k of viteKeys) {
      viteEnv[k] = SECRET_KEY.test(k) ? '[redacted]' : env[k];
    }

    return {
      at: new Date().toISOString(),
      href: typeof window !== 'undefined' ? window.location.href : null,
      origin: typeof window !== 'undefined' ? window.location.origin : null,
      pathname: typeof window !== 'undefined' ? window.location.pathname : null,
      inIframe: typeof window !== 'undefined' ? window.parent !== window : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      viteEnv,
      flags: {
        appDataProxy: env.VITE_YM_APP_DATA_PROXY === 'true',
        aiProxy: env.VITE_YM_AI_PROXY === 'true',
        appDataEnv: env.VITE_YM_APP_DATA_ENV ?? null,
        hasAppDataUrl: Boolean(env.VITE_YM_APP_DATA_URL),
        hasAppDataId: Boolean(env.VITE_YM_APP_DATA_ID),
        hasAiApiBase: Boolean(env.VITE_YM_API_BASE_URL),
        hasSessionToken:
          typeof sessionStorage !== 'undefined'
            ? Boolean(sessionStorage.getItem('ym_app_auth_token'))
            : false,
      },
      bufferSize: entries.length,
    };
  },

  dump(): YmDiagEntry[] {
    return entries.slice();
  },

  clear(): void {
    entries.length = 0;
  },

  boot(): void {
    if (!isEnabled()) return;
    const snap = this.snapshot();
    push('info', 'boot', 'YellowMind app diagnostic boot', snap);
    console.info(
      `${PREFIX} tip: window.__YM_DIAG__.dump() | .snapshot() | .clear()`,
    );
  },
};

export type YmDiagApi = typeof ymDiag & {
  entries: YmDiagEntry[];
};

declare global {
  interface Window {
    __YM_DIAG__?: YmDiagApi;
  }
}

if (typeof window !== 'undefined' && isEnabled()) {
  window.__YM_DIAG__ = Object.assign(ymDiag, {
    get entries() {
      return entries.slice();
    },
  });

  window.addEventListener('error', (event) => {
    ymDiag.error('runtime', 'uncaught error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    ymDiag.error('runtime', 'unhandledrejection', {
      message: reason instanceof Error ? reason.message : String(reason),
    });
  });
}
