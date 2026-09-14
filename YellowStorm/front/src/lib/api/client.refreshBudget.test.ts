/**
 * Outage-then-recovery regression (reviewer major #1): after three transient
 * refresh failures, a single tab must still be able to refresh once the
 * backend answers again — the burst budget must not permanently lock the tab
 * out of recovery, and the recovery probe must never be budget-blocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosRequest = vi.fn();
const axiosPost = vi.fn();
const axiosGet = vi.fn();

vi.mock('axios', () => {
  const create = vi.fn(() => {
    const instance: unknown = (config: unknown) => axiosRequest(config as never);
    (instance as Record<string, unknown>).post = (...args: unknown[]) => axiosPost(...(args as []));
    (instance as Record<string, unknown>).get = (...args: unknown[]) => axiosGet(...(args as []));
    (instance as Record<string, unknown>).interceptors = {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    };
    return instance;
  });
  return { default: { create }, AxiosError: class extends Error {} };
});

vi.mock('@/modules/notifications', () => ({
  notificationsService: { reconnectWithNewToken: vi.fn() },
}));
vi.mock('@/modules/conversation/stream', () => ({
  conversationStreamService: { reconnectWithNewToken: vi.fn(), ensureConnected: vi.fn() },
}));
vi.mock('@/modules/conversation-v2/conversationV2Stream', () => ({
  conversationV2StreamService: { reconnectWithNewToken: vi.fn() },
}));

function makeAxiosError(status?: number, code?: string): Record<string, unknown> {
  return {
    config: { headers: {}, url: '/workspaces' },
    response:
      status === undefined
        ? undefined
        : { status, data: { error: { code, message: 'x', statusCode: status } } },
    message: 'timeout',
  };
}

describe('refresh burst budget recovery', () => {
  let errorHandler: (error: unknown) => Promise<unknown>;

  beforeEach(async () => {
    vi.resetModules();
    axiosRequest.mockReset().mockResolvedValue({ data: {} });
    axiosPost.mockReset();
    axiosGet.mockReset();
    localStorage.clear();
    sessionStorage.clear();

    await import('./client');
    const { create } = (await import('axios')).default as unknown as {
      create: ReturnType<typeof vi.fn>;
    };
    const instance = create.mock.results[
      create.mock.results.length - 1
    ].value as unknown as { interceptors: { response: { use: { mock: { calls: unknown[][] } } } } };
    const [, responseErrorHandler] = instance.interceptors.response.use.mock.calls[0];
    errorHandler = responseErrorHandler as typeof errorHandler;
  });

  it('recovers refresh capability after transient outage once the server answers', async () => {
    localStorage.setItem('yellostorm_access_token', 'expired-token');

    // Three transient refresh failures (network black hole: no response at all).
    axiosPost.mockRejectedValue(makeAxiosError(undefined));
    for (let i = 0; i < 3; i += 1) {
      await expect(errorHandler(makeAxiosError(401))).rejects.toMatchObject({
        code: 'AUTH_TRANSIENT',
      });
    }
    // Credentials survive the outage (F02).
    expect(localStorage.getItem('yellostorm_access_token')).toBe('expired-token');

    // The backend becomes reachable again: the next 401 carries a real HTTP
    // response, renewing the budget and allowing the refresh to proceed.
    axiosPost.mockResolvedValueOnce({
      data: { data: { accessToken: 'fresh-token', expiresIn: 900 } },
    });
    await errorHandler(makeAxiosError(401));

    expect(axiosPost).toHaveBeenCalledWith(
      '/auth/refresh',
      null,
      expect.objectContaining({ timeout: 10_000 }),
    );
    expect(localStorage.getItem('yellostorm_access_token')).toBe('fresh-token');
  });

  it('never blocks the recovery probe, even with an exhausted budget', async () => {
    localStorage.setItem('yellostorm_access_token', 'expired-token');
    axiosPost.mockRejectedValue(makeAxiosError(undefined));
    for (let i = 0; i < 3; i += 1) {
      await errorHandler(makeAxiosError(401)).catch(() => undefined);
    }

    // Probe still triggers a refresh attempt despite the exhausted budget,
    // reusing the persisted rotation attempt id.
    axiosPost.mockResolvedValueOnce({
      data: { data: { accessToken: 'probe-recovered', expiresIn: 900 } },
    });
    const probeError = makeAxiosError(401);
    (probeError.config as { headers: Record<string, string> }).headers['X-YellowStorm-Recovery-Probe'] = '1';
    await errorHandler(probeError);

    expect(axiosPost).toHaveBeenCalledWith(
      '/auth/refresh',
      null,
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Refresh-Attempt-Id': expect.any(String) }),
      }),
    );
    expect(localStorage.getItem('yellostorm_access_token')).toBe('probe-recovered');
  });
});
