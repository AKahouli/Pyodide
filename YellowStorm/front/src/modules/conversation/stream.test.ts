import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationStreamService as service } from './stream';
import { setAccessToken } from '@/lib/api/access-token-store';
vi.mock('@/lib/api/config', () => ({ API_CONFIG: { baseURL: 'https://api.example.test' } }));
vi.mock('./translation', () => ({ translateConversation: (key: string) => key }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ refreshAccessToken: refresh }));
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const connections: { url: string; init: RequestInit; push: (s: string) => void; close: () => void }[] = [];
const fetchMock = vi.fn((url: string, init: RequestInit) => {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  connections.push({ url, init, push: s => controller.enqueue(new TextEncoder().encode(s)), close: () => controller.close() });
  return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
});
const frame = (type: string, data: unknown, id = '') => `event: ${type}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`;
describe('classic fetch SSE', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); connections.length = 0; setAccessToken('secret'); service.disconnect(); refresh.mockReset(); });
  afterEach(() => { service.disconnect(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('uses header authentication, one pipe and aborts on disconnect', async () => {
    service.connect(); service.ensureConnected(); await settle();
    expect(connections).toHaveLength(1);
    expect(connections[0].url).toBe('https://api.example.test/conversations/stream');
    expect(connections[0].init.headers).toMatchObject({ Authorization: 'Bearer secret' });
    service.disconnect(); expect(connections[0].init.signal?.aborted).toBe(true);
  });
  it('rejects missing token without a request', () => {
    setAccessToken(null); service.connect(); expect(connections).toHaveLength(0);
  });
  it('parses fragmented CRLF, comments and multiline data, unwraps legacy frames and resumes', async () => {
    const listener = vi.fn(); const off = service.subscribe(listener);
    service.connect(); await settle();
    connections[0].push(':comment\r\nevent: connected\r'); await settle();
    connections[0].push('\ndata: {"connectionId":\r\ndata: "conn"}\r\n\r\n'); await settle();
    connections[0].push('data: {"type":"stream_start","id":"boot:2:3","data":{"messageId":"m"}}\n\n'); await settle();
    expect(service.getIsConnected()).toBe(true);
    expect(listener).toHaveBeenCalledWith({ type: 'stream_start', data: { messageId: 'm' } });
    connections[0].close(); await settle(); await vi.advanceTimersByTimeAsync(1000);
    expect(connections[1].url).toContain('cursor=boot%3A2%3A3'); off();
  });
  it('preserves cursor on refresh and drops it on account replacement', async () => {
    service.connect(); await settle(); connections[0].push(frame('stream_chunk', {}, 'boot:1:7')); await settle();
    setAccessToken('refreshed'); service.reconnectWithNewToken(); await settle();
    expect(connections[0].init.signal?.aborted).toBe(true);
    expect(connections[1].url).toContain('cursor=boot%3A1%3A7');
    expect(connections[1].init.headers).toMatchObject({ Authorization: 'Bearer refreshed' });
    setAccessToken('other'); service.connect(); await settle(); expect(connections[2].url).not.toContain('cursor');
  });
  it('drops actor cursor on session replacement and aborts when credentials disappear', async () => {
    const token = (sub: string) => `header.${btoa(JSON.stringify({ sub, sessionId: 'session' }))}.signature`;
    setAccessToken(token('first')); service.connect(); await settle();
    connections[0].push(frame('stream_chunk', {}, 'boot:1:7')); await settle();
    setAccessToken(token('second')); service.reconnectWithNewToken(); await settle();
    expect(connections[1].url).not.toContain('cursor');
    setAccessToken(null); service.connect(); expect(connections[1].init.signal?.aborted).toBe(true);
  });
  it('ignores queued old-actor frames immediately when the shared token changes', async () => {
    service.reconnectWithNewToken(); await settle();
    const listener = vi.fn(); const off = service.subscribe(listener);
    setAccessToken('replacement');
    connections[0].push(frame('stream_chunk', { messageId: 'foreign' }, 'boot:1:8')); await settle();
    expect(listener).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(connections[1].init.headers).toMatchObject({ Authorization: 'Bearer replacement' });
    expect(connections[1].url).not.toContain('cursor'); off();
  });
  it('ignores numeric heartbeat IDs, restores watchdog and evicts without reconnect', async () => {
    service.reconnectWithNewToken(); await settle(); connections[0].push(frame('connected', { connectionId: 'c' }, '1')); await settle();
    await vi.advanceTimersByTimeAsync(31000); expect(connections[1].url).not.toContain('cursor');
    connections[1].push(frame('error', { code: 'ERR_1405' })); await settle();
    await vi.advanceTimersByTimeAsync(120000); expect(connections).toHaveLength(2);
    expect(connections[1].init.signal?.aborted).toBe(true);
  });
  it('refreshes 401 through the shared authentication owner', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 401 })));
    refresh.mockImplementation(async () => { setAccessToken('fresh'); service.reconnectWithNewToken(); return 'fresh'; });
    service.reconnectWithNewToken(); await settle();
    expect(refresh).toHaveBeenCalledWith('secret'); expect(connections[0].init.headers).toMatchObject({ Authorization: 'Bearer fresh' });
  });
  it('preserves chart normalization and resync event delivery', async () => {
    service.reconnectWithNewToken(); await settle();
    const listener = vi.fn(); const off = service.subscribe(listener);
    connections[0].push(frame('stream_chunk', { component: { type: 'chart', data: { data: '[{"x":1}]', series: '[{"dataKey":"x"}]' } } }));
    connections[0].push(frame('stream_resync_required', { reason: 'cursor_gap' })); await settle();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'stream_chunk', data: { component: { type: 'chart', data: expect.objectContaining({ data: [{ x: 1 }], series: [{ dataKey: 'x' }] }) } } }));
    expect(listener).toHaveBeenCalledWith({ type: 'stream_resync_required', data: { reason: 'cursor_gap' } }); off();
  });
  it('drops the unreplayable cursor after a resync so reconnects start cursor-less', async () => {
    service.connect(); await settle();
    connections[0].push(frame('stream_chunk', {}, 'boot:1:9')); await settle();
    connections[0].push(frame('stream_resync_required', { reason: 'cursor_gap' })); await settle();
    connections[0].close(); await settle(); await vi.advanceTimersByTimeAsync(1000);
    // The server proved it cannot replay from boot:1:9; re-sending it would
    // re-trigger the resync warn on every reconnect.
    expect(connections[1].url).not.toContain('cursor');
  });
  it('bounds fragmented multiline frames and reconnects without emitting partial payloads', async () => {
    service.reconnectWithNewToken(); await settle();
    const listener = vi.fn(); const off = service.subscribe(listener);
    for (let index = 0; index < 11; index++) { connections[0].push(`data: ${'x'.repeat(100000)}\n`); await settle(); }
    await vi.advanceTimersByTimeAsync(1000);
    expect(connections).toHaveLength(2); expect(listener).not.toHaveBeenCalled(); off();
  });
  it('caps exponential retries through repeated network failures and resets after recovery', async () => {
    for (let index = 0; index < 12; index++) fetchMock.mockRejectedValueOnce(new Error('transport unavailable'));
    service.reconnectWithNewToken(); await settle();
    for (let index = 0; index < 12; index++) {
      expect(fetchMock).toHaveBeenCalledTimes(index + 1);
      const before = Date.now();
      await vi.advanceTimersToNextTimerAsync(); await settle();
      expect(Date.now() - before).toBe(Math.min(1000 * 2 ** index, 60000));
    }
    expect(connections).toHaveLength(1);
    connections[0].close(); await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(14);
  });
  it('retries EOF indefinitely with capped delay', async () => {
    service.reconnectWithNewToken(); await settle();
    for (let i = 0; i < 12; i++) { const current = connections.at(-1)!; current.close(); await settle(); await vi.advanceTimersByTimeAsync(1000); }
    expect(connections.length).toBeGreaterThan(10);
  });
});
