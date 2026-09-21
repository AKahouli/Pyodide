import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./data-access-token', () => ({
  getDataGrant: vi.fn(),
  clearDataGrants: vi.fn(),
}));
vi.mock('./semantic-realtime-client', () => ({ subscribeModelTopic: vi.fn() }));

import { getDataGrant } from './data-access-token';
import { subscribeModelTopic } from './semantic-realtime-client';
import { useSemanticModelChannel } from './use-semantic-model-channel';

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

describe('use-semantic-model-channel (P2.SB20/SB24)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('subscribes once per model and invalidates on signal, then cleans up', async () => {
    vi.mocked(getDataGrant).mockResolvedValue({
      capabilities: { dataApi: true, realtime: true },
      token: 't',
      realtimeToken: 'rt',
      topic: 'semantic-model:m1',
      restUrl: 'http://127.0.0.1:3000',
      realtimeUrl: 'ws://127.0.0.1:4000',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    let signal: ((event: string, payload: { modelId: string; dataRevision: number }) => void) | null = null;
    const close = vi.fn();
    vi.mocked(subscribeModelTopic).mockImplementation((options) => {
      signal = (event, payload) =>
        options.onSignal(event as 'data-revision-changed', payload);
      options.onStatus(true);
      return { close, isConnected: () => true };
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result, unmount } = renderHook(() => useSemanticModelChannel('m1'), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(subscribeModelTopic).toHaveBeenCalledTimes(1));
    expect(subscribeModelTopic).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'semantic-model:m1' }),
    );

    await act(async () => {
      signal?.('data-revision-changed', { modelId: 'm1', dataRevision: 42 });
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(invalidate).toHaveBeenCalled();
    expect(result.current).toMatchObject({ live: true, polling: false });

    unmount();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe when realtime is disabled', async () => {
    vi.mocked(getDataGrant).mockResolvedValue({
      capabilities: { dataApi: true, realtime: false },
      token: 't',
      realtimeToken: null,
      topic: null,
      restUrl: 'http://127.0.0.1:3000',
      realtimeUrl: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useSemanticModelChannel('m1'), { wrapper: wrapper(client) });

    await waitFor(() => expect(getDataGrant).toHaveBeenCalledWith('m1'));
    expect(subscribeModelTopic).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ live: false, polling: true });
  });
});
