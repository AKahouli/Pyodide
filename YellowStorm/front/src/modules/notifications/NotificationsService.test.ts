import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/lib/api', () => ({
  AUTH_STORAGE_KEYS: { accessToken: 'token-key' },
  API_CONFIG: { baseURL: 'https://api.test' },
  API_ENDPOINTS: { auth: { refresh: '/auth/refresh' } },
}));

// Minimal EventSource mock
class EventSourceMock {
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
  beforeEach(() => {
    vi.stubGlobal('EventSource', EventSourceMock);
    localStorage.setItem('token-key', 'abc123');
    toastMock.loading.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    toastMock.warning.mockReset();
    toastMock.dismiss.mockReset();
    eventSourceCtor.mockClear();
    notificationsService.disconnect();
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
