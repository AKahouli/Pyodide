import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeployedApp } from './types';

const listDeployedAppsMock = vi.hoisted(() => vi.fn());
const removeAppMock = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  appBuilderApi: {
    listDeployedApps: listDeployedAppsMock,
    removeApp: removeAppMock,
  },
}));

import { useAppBuilderStore, initialState } from './store';

const mockApps: DeployedApp[] = [
  {
    sessionId: 'session-1',
    title: 'Generated app',
    deployedUrl: 'https://apps.example/app-1',
    lastDeployedAt: '2026-07-17T10:00:00.000Z',
    source: 'owned',
    shareId: null,
  },
];

describe('useAppBuilderStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppBuilderStore.setState(initialState);
  });

  it('fetchApps stores the deployed apps', async () => {
    listDeployedAppsMock.mockResolvedValueOnce(mockApps);

    await useAppBuilderStore.getState().fetchApps();

    const state = useAppBuilderStore.getState();
    expect(state.apps).toEqual(mockApps);
    expect(state.loading).toBe(false);
    expect(state.error).toBe(false);
  });

  it('fetchApps flags the error state on failure', async () => {
    listDeployedAppsMock.mockRejectedValueOnce(new Error('network'));

    await useAppBuilderStore.getState().fetchApps();

    const state = useAppBuilderStore.getState();
    expect(state.apps).toEqual([]);
    expect(state.error).toBe(true);
    expect(state.loading).toBe(false);
  });

  it('removeApp deletes the card from local state after the API succeeds', async () => {
    useAppBuilderStore.setState({ apps: mockApps });
    removeAppMock.mockResolvedValueOnce(undefined);

    await useAppBuilderStore.getState().removeApp('session-1');

    expect(removeAppMock).toHaveBeenCalledWith('session-1');
    expect(useAppBuilderStore.getState().apps).toEqual([]);
    expect(useAppBuilderStore.getState().deletingSessionId).toBeNull();
  });
});
