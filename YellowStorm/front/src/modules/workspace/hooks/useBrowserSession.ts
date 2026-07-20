import { useCallback, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { AUTH_STORAGE_KEYS, getSocketBaseUrl } from '@/lib/api/config';

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

export interface CollectedPage { url: string; title: string; linkText?: string; }
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

export function useBrowserSession() {
  const socketRef = useRef<Socket | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const [status, setStatus] = useState<BrowserSessionStatus>('idle');
  const [frame, setFrame] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [pages, setPages] = useState<CollectedPage[]>([]);
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);

  const start = useCallback((url: string) => {
    const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    if (!token) { setStatus('error'); return; }
    setStatus('connecting');
    seenRef.current = new Set();
    setPages([]); setFrame(null); setBlockedNotice(null); setCurrentUrl(url);

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
    socket.on('blocked', (p: { url: string; reason: string }) =>
      setBlockedNotice(`Navigation bloquée (${p.url}) : ${p.reason}`));
    socket.on('closed', () => setStatus('idle'));
    socket.on('disconnect', () => setStatus('idle'));

    socket.emit('start', { url }, (res: { ok: boolean; sessionId?: string; error?: string }) => {
      if (res.ok) setStatus('live');
      else setStatus(res.error === 'BUSY' ? 'busy' : 'error');
    });
  }, []);

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
  }, []);

  return { status, frame, currentUrl, pages, blockedNotice, start, sendInput, navigate, stop };
}
