import { useCallback, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { AUTH_STORAGE_KEYS, getSocketBaseUrl } from '@/lib/api/config';
import type { IndexingStatus } from '../types';

// 16:9 remote viewport. Must stay in sync with the backend `browserSession`
// viewport config (BROWSER_SESSION_VIEWPORT_W/H) so input coordinates line up.
export const VIEWPORT_W = 1280;
export const VIEWPORT_H = 720;

export type MouseButton = 'left' | 'right' | 'middle';
export type InputEvent =
  | { kind: 'mouse'; type: 'move' | 'down' | 'up'; x: number; y: number; button?: MouseButton }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: 'key'; type: 'down' | 'up'; key: string; text?: string };
export type NavAction =
  | { kind: 'goto'; url: string } | { kind: 'back' } | { kind: 'forward' } | { kind: 'reload' };

export interface CollectedPage { url: string; title: string; linkText?: string; manual?: boolean; indexingStatus?: IndexingStatus; }
export type BrowserSessionStatus = 'idle' | 'connecting' | 'live' | 'busy' | 'error';

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// A page that stops firing load/domcontentloaded (e.g. an SPA client-side route
// change) must never leave the spinner stuck — force it off after this long.
const LOADING_SAFETY_MS = 12_000;

export function useBrowserSession() {
  const socketRef = useRef<Socket | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<BrowserSessionStatus>('idle');
  const [frame, setFrame] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [rootUrl, setRootUrl] = useState<string | null>(null);
  const [pages, setPages] = useState<CollectedPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);

  const setLoadingSafe = useCallback((next: boolean) => {
    if (loadingTimerRef.current) { clearTimeout(loadingTimerRef.current); loadingTimerRef.current = null; }
    setLoading(next);
    if (next) {
      loadingTimerRef.current = setTimeout(() => { setLoading(false); loadingTimerRef.current = null; }, LOADING_SAFETY_MS);
    }
  }, []);

  const start = useCallback((url: string, seed: CollectedPage[] = []) => {
    const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    if (!token) { setStatus('error'); return; }
    setStatus('connecting');
    seenRef.current = new Set(seed.map((p) => normalizeUrl(p.url)));
    setPages(seed); setFrame(null); setBlockedNotice(null); setCurrentUrl(url); setRootUrl(url); setLoadingSafe(false);

    const socket = io(`${getSocketBaseUrl()}/browser-session`, {
      auth: { token }, transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('frame', (p: { data: string }) => setFrame(`data:image/jpeg;base64,${p.data}`));
    socket.on('navigated', (p: CollectedPage) => {
      setCurrentUrl(p.url);
      const key = normalizeUrl(p.url);
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);
      setPages((prev) => [...prev, { url: p.url, title: p.title || '', linkText: p.linkText }]);
    });
    socket.on('loading', (p: { loading: boolean }) => setLoadingSafe(Boolean(p.loading)));
    socket.on('blocked', (p: { url: string; reason: string }) =>
      setBlockedNotice(`Navigation bloquée (${p.url}) : ${p.reason}`));
    socket.on('closed', () => setStatus('idle'));
    socket.on('disconnect', () => setStatus('idle'));

    socket.emit('start', { url }, (res: { ok: boolean; sessionId?: string; error?: string }) => {
      if (res.ok) setStatus('live');
      else setStatus(res.error === 'BUSY' ? 'busy' : 'error');
    });
  }, [setLoadingSafe]);

  const sendInput = useCallback((event: InputEvent) => {
    socketRef.current?.emit('input', { event });
  }, []);
  const navigate = useCallback((action: NavAction) => {
    socketRef.current?.emit('navigate', { action });
  }, []);
  const stop = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setStatus('idle');
    setLoadingSafe(false);
  }, [setLoadingSafe]);

  const addManualPage = useCallback((url: string, name?: string): boolean => {
    if (!isHttpUrl(url)) return false;
    const key = normalizeUrl(url);
    if (seenRef.current.has(key)) return false;
    seenRef.current.add(key);
    const linkText = name?.replace(/\s+/g, ' ').trim() || undefined;
    setPages((prev) => [...prev, { url: url.trim(), title: '', linkText, manual: true }]);
    return true;
  }, []);

  const updatePage = useCallback((oldUrl: string, patch: { url?: string; name?: string }): boolean => {
    const oldKey = normalizeUrl(oldUrl);
    if (!seenRef.current.has(oldKey)) return false; // no such page
    let newUrl: string | undefined;
    if (patch.url !== undefined && patch.url !== oldUrl) {
      if (!isHttpUrl(patch.url)) return false;
      const newKey = normalizeUrl(patch.url);
      if (newKey !== oldKey && seenRef.current.has(newKey)) return false; // collides with another page
      newUrl = patch.url.trim();
      seenRef.current.delete(oldKey);
      seenRef.current.add(newKey);
    }
    setPages((prev) =>
      prev.map((p) =>
        p.url === oldUrl
          ? {
              ...p,
              ...(newUrl !== undefined ? { url: newUrl } : {}),
              ...(patch.name !== undefined ? { linkText: patch.name.replace(/\s+/g, ' ').trim() || undefined } : {}),
            }
          : p,
      ),
    );
    return true;
  }, []);

  const removePage = useCallback((url: string): boolean => {
    const key = normalizeUrl(url);
    if (!seenRef.current.has(key)) return false;
    // Drop from `seenRef` too so the same URL can be re-collected or re-added later.
    seenRef.current.delete(key);
    setPages((prev) => prev.filter((p) => p.url !== url));
    return true;
  }, []);

  const addPages = useCallback((incoming: CollectedPage[]): number => {
    const fresh = incoming.filter((p) => {
      const key = normalizeUrl(p.url);
      if (seenRef.current.has(key)) return false;
      seenRef.current.add(key);
      return true;
    });
    if (fresh.length > 0) setPages((prev) => [...prev, ...fresh]);
    return fresh.length;
  }, []);

  return { status, frame, currentUrl, rootUrl, pages, loading, blockedNotice, start, sendInput, navigate, stop, addManualPage, updatePage, addPages, removePage };
}
