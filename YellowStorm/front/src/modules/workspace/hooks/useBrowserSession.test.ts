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
});
