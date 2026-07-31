import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestUseMock = vi.hoisted(() => vi.fn());
const responseUseMock = vi.hoisted(() => vi.fn());
const apiClientPostMock = vi.hoisted(() => vi.fn());
const apiClientMock = vi.hoisted(() => {
  const client = vi.fn();
  Object.assign(client, {
    post: apiClientPostMock,
    interceptors: {
      request: { use: requestUseMock },
      response: { use: responseUseMock },
    },
  });
  return client;
});
const reconnectConversationMock = vi.hoisted(() => vi.fn());
const waitForConversationMock = vi.hoisted(() => vi.fn());
const reconnectNotificationsMock = vi.hoisted(() => vi.fn());
const reconnectConversationV2Mock = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: { create: vi.fn(() => apiClientMock) },
  create: vi.fn(() => apiClientMock),
}));

vi.mock('./config', () => ({
  API_CONFIG: { baseURL: 'https://api.example.test', timeout: 1000, withCredentials: true },
  AUTH_STORAGE_KEYS: { accessToken: 'accessToken', user: 'user' },
  API_ENDPOINTS: {
    auth: {
      login: '/auth/login',
      refresh: '/auth/refresh',
      verifyEmail: '/auth/verify-email',
      resendVerificationPublic: '/auth/resend-verification',
    },
  },
}));

vi.mock('@/modules/notifications', () => ({
  notificationsService: { reconnectWithNewToken: reconnectNotificationsMock },
}));

vi.mock('@/modules/conversation/stream', () => ({
  conversationStreamService: {
    reconnectWithNewToken: reconnectConversationMock,
    waitForConnection: waitForConversationMock,
  },
}));

vi.mock('@/modules/conversation/translation', () => ({
  translateConversation: (key: string) => key,
}));

vi.mock('@/modules/conversation-v2/conversationV2Stream', () => ({
  conversationV2StreamService: { reconnectWithNewToken: reconnectConversationV2Mock },
}));

import './client';

const responseErrorHandler = responseUseMock.mock.calls[0]?.[1] as (error: unknown) => Promise<unknown>;

describe('apiClient token refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    waitForConversationMock.mockResolvedValue(true);
    apiClientPostMock.mockResolvedValue({ data: { data: { accessToken: 'fresh-token' } } });
    apiClientMock.mockResolvedValue({ data: { success: true } });
  });

  it('waits for the replacement conversation pipe before retrying a message POST', async () => {
    let resolvePipe: (connected: boolean) => void = () => undefined;
    waitForConversationMock.mockImplementation(() => new Promise((resolve) => { resolvePipe = resolve; }));
    const originalRequest = { method: 'post', url: '/conversations/conversation-1/messages', headers: {} };

    const retry = responseErrorHandler({
      config: originalRequest,
      response: { status: 401, data: { error: { code: 'ERR_1003' } } },
    });

    await vi.waitFor(() => expect(reconnectConversationMock).toHaveBeenCalledTimes(1));
    expect(apiClientMock).not.toHaveBeenCalledWith(originalRequest);

    resolvePipe(true);
    await retry;

    expect(waitForConversationMock).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledWith(expect.objectContaining({
      ...originalRequest,
      headers: { Authorization: 'Bearer fresh-token' },
    }));
  });
});
