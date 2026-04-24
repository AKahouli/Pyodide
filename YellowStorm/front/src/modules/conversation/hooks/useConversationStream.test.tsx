import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamSSEEvent } from '../types';
import { useConversationStream } from './useConversationStream';

const connectMock = vi.hoisted(() => vi.fn());
const disconnectMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());

const fetchUsageStatusMock = vi.hoisted(() => vi.fn());

const storeHandlers = vi.hoisted(() => ({
  onSSEConnected: vi.fn(),
  onConnectionFailed: vi.fn(),
  onStreamStart: vi.fn(),
  onStreamChunk: vi.fn(),
  onStreamComplete: vi.fn(),
  onStreamError: vi.fn(),
  onConversationNameGenerated: vi.fn(),
}));

vi.mock('../stream', () => ({
  conversationStreamService: {
    connect: connectMock,
    disconnect: disconnectMock,
    subscribe: subscribeMock,
  },
}));

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock('@/modules/usage', () => ({
  useUsage: () => ({ fetchUsageStatus: fetchUsageStatusMock }),
}));

vi.mock('../store', () => ({
  useConversationStore: {
    getState: () => storeHandlers,
  },
}));

describe('useConversationStream', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('connects, subscribes, and dispatches stream events', () => {
    let listener: ((event: StreamSSEEvent) => void) | null = null;
    subscribeMock.mockImplementation((cb: (event: StreamSSEEvent) => void) => {
      listener = cb;
      return vi.fn();
    });

    renderHook(() => useConversationStream());

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledTimes(1);

    listener!({ type: 'connected', data: { connectionId: 'cid' } });
    expect(storeHandlers.onSSEConnected).toHaveBeenCalledTimes(1);

    listener!({ type: 'stream_complete', data: { conversationId: 'c1', messageId: 'm1' } });
    expect(storeHandlers.onStreamComplete).toHaveBeenCalled();
    expect(fetchUsageStatusMock).toHaveBeenCalled();
  });

  it('preserves chart arrays from the mock stream path', () => {
    let listener: ((event: StreamSSEEvent) => void) | null = null;
    subscribeMock.mockImplementation((cb: (event: StreamSSEEvent) => void) => {
      listener = cb;
      return vi.fn();
    });

    renderHook(() => useConversationStream());

    listener!({
      type: 'stream_chunk',
      data: {
        conversationId: 'c1',
        action: 'add',
        component: {
          id: 'chart-1',
          type: 'chart',
          data: {
            title: 'Revenue trend',
            data: [{ month: 'Jan', revenue: 42 }],
            chartData: [{ month: 'Jan', revenue: 42 }],
            config: { revenue: { label: 'Revenue' } },
            xAxisKey: 'month',
            series: [{ dataKey: 'revenue', label: 'Revenue' }],
            kind: 'CHART_KIND_LINE',
          },
        },
      },
    });

    expect(storeHandlers.onStreamChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        component: expect.objectContaining({
          type: 'chart',
          data: expect.objectContaining({
            data: [{ month: 'Jan', revenue: 42 }],
            chartData: [{ month: 'Jan', revenue: 42 }],
          }),
        }),
      }),
    );
  });
});
