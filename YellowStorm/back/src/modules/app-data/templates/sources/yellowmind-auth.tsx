/**
 * App-scoped authentication for generated React/Vite apps.
 * Register/login against YellowStorm App Data public auth API.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const TOKEN_KEY = 'ym_app_auth_token';
const USER_KEY = 'ym_app_auth_user';

export interface AppUser {
  id: string;
  email: string;
  displayName: string | null;
}

interface AuthState {
  user: AppUser | null;
  token: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const proxyEnabled = import.meta.env.VITE_YM_APP_DATA_PROXY === 'true' && typeof window !== 'undefined';
const inIframe = proxyEnabled && window.parent !== window;
const inNewTab = proxyEnabled && window.parent === window;

function resolveAuthBaseUrl(): string {
  const dataUrl = import.meta.env.VITE_YM_APP_DATA_URL as string | undefined;
  const appDataId = import.meta.env.VITE_YM_APP_DATA_ID as string | undefined;
  if (!dataUrl || !appDataId) {
    throw new Error('App auth is not configured (missing VITE_YM_APP_DATA_URL or VITE_YM_APP_DATA_ID).');
  }
  const trimmed = dataUrl.replace(/\/$/, '');
  const withoutEnv = trimmed.replace(/\/(dev|prod)$/, '');
  return `${withoutEnv}/auth`;
}

let proxyIdCounter = 0;
let broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel {
  if (!broadcastChannel) broadcastChannel = new BroadcastChannel('ym-app-data-proxy');
  return broadcastChannel;
}

function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const id = `ym-auth-${++proxyIdCounter}-${Date.now()}`;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Auth proxy timeout (30 s).'));
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
      if (data.error) { reject(new Error(data.error as string)); return; }
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

async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  if (proxyEnabled) return proxyFetch(url, init);
  return fetch(url, init);
}

async function parseJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Auth expected JSON (status ${res.status})`);
  }
  try { return JSON.parse(text); } catch { throw new Error('Auth response was not valid JSON'); }
}

function persistSession(token: string, user: AppUser) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AppUser | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as AppUser; } catch { return null; }
}

export async function login(email: string, password: string): Promise<{ token: string; user: AppUser }> {
  const base = resolveAuthBaseUrl();
  const res = await authFetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const payload = (await parseJsonResponse(res)) as { token?: string; user?: AppUser; message?: string };
  if (!res.ok) throw new Error(payload?.message ?? `Login failed (${res.status})`);
  if (!payload.token || !payload.user) throw new Error('Login response missing token or user');
  persistSession(payload.token, payload.user);
  return { token: payload.token, user: payload.user };
}

export async function register(email: string, password: string, displayName?: string): Promise<{ token: string; user: AppUser }> {
  const base = resolveAuthBaseUrl();
  const res = await authFetch(`${base}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName }),
  });
  const payload = (await parseJsonResponse(res)) as { token?: string; user?: AppUser; message?: string };
  if (!res.ok) throw new Error(payload?.message ?? `Register failed (${res.status})`);
  if (!payload.token || !payload.user) throw new Error('Register response missing token or user');
  persistSession(payload.token, payload.user);
  return { token: payload.token, user: payload.user };
}

export async function getMe(): Promise<AppUser> {
  const token = getAuthToken();
  if (!token) throw new Error('Not authenticated');
  const base = resolveAuthBaseUrl();
  const res = await authFetch(`${base}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = (await parseJsonResponse(res)) as { user?: AppUser; message?: string };
  if (!res.ok) throw new Error(payload?.message ?? `Auth check failed (${res.status})`);
  if (!payload.user) throw new Error('Auth response missing user');
  persistSession(token, payload.user);
  return payload.user;
}

export function logout(): void {
  clearSession();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: getStoredUser(),
    token: getAuthToken(),
    isLoading: true,
  });

  const refreshMe = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setState({ user: null, token: null, isLoading: false });
      return;
    }
    try {
      const user = await getMe();
      setState({ user, token, isLoading: false });
    } catch {
      clearSession();
      setState({ user: null, token: null, isLoading: false });
    }
  }, []);

  useEffect(() => { void refreshMe(); }, [refreshMe]);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    login: async (email, password) => {
      const { token, user } = await login(email, password);
      setState({ user, token, isLoading: false });
    },
    register: async (email, password, displayName) => {
      const { token, user } = await register(email, password, displayName);
      setState({ user, token, isLoading: false });
    },
    logout: () => {
      logout();
      setState({ user: null, token: null, isLoading: false });
    },
    refreshMe,
  }), [state, refreshMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
