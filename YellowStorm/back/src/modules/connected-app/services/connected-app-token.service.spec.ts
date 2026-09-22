import { Test, TestingModule } from '@nestjs/testing';
import { ConnectedAppTokenService } from './connected-app-token.service';
import { ConnectedAppDefinitionService } from './connected-app-definition.service';
import { USER_APP_CONNECTION_STORE } from '../persistence/connected-app.store';
import { InMemoryConnectionStore } from '../persistence/connected-app.store.fake';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { ConnectionStatus } from '../connected-app.types';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

const userId = '507f1f77bcf86cd799439011';

const mockAppConfig = {
  appKey: 'google-drive',
  displayName: 'Google Drive',
  clientId: 'decrypted_client_id',
  clientSecret: 'decrypted_client_secret',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  scopes: ['drive.readonly'],
  pkceEnabled: true,
  enabled: true,
};

describe('ConnectedAppTokenService', () => {
  let service: ConnectedAppTokenService;
  let connectionStore: InMemoryConnectionStore;
  let definitionService: Record<string, jest.Mock>;
  let cryptoService: Record<string, jest.Mock>;

  beforeEach(async () => {
    connectionStore = new InMemoryConnectionStore();
    definitionService = {
      findByKey: jest.fn(),
    };

    cryptoService = {
      encrypt: jest.fn((val: string) => `encrypted_${val}`),
      decrypt: jest.fn((val: string) => `decrypted_${val}`),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectedAppTokenService,
        { provide: USER_APP_CONNECTION_STORE, useValue: connectionStore },
        {
          // withTransaction() only needs db.transaction(fn) for these specs.
          provide: DRIZZLE_DB,
          useValue: {
            transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
            execute: jest.fn(),
          },
        },
        { provide: ConnectedAppDefinitionService, useValue: definitionService },
        { provide: CryptoService, useValue: cryptoService },
        {
          provide: LoggerService,
          useValue: { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ConnectedAppTokenService>(ConnectedAppTokenService);
    jest.clearAllMocks();
  });

  describe('getValidToken', () => {
    it('should return decrypted token when active and not expired', async () => {
      const row = connectionStore.seed({
        userId,
        appKey: 'google-drive',
        accessToken: 'encrypted_access_token',
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
      });
      const touchSpy = jest.spyOn(connectionStore, 'touchLastUsedThrottled');

      const result = await service.getValidToken(userId, 'google-drive');

      expect(result).toBe('decrypted_encrypted_access_token');
      expect(cryptoService.decrypt).toHaveBeenCalledWith('encrypted_access_token');
      // Throttled hot-path write still fires for a valid token.
      expect(touchSpy).toHaveBeenCalledWith(row.id);
    });

    it('should refresh token when expired (within 5-min buffer)', async () => {
      connectionStore.seed({
        userId,
        appKey: 'google-drive',
        accessToken: 'encrypted_access_token',
        refreshToken: 'encrypted_refresh_token',
        tokenExpiresAt: new Date(Date.now() - 1000), // expired
      });
      definitionService.findByKey.mockResolvedValue(mockAppConfig);
      const forUpdateSpy = jest.spyOn(connectionStore, 'findByIdForUpdate');

      // Mock global fetch
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'new_access_token',
          refresh_token: 'new_refresh_token',
          expires_in: 3600,
        }),
      });
      global.fetch = mockFetch;

      const result = await service.getValidToken(userId, 'google-drive');

      expect(result).toBe('new_access_token');
      expect(mockFetch).toHaveBeenCalled();
      expect(cryptoService.encrypt).toHaveBeenCalledWith('new_access_token');
      // Single-flight refresh: row is locked via findByIdForUpdate inside the
      // transaction, then the refreshed tokens are persisted via applyRefresh.
      expect(forUpdateSpy).toHaveBeenCalled();
      expect(connectionStore.rows[0].accessToken).toBe('encrypted_new_access_token');
    });

    it('should throw CONNECTED_APP_NOT_CONNECTED when no connection', async () => {
      await expect(service.getValidToken(userId, 'google-drive')).rejects.toThrow();
      try {
        await service.getValidToken(userId, 'google-drive');
      } catch (error) {
        expect((error as any).code).toBe(ErrorCode.CONNECTED_APP_NOT_CONNECTED);
      }
    });

    it('should set status to ERROR on refresh failure (HTTP error)', async () => {
      connectionStore.seed({
        userId,
        appKey: 'google-drive',
        accessToken: 'encrypted_access_token',
        refreshToken: 'encrypted_refresh_token',
        tokenExpiresAt: new Date(Date.now() - 1000),
      });
      definitionService.findByKey.mockResolvedValue(mockAppConfig);

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('Unauthorized'),
      });

      await expect(service.getValidToken(userId, 'google-drive')).rejects.toThrow();
      expect(connectionStore.rows[0].status).toBe(ConnectionStatus.ERROR);
      expect(connectionStore.rows[0].errorMessage).toContain('401');
    });

    it('should mark as EXPIRED when no refresh token available', async () => {
      connectionStore.seed({
        userId,
        appKey: 'google-drive',
        accessToken: 'encrypted_access_token',
        refreshToken: null,
        tokenExpiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.getValidToken(userId, 'google-drive')).rejects.toThrow();
      expect(connectionStore.rows[0].status).toBe(ConnectionStatus.EXPIRED);
    });
  });

  describe('isConnected', () => {
    it('should return true when connection exists', async () => {
      connectionStore.seed({ userId, appKey: 'google-drive' });

      const result = await service.isConnected(userId, 'google-drive');
      expect(result).toBe(true);
    });

    it('should return false when no connection', async () => {
      const result = await service.isConnected(userId, 'google-drive');
      expect(result).toBe(false);
    });
  });

  describe('requireConnection', () => {
    it('should delegate to getValidToken', async () => {
      connectionStore.seed({
        userId,
        appKey: 'google-drive',
        accessToken: 'encrypted_access_token',
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      });

      const result = await service.requireConnection(userId, 'google-drive');
      expect(result).toBe('decrypted_encrypted_access_token');
    });
  });

  describe('getMailboxCapability', () => {
    it('returns mailboxReady true when an active Microsoft connection includes mail.read', async () => {
      connectionStore.seed({
        userId,
        appKey: 'microsoft',
        scopes: ['Mail.Read', 'offline_access'],
        providerEmail: 'user@example.com',
      });

      const result = await service.getMailboxCapability(userId);

      expect(result.connected).toBe(true);
      expect(result.mailboxReady).toBe(true);
      expect(result.providerEmail).toBe('user@example.com');
      expect(result.missingScopes).toEqual([]);
    });

    it('returns missing scopes when connected Microsoft account lacks mail.read', async () => {
      connectionStore.seed({
        userId,
        appKey: 'microsoft',
        scopes: ['Files.Read'],
      });

      const result = await service.getMailboxCapability(userId);

      expect(result.connected).toBe(true);
      expect(result.mailboxReady).toBe(false);
      expect(result.missingScopes).toEqual(['mail.read']);
    });

    it('returns disconnected status when no Microsoft 365 connection exists', async () => {
      const result = await service.getMailboxCapability(userId);

      expect(result.connected).toBe(false);
      expect(result.mailboxReady).toBe(false);
      expect(result.grantedScopes).toEqual([]);
      expect(result.missingScopes).toEqual(['mail.read']);
    });
  });

  describe('disconnect', () => {
    it('should delete connection and attempt provider revocation', async () => {
      connectionStore.seed({ userId, appKey: 'google-drive', accessToken: 'encrypted_access_token' });
      definitionService.findByKey.mockResolvedValue(mockAppConfig);
      const deleteSpy = jest.spyOn(connectionStore, 'deleteById');

      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      await service.disconnect(userId, 'google-drive');

      expect(deleteSpy).toHaveBeenCalled();
      expect(connectionStore.rows).toHaveLength(0);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/revoke',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should still delete connection if revocation fails (best-effort)', async () => {
      connectionStore.seed({ userId, appKey: 'google-drive', accessToken: 'encrypted_access_token' });
      definitionService.findByKey.mockResolvedValue(mockAppConfig);
      const deleteSpy = jest.spyOn(connectionStore, 'deleteById');

      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      await service.disconnect(userId, 'google-drive');

      expect(deleteSpy).toHaveBeenCalled();
      expect(connectionStore.rows).toHaveLength(0);
    });

    it('should throw when no connection found', async () => {
      await expect(service.disconnect(userId, 'google-drive')).rejects.toThrow();
    });
  });
});
