import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeployedApp, DraftApp } from './types';

const listAppsMock = vi.hoisted(() => vi.fn());
const removeAppMock = vi.hoisted(() => vi.fn());
const pointersRemoveMock = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  appBuilderApi: {
    listApps: listAppsMock,
    removeApp: removeAppMock,
  },
}));

vi.mock('@/modules/conversation-v2/store', () => ({
  useConversationV2PointersStore: {
    getState: () => ({
      remove: pointersRemoveMock,
    }),
  },
}));

import { useAppBuilderStore, initialState } from './store';

const mockDeployed: DeployedApp[] = [
  {
    sessionId: 'session-1',
    title: 'Generated app',
    deployedUrl: 'https://apps.example/app-1',
    lastDeployedAt: '2026-07-17T10:00:00.000Z',
    source: 'owned',
    shareId: null,
  },
];

const mockDraft: DraftApp = {
  sessionId: 'session-draft',
  title: 'Draft app',
  lastUpdatedAt: '2026-07-15T10:00:00.000Z',
  deployStatus: 'idle',
};

describe('useAppBuilderStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppBuilderStore.setState(initialState);
  });

  it('fetchApps stores the catalog', async () => {
    listAppsMock.mockResolvedValueOnce({
      deployed: mockDeployed,
      shared: [],
      drafts: [],
    });

    await useAppBuilderStore.getState().fetchApps();

    const state = useAppBuilderStore.getState();
    expect(state.deployed).toEqual(mockDeployed);
    expect(state.shared).toEqual([]);
    expect(state.drafts).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBe(false);
  });

  it('fetchApps flags the error state on failure', async () => {
    listAppsMock.mockRejectedValueOnce(new Error('network'));

    await useAppBuilderStore.getState().fetchApps();

    const state = useAppBuilderStore.getState();
    expect(state.deployed).toEqual([]);
    expect(state.error).toBe(true);
    expect(state.loading).toBe(false);
  });

  it('removeApp deletes the card from local state after the API succeeds', async () => {
    useAppBuilderStore.setState({ deployed: mockDeployed });
    removeAppMock.mockResolvedValueOnce(undefined);

    await useAppBuilderStore.getState().removeApp('session-1');

    expect(removeAppMock).toHaveBeenCalledWith('session-1');
    expect(useAppBuilderStore.getState().deployed).toEqual([]);
    expect(useAppBuilderStore.getState().deletingSessionId).toBeNull();
  });

  it('removeDraft soft-deletes the conversation and drops the draft card', async () => {
    useAppBuilderStore.setState({ drafts: [mockDraft] });
    pointersRemoveMock.mockResolvedValueOnce(undefined);

    await useAppBuilderStore.getState().removeDraft('session-draft');

    expect(pointersRemoveMock).toHaveBeenCalledWith('session-draft');
    expect(useAppBuilderStore.getState().drafts).toEqual([]);
    expect(useAppBuilderStore.getState().deletingSessionId).toBeNull();
  });
});
