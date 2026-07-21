import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const handlers: Record<string, (p: unknown) => void> = {};
const emit = vi.fn((event: string, payload: unknown, ack?: (r: unknown) => void) => {
  if (event === 'start' && ack) ack({ ok: true, sessionId: 's1' });
});
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (e: string, cb: (p: unknown) => void) => { handlers[e] = cb; },
    off: vi.fn(),
    emit,
    disconnect: vi.fn(),
  }),
}));
vi.mock('@/lib/api/config', () => ({
  getSocketBaseUrl: () => 'http://x',
  AUTH_STORAGE_KEYS: { accessToken: 'at' },
}));

import { useBrowserSession, normalizeUrl } from './useBrowserSession';

beforeEach(() => { localStorage.setItem('at', 'tok'); emit.mockClear(); });

describe('normalizeUrl', () => {
  it('strips hash and trailing slash and lowercases host', () => {
    expect(normalizeUrl('https://Ex.com/a/#x')).toBe('https://ex.com/a');
    expect(normalizeUrl('https://ex.com/')).toBe('https://ex.com');
  });
});

describe('useBrowserSession', () => {
  it('starts a session and paints frames', async () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://ok.example'); });
    await waitFor(() => expect(result.current.status).toBe('live'));
    act(() => { handlers['frame']({ data: 'B64' }); });
    expect(result.current.frame).toBe('data:image/jpeg;base64,B64');
  });

  it('collects navigations deduped by normalized url', async () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://ok.example'); });
    await waitFor(() => expect(result.current.status).toBe('live'));
    act(() => {
      handlers['navigated']({ url: 'https://ok.example/a', title: 'A' });
      handlers['navigated']({ url: 'https://ok.example/a/#frag', title: 'A' });
      handlers['navigated']({ url: 'https://ok.example/b', title: 'B' });
    });
    expect(result.current.pages.map((p) => p.title)).toEqual(['A', 'B']);
  });

  it('stores the clicked link text on the collected page', async () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://ok.example'); });
    await waitFor(() => expect(result.current.status).toBe('live'));
    act(() => { handlers['navigated']({ url: 'https://ok.example/a', title: 'A', linkText: 'About Us' }); });
    expect(result.current.pages[0].linkText).toBe('About Us');
  });

  it('surfaces a blocked notice', async () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://ok.example'); });
    await waitFor(() => expect(result.current.status).toBe('live'));
    act(() => { handlers['blocked']({ url: 'http://169.254.169.254/', reason: 'blocked' }); });
    expect(result.current.blockedNotice).toContain('169.254');
  });

  it('reports busy when start is rejected', async () => {
    emit.mockImplementationOnce((_e, _p, ack?: (r: unknown) => void) => ack?.({ ok: false, error: 'BUSY' }));
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://ok.example'); });
    await waitFor(() => expect(result.current.status).toBe('busy'));
  });

  it('retains the session root url across navigations', async () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://root.example/start'); });
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.rootUrl).toBe('https://root.example/start');
    act(() => { handlers['navigated']({ url: 'https://root.example/other', title: 'Other' }); });
    expect(result.current.currentUrl).toBe('https://root.example/other');
    expect(result.current.rootUrl).toBe('https://root.example/start');
  });

  it('addManualPage adds a manual page and rejects invalid/duplicate urls', () => {
    const { result } = renderHook(() => useBrowserSession());
    let ok!: boolean;
    act(() => { ok = result.current.addManualPage('https://other.org/docs', '  My  Docs '); });
    expect(ok).toBe(true);
    expect(result.current.pages.at(-1)).toMatchObject({ url: 'https://other.org/docs', linkText: 'My Docs', manual: true });
    act(() => { ok = result.current.addManualPage('https://other.org/docs'); }); // duplicate
    expect(ok).toBe(false);
    act(() => { ok = result.current.addManualPage('not a url'); }); // invalid
    expect(ok).toBe(false);
    expect(result.current.pages).toHaveLength(1);
  });

  it('start seeds the collection and dedups a later navigation to a seeded url', async () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.start('https://root.example', [{ url: 'https://root.example/a', title: '', indexingStatus: 'ready' }]); });
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.pages).toHaveLength(1);
    expect(result.current.pages[0]).toMatchObject({ url: 'https://root.example/a', indexingStatus: 'ready' });
    act(() => { handlers['navigated']({ url: 'https://root.example/a', title: 'A' }); }); // same as seeded → deduped
    expect(result.current.pages).toHaveLength(1);
    act(() => { handlers['navigated']({ url: 'https://root.example/b', title: 'B' }); }); // new → added
    expect(result.current.pages).toHaveLength(2);
  });

  it('updatePage edits name and url and rejects collisions', () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.addManualPage('https://a.com/x', 'X'); });
    act(() => { result.current.addManualPage('https://b.com/y', 'Y'); });
    let ok!: boolean;
    act(() => { ok = result.current.updatePage('https://a.com/x', { name: 'New Name', url: 'https://a.com/z' }); });
    expect(ok).toBe(true);
    expect(result.current.pages.find((p) => p.url === 'https://a.com/z')).toMatchObject({ linkText: 'New Name', url: 'https://a.com/z' });
    act(() => { ok = result.current.updatePage('https://a.com/z', { url: 'https://b.com/y' }); }); // collides with Y
    expect(ok).toBe(false);
  });

  it('addPages batch-adds new pages and dedups already-seen ones', () => {
    const { result } = renderHook(() => useBrowserSession());
    act(() => { result.current.addManualPage('https://a.com/x'); });
    let added!: number;
    act(() => { added = result.current.addPages([{ url: 'https://a.com/x', title: '' }, { url: 'https://a.com/y', title: 'Y' }]); });
    expect(added).toBe(1); // x already seen, y new
    expect(result.current.pages.map((p) => p.url)).toContain('https://a.com/y');
  });
});
