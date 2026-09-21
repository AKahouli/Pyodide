import { Test, TestingModule } from '@nestjs/testing';
import { ConnectedAppDefinitionService } from './connected-app-definition.service';
import {
  CONNECTED_APP_DEFINITION_STORE,
  USER_APP_CONNECTION_STORE,
} from '../persistence/connected-app.store';
import { InMemoryConnectionStore, InMemoryDefinitionStore } from '../persistence/connected-app.store.fake';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

const definitionId = '507f1f77bcf86cd799439011';

describe('ConnectedAppDefinitionService', () => {
  let service: ConnectedAppDefinitionService;
  let definitionStore: InMemoryDefinitionStore;
  let connectionStore: InMemoryConnectionStore;
  let cryptoService: Record<string, jest.Mock>;

  beforeEach(async () => {
    definitionStore = new InMemoryDefinitionStore();
    connectionStore = new InMemoryConnectionStore();

    cryptoService = {
      encrypt: jest.fn((val: string) => `encrypted_${val}`),
      decrypt: jest.fn((val: string) => `decrypted_${val}`),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectedAppDefinitionService,
        { provide: CONNECTED_APP_DEFINITION_STORE, useValue: definitionStore },
        { provide: USER_APP_CONNECTION_STORE, useValue: connectionStore },
        { provide: CryptoService, useValue: cryptoService },
        {
          provide: LoggerService,
          useValue: { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ConnectedAppDefinitionService>(ConnectedAppDefinitionService);
    jest.clearAllMocks();
  });

  describe('findAllEnabled', () => {
    it('should return public responses for enabled definitions', async () => {
      definitionStore.seed({
        id: definitionId,
        appKey: 'google-drive',
        displayName: 'Google Drive',
        description: 'Connect to Google Drive',
        iconKey: 'google-drive',
        scopes: ['drive.readonly'],
        sortOrder: 0,
      });

      const result = await service.findAllEnabled();

      expect(result).toEqual([
        {
          appKey: 'google-drive',
          displayName: 'Google Drive',
          description: 'Connect to Google Drive',
          iconKey: 'google-drive',
          scopes: ['drive.readonly'],
          sortOrder: 0,
        },
      ]);
    });

    it('should return empty array when no enabled definitions', async () => {
      const result = await service.findAllEnabled();
      expect(result).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('should return admin responses with masked secrets and connected user counts', async () => {
      definitionStore.seed({ id: definitionId, appKey: 'google-drive', displayName: 'Google Drive' });
      for (let i = 0; i < 5; i++) connectionStore.seed({ appKey: 'google-drive' });

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].clientId).toBe('****');
      expect(result[0].clientSecret).toBe('****');
      expect(result[0].connectedUserCount).toBe(5);
    });
  });

  describe('findByKey', () => {
    it('should return decrypted app config', async () => {
      definitionStore.seed({
        appKey: 'google-drive',
        displayName: 'Google Drive',
        clientId: 'encrypted_client_id',
        clientSecret: 'encrypted_client_secret',
      });

      const result = await service.findByKey('google-drive');

      expect(cryptoService.decrypt).toHaveBeenCalledWith('encrypted_client_id');
      expect(cryptoService.decrypt).toHaveBeenCalledWith('encrypted_client_secret');
      expect(result.clientId).toBe('decrypted_encrypted_client_id');
      expect(result.clientSecret).toBe('decrypted_encrypted_client_secret');
      expect(result.appKey).toBe('google-drive');
    });

    it('should decrypt tenantId when present', async () => {
      definitionStore.seed({ appKey: 'google-drive', tenantId: 'encrypted_tenant' });

      const result = await service.findByKey('google-drive');
      expect(result.tenantId).toBe('decrypted_encrypted_tenant');
    });

    it('should throw NotFoundException when not found', async () => {
      await expect(service.findByKey('nonexistent')).rejects.toThrow();
      try {
        await service.findByKey('nonexistent');
      } catch (error) {
        expect((error as any).code).toBe(ErrorCode.CONNECTED_APP_NOT_FOUND);
      }
    });

    it('should throw NotFoundException when app is disabled', async () => {
      definitionStore.seed({ appKey: 'google-drive', enabled: false });

      await expect(service.findByKey('google-drive')).rejects.toThrow();
      try {
        await service.findByKey('google-drive');
      } catch (error) {
        expect((error as any).code).toBe(ErrorCode.CONNECTED_APP_DISABLED);
      }
    });
  });

  describe('findById', () => {
    it('should return admin response', async () => {
      definitionStore.seed({ id: definitionId, appKey: 'google-drive', displayName: 'Google Drive' });
      for (let i = 0; i < 3; i++) connectionStore.seed({ appKey: 'google-drive' });

      const result = await service.findById(definitionId);

      expect(result.id).toBe(definitionId);
      expect(result.clientId).toBe('****');
      expect(result.connectedUserCount).toBe(3);
    });

    it('should throw NotFoundException when not found', async () => {
      await expect(service.findById('nonexistent')).rejects.toThrow();
    });
  });

  describe('create', () => {
    const createDto = {
      appKey: 'Slack',
      displayName: 'Slack',
      description: 'Connect to Slack',
      iconKey: 'slack',
      authorizationUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      clientId: 'my_client_id',
      clientSecret: 'my_client_secret',
      scopes: ['channels:read'],
      pkceEnabled: true,
      enabled: true,
      sortOrder: 1,
    };

    it('should encrypt secrets and save', async () => {
      const result = await service.create(createDto as any);

      expect(cryptoService.encrypt).toHaveBeenCalledWith('my_client_id');
      expect(cryptoService.encrypt).toHaveBeenCalledWith('my_client_secret');
      expect(result.clientId).toBe('****');
      // The service lowercases the app key before persisting.
      expect(definitionStore.rows[0].appKey).toBe('slack');
      expect(definitionStore.rows[0].clientId).toBe('encrypted_my_client_id');
    });

    it('should throw ConflictException when appKey already exists', async () => {
      // The duplicate probe uses the raw dto value (lowercasing happens on insert).
      definitionStore.seed({ appKey: 'Slack' });

      await expect(service.create(createDto as any)).rejects.toThrow();
      try {
        await service.create(createDto as any);
      } catch (error) {
        expect((error as any).code).toBe(ErrorCode.CONNECTED_APP_ALREADY_EXISTS);
      }
    });
  });

  describe('update', () => {
    it('should preserve masked secrets (****) and not re-encrypt', async () => {
      definitionStore.seed({ id: definitionId, appKey: 'google-drive', displayName: 'Google Drive' });

      await service.update(definitionId, {
        displayName: 'Updated Name',
        clientId: '****',
        clientSecret: '****',
      } as any);

      expect(cryptoService.encrypt).not.toHaveBeenCalled();
      expect(definitionStore.rows[0].displayName).toBe('Updated Name');
    });

    it('should re-encrypt changed secrets', async () => {
      definitionStore.seed({ id: definitionId, appKey: 'google-drive' });

      await service.update(definitionId, {
        clientId: 'new_client_id',
        clientSecret: 'new_secret',
      } as any);

      expect(cryptoService.encrypt).toHaveBeenCalledWith('new_client_id');
      expect(cryptoService.encrypt).toHaveBeenCalledWith('new_secret');
      expect(definitionStore.rows[0].clientId).toBe('encrypted_new_client_id');
      expect(definitionStore.rows[0].clientSecret).toBe('encrypted_new_secret');
    });

    it('should throw NotFoundException when not found', async () => {
      await expect(
        service.update('nonexistent', { displayName: 'test' } as any),
      ).rejects.toThrow();
    });

    it('should check for duplicate appKey on rename', async () => {
      definitionStore.seed({ id: definitionId, appKey: 'google-drive' });
      definitionStore.seed({ appKey: 'existing-key' });

      await expect(
        service.update(definitionId, { appKey: 'existing-key' } as any),
      ).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete definition and all related connections', async () => {
      definitionStore.seed({ id: definitionId, appKey: 'google-drive' });
      jest
        .spyOn(definitionStore, 'deleteWithConnections')
        .mockResolvedValue({ appKey: 'google-drive', deletedConnections: 3 });

      const result = await service.delete(definitionId);

      expect(definitionStore.deleteWithConnections).toHaveBeenCalledWith(definitionId);
      expect(result.deletedConnections).toBe(3);
    });

    it('should throw NotFoundException when not found', async () => {
      await expect(service.delete('nonexistent')).rejects.toThrow();
    });
  });
});
