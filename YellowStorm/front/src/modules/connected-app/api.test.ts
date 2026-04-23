import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockApiClient } from '@/test/setup';

vi.mock('@/lib/api/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/config')>();
  return {
    ...actual,
    API_ENDPOINTS: {
      ...actual.API_ENDPOINTS,
      connectedApps: {
        list: '/connected-apps',
        connections: '/connected-apps/connections',
        mailboxCapability: '/connected-apps/mailbox-capability',
        authorize: (appKey: string) => `/connected-apps/${appKey}/authorize`,
        disconnect: (appKey: string) => `/connected-apps/${appKey}`,
      },
      adminConnectedApps: {
        list: '/admin/connected-apps',
        byId: (id: string) => `/admin/connected-apps/${id}`,
      },
    },
  };
});

import {
  getAvailableApps,
  getUserConnections,
  getMailboxCapability,
  getAuthorizationUrl,
  disconnectApp,
  getAdminConnectedApps,
  getAdminConnectedApp,
  createConnectedAppDefinition,
  updateConnectedAppDefinition,
  deleteConnectedAppDefinition,
} from './api';

describe('connected-app api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAvailableApps', () => {
    it('should GET /connected-apps and return data', async () => {
      const apps = [{ appKey: 'google-drive', displayName: 'Google Drive', connected: false }];
      mockApiClient.get.mockResolvedValue({ data: { data: apps } });

      const result = await getAvailableApps();

      expect(mockApiClient.get).toHaveBeenCalledWith('/connected-apps');
      expect(result).toEqual(apps);
    });
  });

  describe('getUserConnections', () => {
    it('should GET /connected-apps/connections and return data', async () => {
      const connections = [{ appKey: 'google-drive', status: 'active' }];
      mockApiClient.get.mockResolvedValue({ data: { data: connections } });

      const result = await getUserConnections();

      expect(mockApiClient.get).toHaveBeenCalledWith('/connected-apps/connections');
      expect(result).toEqual(connections);
    });
  });

  describe('getAuthorizationUrl', () => {
    it('should GET authorize endpoint and return the authorizationUrl', async () => {
      const authUrl = 'https://accounts.google.com/o/oauth2/auth?client_id=xxx';
      mockApiClient.get.mockResolvedValue({
        data: { data: { authorizationUrl: authUrl } },
      });

      const result = await getAuthorizationUrl('google-drive');

      expect(mockApiClient.get).toHaveBeenCalledWith('/connected-apps/google-drive/authorize');
      expect(result).toBe(authUrl);
    });
  });

  describe('getMailboxCapability', () => {
    it('should GET /connected-apps/mailbox-capability and return data', async () => {
      const capability = {
        appKey: 'microsoft',
        connected: true,
        mailboxReady: false,
        providerEmail: 'user@example.com',
        missingScopes: ['mail.read'],
        grantedScopes: ['files.read'],
      };
      mockApiClient.get.mockResolvedValue({ data: { data: capability } });

      const result = await getMailboxCapability();

      expect(mockApiClient.get).toHaveBeenCalledWith('/connected-apps/mailbox-capability');
      expect(result).toEqual(capability);
    });
  });

  describe('disconnectApp', () => {
    it('should DELETE the app connection', async () => {
      mockApiClient.delete.mockResolvedValue({ data: { data: null } });

      await disconnectApp('google-drive');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/connected-apps/google-drive');
    });
  });

  describe('getAdminConnectedApps', () => {
    it('should GET /admin/connected-apps and return data', async () => {
      const apps = [{ id: '1', appKey: 'google-drive', displayName: 'Google Drive' }];
      mockApiClient.get.mockResolvedValue({ data: { data: apps } });

      const result = await getAdminConnectedApps();

      expect(mockApiClient.get).toHaveBeenCalledWith('/admin/connected-apps');
      expect(result).toEqual(apps);
    });
  });

  describe('getAdminConnectedApp', () => {
    it('should GET /admin/connected-apps/:id and return data', async () => {
      const app = { id: 'abc123', appKey: 'google-drive', displayName: 'Google Drive' };
      mockApiClient.get.mockResolvedValue({ data: { data: app } });

      const result = await getAdminConnectedApp('abc123');

      expect(mockApiClient.get).toHaveBeenCalledWith('/admin/connected-apps/abc123');
      expect(result).toEqual(app);
    });
  });

  describe('createConnectedAppDefinition', () => {
    it('should POST to /admin/connected-apps with data', async () => {
      const input = {
        appKey: 'google-drive',
        displayName: 'Google Drive',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      };
      const created = { id: 'new-id', ...input };
      mockApiClient.post.mockResolvedValue({ data: { data: created } });

      const result = await createConnectedAppDefinition(input);

      expect(mockApiClient.post).toHaveBeenCalledWith('/admin/connected-apps', input);
      expect(result).toEqual(created);
    });
  });

  describe('updateConnectedAppDefinition', () => {
    it('should PATCH /admin/connected-apps/:id with partial data', async () => {
      const updates = { displayName: 'Google Drive (Updated)' };
      const updated = { id: 'abc123', appKey: 'google-drive', ...updates };
      mockApiClient.patch.mockResolvedValue({ data: { data: updated } });

      const result = await updateConnectedAppDefinition('abc123', updates);

      expect(mockApiClient.patch).toHaveBeenCalledWith('/admin/connected-apps/abc123', updates);
      expect(result).toEqual(updated);
    });
  });

  describe('deleteConnectedAppDefinition', () => {
    it('should DELETE /admin/connected-apps/:id and return result', async () => {
      const deleteResult = { message: 'Deleted', deletedConnections: 5 };
      mockApiClient.delete.mockResolvedValue({ data: { data: deleteResult } });

      const result = await deleteConnectedAppDefinition('abc123');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/admin/connected-apps/abc123');
      expect(result).toEqual(deleteResult);
    });
  });
});
