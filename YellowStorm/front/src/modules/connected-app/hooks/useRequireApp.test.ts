import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockConnectApp = vi.hoisted(() => vi.fn());
const mockIsConnectedValue = vi.hoisted(() => ({ current: false }));

const mockStoreState = vi.hoisted(() => ({
  isConnected: (appKey: string) => mockIsConnectedValue.current,
  isLoading: false,
  connectingAppKey: null as string | null,
  connectApp: mockConnectApp,
}));

vi.mock('../store', () => ({
  useConnectedAppStore: (selector: (state: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
}));

import { useRequireApp } from './useRequireApp';

describe('useRequireApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnectedValue.current = false;
    mockStoreState.isLoading = false;
    mockStoreState.connectingAppKey = null;
    mockConnectApp.mockReset();
  });

  it('should return isConnected true when app is connected', () => {
    mockIsConnectedValue.current = true;

    const { result } = renderHook(() => useRequireApp('google-drive'));

    expect(result.current.isConnected).toBe(true);
  });

  it('should return isConnected false when app is not connected', () => {
    mockIsConnectedValue.current = false;

    const { result } = renderHook(() => useRequireApp('google-drive'));

    expect(result.current.isConnected).toBe(false);
  });

  it('should return isConnecting true when connectingAppKey matches', () => {
    mockStoreState.connectingAppKey = 'google-drive';

    const { result } = renderHook(() => useRequireApp('google-drive'));

    expect(result.current.isConnecting).toBe(true);
  });

  it('should return isConnecting false when connectingAppKey does not match', () => {
    mockStoreState.connectingAppKey = 'github';

    const { result } = renderHook(() => useRequireApp('google-drive'));

    expect(result.current.isConnecting).toBe(false);
  });

  it('ensureConnected should return true immediately when already connected', async () => {
    mockIsConnectedValue.current = true;

    const { result } = renderHook(() => useRequireApp('google-drive'));

    let connected: boolean | undefined;
    await act(async () => {
      connected = await result.current.ensureConnected();
    });

    expect(connected).toBe(true);
    expect(mockConnectApp).not.toHaveBeenCalled();
  });

  it('ensureConnected should call connectApp when not connected', async () => {
    mockIsConnectedValue.current = false;
    mockConnectApp.mockResolvedValue(true);

    const { result } = renderHook(() => useRequireApp('google-drive'));

    let connected: boolean | undefined;
    await act(async () => {
      connected = await result.current.ensureConnected();
    });

    expect(mockConnectApp).toHaveBeenCalledWith('google-drive');
    expect(connected).toBe(true);
  });
});
