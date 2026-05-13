import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConnectedAppTokenService } from './connected-app-token.service';
import { ConnectedAppDefinitionService } from './connected-app-definition.service';
import { UserAppConnection, ConnectionStatus } from '../schemas/user-app-connection.schema';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

const userId = new Types.ObjectId().toString();
const connectionId = new Types.ObjectId();

const mockConnection = {
  _id: connectionId,
  userId: new Types.ObjectId(userId),
  appKey: 'google-drive',
  accessToken: 'encrypted_access_token',
  refreshToken: 'encrypted_refresh_token',
  tokenExpiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
  status: ConnectionStatus.ACTIVE,
  scopes: ['drive.readonly'],
};

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
  let connectionModel: Record<string, jest.Mock>;
  let definitionService: Record<string, jest.Mock>;
  let cryptoService: Record<string, jest.Mock>;

  beforeEach(async () => {
    connectionModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn(),
      countDocuments: jest.fn(),
      deleteOne: jest.fn(),
    };

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
        {
          provide: getModelToken(UserAppConnection.name),
          useValue: connectionModel,
        },
        {
          provide: ConnectedAppDefinitionService,
          useValue: definitionService,
        },
        {
          provide: CryptoService,
          useValue: cryptoService,
        },
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
      connectionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockConnection),
      });
      connectionModel.updateOne.mockResolvedValue({});

      const result = await service.getValidToken(userId, 'google-drive');

      expect(result).toBe('decrypted_encrypted_access_token');
      expect(cryptoService.decrypt).toHaveBeenCalledWith('encrypted_access_token');
      expect(connectionModel.updateOne).toHaveBeenCalled();
    });

    it('should refresh token when expired (within 5-min buffer)', async () => {
      const expiredConnection = {
        ...mockConnection,
        tokenExpiresAt: new Date(Date.now() - 1000), // expired
        refreshToken: 'encrypted_refresh_token',
      };
      connectionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(expiredConnection),
      });
      definitionService.findByKey.mockResolvedValue(mockAppConfig);
      connectionModel.findOneAndUpdate.mockResolvedValue({});

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
    });

    it('should throw CONNECTED_APP_NOT_CONNECTED when no connection', async () => {
      connectionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getValidToken(userId, 'google-drive')).rejects.toThrow();
      try {
        await service.getValidToken(userId, 'google-drive');
      } catch (error) {
        expect((error as any).code).toBe(ErrorCode.CONNECTED_APP_NOT_CONNECTED);
      }
    });

    it('should set status to ERROR on refresh failure (HTTP error)', async () => {
      const expiredConnection = {
        ...mockConnection,
        tokenExpiresAt: new Date(Date.now() - 1000),
        refreshToken: 'encrypted_refresh_token',
      };
      connectionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(expiredConnection),
      });
      definitionService.findByKey.mockResolvedValue(mockAppConfig);
      connectionModel.findOneAndUpdate.mockResolvedValue({});

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('Unauthorized'),
      });

      await expect(service.getValidToken(userId, 'google-drive')).rejects.toThrow();
      expect(connectionModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: connectionId, status: ConnectionStatus.ACTIVE },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: ConnectionStatus.ERROR,
          }),
        }),
      );
    });

    it('should mark as EXPIRED when no refresh token available', async () => {
      const noRefreshConnection = {
        ...mockConnection,
        tokenExpiresAt: new Date(Date.now() - 1000),
        refreshToken: undefined,
      };
      connectionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(noRefreshConnection),
      });
      connectionModel.updateOne.mockResolvedValue({});

      await expect(service.getValidToken(userId, 'google-drive')).rejects.toThrow();
    });
  });

  describe('isConnected', () => {
    it('should return true when connection exists', async () => {
      connectionModel.countDocuments.mockResolvedValue(1);

      const result = await service.isConnected(userId, 'google-drive');
      expect(result).toBe(true);
    });

    it('should return false when no connection', async () => {
      connectionModel.countDocuments.mockResolvedValue(0);

      const result = await service.isConnected(userId, 'google-drive');
      expect(result).toBe(false);
    });
  });

  describe('requireConnection', () => {
    it('should delegate to getValidToken', async () => {
      connectionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockConnection),
      });
      connectionModel.updateOne.mockResolvedValue({});

      const result = await service.requireConnection(userId, 'google-drive');
      expect(result).toBe('decrypted_encrypted_access_token');
    });
  });

  describe('getMailboxCapability', () => {
    it('returns mailboxReady true when an active Microsoft connection includes mail.read', async () => {
      connectionModel.findOne
        .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) })
        .mockReturnValueOnce({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              ...mockConnection,
              appKey: 'microsoft',
              scopes: ['Mail.Read', 'offline_access'],
              providerEmail: 'user@example.com',
            }),
          }),
        });

      const result = await service.getMailboxCapability(userId);

      expect(result.connected).toBe(true);
      expect(result.mailboxReady).toBe(true);
      expect(result.providerEmail).toBe('user@example.com');
      expect(result.missingScopes).toEqual([]);
    });

    it('returns missing scopes when connected Microsoft account lacks mail.read', async () => {
      connectionModel.findOne
        .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) })
        .mockReturnValueOnce({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              ...mockConnection,
              appKey: 'microsoft',
              scopes: ['Files.Read'],
            }),
          }),
        });

      const result = await service.getMailboxCapability(userId);

      expect(result.connected).toBe(true);
      expect(result.mailboxReady).toBe(false);
      expect(result.missingScopes).toEqual(['mail.read']);
    });

    it('returns disconnected status when no Microsoft 365 connection exists', async () => {
      connectionModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      });

      const result = await service.getMailboxCapability(userId);

      expect(result.connected).toBe(false);
      expect(result.mailboxReady).toBe(false);
      expect(result.grantedScopes).toEqual([]);
      expect(result.missingScopes).toEqual(['mail.read']);
    });
  });

  describe('disconnect', () => {
    it('should delete connection and attempt provider revocation', async () => {
      connectionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockConnection),
      });
      definitionService.findByKey.mockResolvedValue(mockAppConfig);
      connectionModel.deleteOne.mockResolvedValue({});

      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      await service.disconnect(userId, 'google-drive');

      expect(connectionModel.deleteOne).toHaveBeenCalledWith({ _id: connectionId });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/revoke',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should still delete connection if revocation fails (best-effort)', async () => {
      connectionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockConnection),
      });
      definitionService.findByKey.mockResolvedValue(mockAppConfig);
      connectionModel.deleteOne.mockResolvedValue({});

      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      await service.disconnect(userId, 'google-drive');

      expect(connectionModel.deleteOne).toHaveBeenCalledWith({ _id: connectionId });
    });

    it('should throw when no connection found', async () => {
      connectionModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.disconnect(userId, 'google-drive')).rejects.toThrow();
    });
  });
});
