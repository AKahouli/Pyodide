import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectedAppWithStatus } from './types';

const getAvailableAppsMock = vi.hoisted(() => vi.fn());
const getMailboxCapabilityMock = vi.hoisted(() => vi.fn());
const getAuthorizationUrlMock = vi.hoisted(() => vi.fn());
const disconnectAppMock = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  getAvailableApps: getAvailableAppsMock,
  getMailboxCapability: getMailboxCapabilityMock,
  getAuthorizationUrl: getAuthorizationUrlMock,
  disconnectApp: disconnectAppMock,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/modules/localization/i18nInstance', () => ({
  i18nInstance: { isInitialized: false, t: (key: string) => key },
}));

import { useConnectedAppStore, ensureAppConnected } from './store';
import { toast } from 'sonner';

const mockApps: ConnectedAppWithStatus[] = [
  {
    appKey: 'google-drive',
    displayName: 'Google Drive',
    scopes: ['drive.readonly'],
    sortOrder: 1,
    connected: true,
    connection: {
      appKey: 'google-drive',
      displayName: 'Google Drive',
      status: 'active',
      scopes: ['drive.readonly'],
      providerEmail: 'user@gmail.com',
      connectedAt: '2026-01-01T00:00:00Z',
    },
  },
  {
    appKey: 'github',
    displayName: 'GitHub',
    scopes: ['repo'],
    sortOrder: 2,
    connected: false,
  },
];

describe('useConnectedAppStore', () => {
  beforeEach(() => {
    useConnectedAppStore.setState({
      apps: [],
      isLoading: false,
      isInitialized: false,
      connectingAppKey: null,
      mailboxCapability: null,
    });
    vi.clearAllMocks();
  });

  describe('fetchApps', () => {
    it('should set apps and isInitialized on success', async () => {
      getAvailableAppsMock.mockResolvedValue(mockApps);
      getMailboxCapabilityMock.mockResolvedValue({
        appKey: 'microsoft',
        connected: true,
        mailboxReady: true,
        missingScopes: [],
        grantedScopes: ['mail.read'],
      });

      await useConnectedAppStore.getState().fetchApps();

      const state = useConnectedAppStore.getState();
      expect(state.apps).toEqual(mockApps);
      expect(state.mailboxCapability?.mailboxReady).toBe(true);
      expect(state.isInitialized).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it('should show toast on error', async () => {
      getAvailableAppsMock.mockRejectedValue(new Error('Network error'));

      await useConnectedAppStore.getState().fetchApps();

      expect(toast.error).toHaveBeenCalled();
      expect(useConnectedAppStore.getState().isLoading).toBe(false);
    });

    it('should tolerate mailbox capability fetch failure', async () => {
      getAvailableAppsMock.mockResolvedValue(mockApps);
      getMailboxCapabilityMock.mockRejectedValue(new Error('mailbox failed'));

      await useConnectedAppStore.getState().fetchApps();

      expect(useConnectedAppStore.getState().apps).toEqual(mockApps);
      expect(useConnectedAppStore.getState().mailboxCapability).toBeNull();
    });
  });

  describe('disconnectApp', () => {
    it('should call api and update local state to connected=false', async () => {
      useConnectedAppStore.setState({
        apps: mockApps,
        isInitialized: true,
        mailboxCapability: {
          appKey: 'google-drive',
          connected: true,
          mailboxReady: true,
          missingScopes: [],
          grantedScopes: ['mail.read'],
        },
      });
      disconnectAppMock.mockResolvedValue(undefined);

      await useConnectedAppStore.getState().disconnectApp('google-drive');

      expect(disconnectAppMock).toHaveBeenCalledWith('google-drive');
      const app = useConnectedAppStore
        .getState()
        .apps.find((a) => a.appKey === 'google-drive');
      expect(app?.connected).toBe(false);
      expect(app?.connection).toBeUndefined();
      expect(useConnectedAppStore.getState().mailboxCapability?.connected).toBe(false);
      expect(toast.success).toHaveBeenCalled();
    });

    it('should show toast on error', async () => {
      disconnectAppMock.mockRejectedValue(new Error('Failed'));

      await useConnectedAppStore.getState().disconnectApp('google-drive');

      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('should return true when app is connected', () => {
      useConnectedAppStore.setState({ apps: mockApps });

      expect(useConnectedAppStore.getState().isConnected('google-drive')).toBe(true);
    });

    it('should return false when app is not connected', () => {
      useConnectedAppStore.setState({ apps: mockApps });

      expect(useConnectedAppStore.getState().isConnected('github')).toBe(false);
    });

    it('should return false for unknown app key', () => {
      useConnectedAppStore.setState({ apps: mockApps });

      expect(useConnectedAppStore.getState().isConnected('unknown')).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      useConnectedAppStore.setState({
        apps: mockApps,
        isLoading: true,
        isInitialized: true,
        connectingAppKey: 'google-drive',
        mailboxCapability: {
          appKey: 'microsoft',
          connected: true,
          mailboxReady: false,
          missingScopes: ['mail.read'],
          grantedScopes: [],
        },
      });

      useConnectedAppStore.getState().reset();

      const state = useConnectedAppStore.getState();
      expect(state.apps).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.isInitialized).toBe(false);
      expect(state.connectingAppKey).toBeNull();
      expect(state.mailboxCapability).toBeNull();
    });
  });
});

describe('ensureAppConnected', () => {
  beforeEach(() => {
    useConnectedAppStore.setState({
      apps: [],
      isLoading: false,
      isInitialized: false,
      connectingAppKey: null,
      mailboxCapability: null,
    });
    vi.clearAllMocks();
  });

  it('should return true immediately if already connected', async () => {
    useConnectedAppStore.setState({ apps: mockApps, isInitialized: true });

    const result = await ensureAppConnected('google-drive');

    expect(result).toBe(true);
    expect(getAvailableAppsMock).not.toHaveBeenCalled();
  });

  it('should fetch apps first if not initialized', async () => {
    // After fetchApps, the store will have apps with google-drive connected
    getAvailableAppsMock.mockResolvedValue(mockApps);

    const result = await ensureAppConnected('google-drive');

    expect(getAvailableAppsMock).toHaveBeenCalled();
    expect(result).toBe(true);
  });
});
