import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.unmock('@/lib/api/client');
const post = vi.hoisted(() => vi.fn());
const reconnect = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { create: () => ({ post, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } }) } }));
vi.mock('@/modules/notifications', () => ({ notificationsService: { reconnectWithNewToken: reconnect } }));
vi.mock('@/modules/conversation/stream', () => ({ conversationStreamService: { reconnectWithNewToken: reconnect, ensureConnected: vi.fn() } }));
vi.mock('@/modules/conversation-v2/conversationV2Stream', () => ({ conversationV2StreamService: { reconnectWithNewToken: reconnect } }));

class Channel {
  static peers: Channel[] = [];
  listeners = new Set<(event: MessageEvent) => void>();
  constructor(readonly name: string) { Channel.peers.push(this); }
  addEventListener(_type: string, callback: (event: MessageEvent) => void) { this.listeners.add(callback); }
  removeEventListener(_type: string, callback: (event: MessageEvent) => void) { this.listeners.delete(callback); }
  postMessage(data: unknown) { for (const peer of Channel.peers) if (peer !== this && peer.name === this.name) peer.deliver(data); }
  deliver(data: unknown) { this.listeners.forEach(listener => listener({ data } as MessageEvent)); }
}

function token(sessionId: string, sub = 'actor-a', iat = Math.floor(Date.now() / 1000) - 60) {
  return `header.${btoa(JSON.stringify({ type: 'access', sessionId, sub, iat, exp: iat + 900 }))}.signature`;
}

async function tab(initial: string | null) {
  vi.resetModules();
  const client = await import('./client');
  const store = await import('./access-token-store');
  store.setAccessToken(initial);
  client.scheduleProactiveRefresh(initial);
  const channel = Channel.peers.at(-1)!;
  return { client, store, channel };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T15:00:00Z'));
  post.mockReset(); reconnect.mockClear(); Channel.peers = [];
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal('BroadcastChannel', Channel);
  let lock = Promise.resolve();
  vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: unknown, fn: () => Promise<unknown>) => {
    const result = lock.then(fn); lock = result.then(() => undefined, () => undefined); return result;
  } } });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('adopts the winner in a second tab before reconnect and avoids a second cookie rotation', async () => {
  const old = token('old');
  const a = await tab(old); const b = await tab(old);
  vi.advanceTimersByTime(5);
  const next = token('successor');
  post.mockResolvedValue({ data: { data: { accessToken: next } } });
  reconnect.mockImplementation(() => { expect([a.store.getAccessToken(), b.store.getAccessToken()]).toEqual([next, next]); });
  await a.client.refreshAccessToken(old);
  expect(b.store.getAccessToken()).toBe(next);
  await b.client.refreshAccessToken(old);
  expect(post).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('yellostorm_access_token')).toBeNull();
  expect([...Object.values(sessionStorage)]).not.toContain(next);
});

it('uses a peer token received while an empty-memory bootstrap waits for the refresh lock', async () => {
  const a = await tab(token('old')); const b = await tab(null);
  const { AUTH_STORAGE_KEYS } = await import('./config');
  localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify({ id: 'actor-a' }));
  vi.advanceTimersByTime(5);
  const next = token('successor');
  post.mockResolvedValue({ data: { data: { accessToken: next } } });
  const refresh = a.client.refreshAccessToken();
  const boot = b.client.restoreSessionFromCookie();
  await expect(refresh).resolves.toBe(next);
  await expect(boot).resolves.toBe(next);
  expect(post).toHaveBeenCalledTimes(1);
});

it('ignores legacy, malformed, expired, foreign and out-of-order messages without reconnecting', async () => {
  const current = token('current'); const a = await tab(current);
  const emit = (accessToken: string, completedAt = Date.now() + 5) => a.channel.deliver({ type: 'refreshed', accessToken, completedAt });
  a.channel.deliver({ type: 'refreshed' });
  emit('malformed'); emit(token('foreign', 'actor-b')); emit(token('expired', 'actor-a', Math.floor(Date.now() / 1000) - 1000));
  expect(a.store.getAccessToken()).toBe(current);
  expect(reconnect).not.toHaveBeenCalled();
  const next = token('next'); emit(next);
  expect(a.store.getAccessToken()).toBe(next);
  reconnect.mockClear(); emit(token('older'), Date.now() + 4);
  expect(a.store.getAccessToken()).toBe(next);
  expect(reconnect).not.toHaveBeenCalled();
});

it('cannot restore a logged-out tab from a delayed peer rotation', async () => {
  const a = await tab(token('old'));
  a.channel.deliver({ type: 'logout' });
  a.channel.deliver({ type: 'refreshed', accessToken: token('next'), completedAt: Date.now() + 5 });
  expect(a.store.getAccessToken()).toBeNull();
});

it('does not adopt a foreign principal during cookie restore or resurrect a logout while waiting for the lock', async () => {
  const a = await tab(null);
  const { AUTH_STORAGE_KEYS } = await import('./config');
  localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify({ id: 'actor-a' }));
  post.mockResolvedValue({ data: { data: { accessToken: token('mine') } } });
  const boot = a.client.restoreSessionFromCookie();
  a.channel.deliver({ type: 'refreshed', accessToken: token('foreign', 'actor-b'), completedAt: Date.now() + 5 });
  expect(a.store.getAccessToken()).toBeNull();
  a.channel.deliver({ type: 'logout' });
  a.channel.deliver({ type: 'refreshed', accessToken: token('mine'), completedAt: Date.now() + 6 });
  await expect(boot).rejects.toMatchObject({ code: 'AUTH_TRANSIENT' });
  expect(a.store.getAccessToken()).toBeNull();
  expect(post).not.toHaveBeenCalled();
});
