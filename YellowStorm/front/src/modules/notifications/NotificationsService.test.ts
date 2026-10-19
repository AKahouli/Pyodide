import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationsService } from './NotificationsService';

const toastMock = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
}));

const eventSourceCtor = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('@/modules/localization/i18nInstance', () => ({
  i18nInstance: { isInitialized: false },
}));

// The service reads the access token from the in-memory store via the
// barrel; this holder doubles as the test seed.
let seededToken: string | null = null;
vi.mock('@/lib/api', () => ({
  API_CONFIG: { baseURL: 'https://api.test' },
  API_ENDPOINTS: { auth: { refresh: '/auth/refresh' } },
  getAccessToken: () => seededToken,
}));

// Minimal EventSource mock
class EventSourceMock {
  static CONNECTING = 0;
  static CLOSED = 2;
  onopen: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readyState = 1;
  url: string;

  constructor(url: string) {
    this.url = url;
    eventSourceCtor(url);
  }

  close() {
    this.readyState = 2;
  }
}

describe('NotificationsService', () => {
  it('does not dial or show connection errors when hidden, including token reconnect', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    notificationsService.connect();
    notificationsService.reconnectWithNewToken();
    expect(eventSourceCtor).not.toHaveBeenCalled();
    expect(toastMock.loading).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });
  it('pauses the passive pipe and timers without stale callbacks or delayed toasts', () => {
    vi.useFakeTimers();
    notificationsService.connect();
    const es = (notificationsService as unknown as { eventSource: EventSourceMock }).eventSource!;
    es.onopen?.();
    es.onmessage?.({ data: JSON.stringify({ type: 'connected', data: { connectionId: 'old' } }) } as MessageEvent);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    notificationsService.pause();
    es.onerror?.(new Error('intentional close'));
    vi.advanceTimersByTime(120_000);
    expect(es.readyState).toBe(2);
    expect(eventSourceCtor).toHaveBeenCalledTimes(1);
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    notificationsService.connect();
    expect(eventSourceCtor).toHaveBeenCalledTimes(2);
  });

  afterEach(() => { notificationsService.disconnect(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    vi.stubGlobal('EventSource', EventSourceMock);
    seededToken = 'abc123';
    toastMock.loading.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    toastMock.warning.mockReset();
    toastMock.dismiss.mockReset();
    eventSourceCtor.mockClear();
    notificationsService.disconnect();
  });

  it('cancels a queued notification retry when intentionally paused', () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    notificationsService.connect();
    const es = (notificationsService as unknown as { eventSource: EventSourceMock }).eventSource!;
    es.readyState = EventSourceMock.CONNECTING;
    es.onerror?.(new Error('temporary network failure'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    notificationsService.pause();
    vi.advanceTimersByTime(120_000);
    expect(eventSourceCtor).toHaveBeenCalledTimes(1);
    expect(toastMock.error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('constructs EventSource with token and sets connection on connected event', () => {
    notificationsService.connect();

    expect(eventSourceCtor).toHaveBeenCalledWith('https://api.test/notifications/stream?token=abc123');

    const es = (notificationsService as unknown as { eventSource: EventSourceMock }).eventSource!;

    // simulate connected payload
    es.onmessage?.({ data: JSON.stringify({ type: 'connected', data: { connectionId: 'cid-1' } }) } as MessageEvent);

    expect(notificationsService.getIsConnected()).toBe(true);
    expect(notificationsService.getConnectionId()).toBe('cid-1');
  });

  it('invokes listeners on notification events', () => {
    const listener = vi.fn();
    const unsubscribe = notificationsService.subscribe(listener);

    notificationsService.connect();
    const es = (notificationsService as unknown as { eventSource: EventSourceMock }).eventSource!;

    es.onmessage?.({ data: JSON.stringify({ type: 'notification', data: { id: 'n1' } }) } as MessageEvent);

    expect(listener).toHaveBeenCalledWith({ type: 'notification', data: { id: 'n1' } });

    unsubscribe();
    es.onmessage?.({ data: JSON.stringify({ type: 'notification', data: { id: 'n2' } }) } as MessageEvent);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('closes event source on disconnect', () => {
    notificationsService.connect();
    const es = (notificationsService as unknown as { eventSource: EventSourceMock }).eventSource!;

    notificationsService.disconnect();

    expect(es.readyState).toBe(2); // CLOSED
    expect(notificationsService.getIsConnected()).toBe(false);
    expect(notificationsService.getConnectionId()).toBeNull();
  });
});
