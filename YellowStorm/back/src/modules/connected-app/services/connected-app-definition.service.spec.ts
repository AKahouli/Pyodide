import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConnectedAppDefinitionService } from './connected-app-definition.service';
import { ConnectedAppDefinition } from '../schemas/connected-app-definition.schema';
import { UserAppConnection } from '../schemas/user-app-connection.schema';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

const mockDefinition = {
  _id: '507f1f77bcf86cd799439011',
  appKey: 'google-drive',
  displayName: 'Google Drive',
  description: 'Connect to Google Drive',
  iconKey: 'google-drive',
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  clientId: 'encrypted_client_id',
  clientSecret: 'encrypted_client_secret',
  tenantId: undefined,
  scopes: ['drive.readonly'],
  pkceEnabled: true,
  enabled: true,
  sortOrder: 0,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('ConnectedAppDefinitionService', () => {
  let service: ConnectedAppDefinitionService;
  let definitionModel: Record<string, jest.Mock>;
  let connectionModel: Record<string, jest.Mock>;
  let cryptoService: Record<string, jest.Mock>;

  beforeEach(async () => {
    definitionModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      deleteOne: jest.fn(),
    };

    connectionModel = {
      countDocuments: jest.fn(),
      deleteMany: jest.fn(),
    };

    cryptoService = {
      encrypt: jest.fn((val: string) => `encrypted_${val}`),
      decrypt: jest.fn((val: string) => `decrypted_${val}`),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectedAppDefinitionService,
        {
          provide: getModelToken(ConnectedAppDefinition.name),
          useValue: definitionModel,
        },
        {
          provide: getModelToken(UserAppConnection.name),
          useValue: connectionModel,
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

    service = module.get<ConnectedAppDefinitionService>(ConnectedAppDefinitionService);
    jest.clearAllMocks();
  });

  describe('findAllEnabled', () => {
    it('should return public responses for enabled definitions', async () => {
      definitionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([mockDefinition]),
          }),
        }),
      });

      const result = await service.findAllEnabled();

      expect(definitionModel.find).toHaveBeenCalledWith({ enabled: true });
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
      definitionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await service.findAllEnabled();
      expect(result).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('should return admin responses with masked secrets and connected user counts', async () => {
      definitionModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([mockDefinition]),
          }),
        }),
      });
      connectionModel.countDocuments.mockResolvedValue(5);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].clientId).toBe('****');
      expect(result[0].clientSecret).toBe('****');
      expect(result[0].connectedUserCount).toBe(5);
      expect(connectionModel.countDocuments).toHaveBeenCalledWith({ appKey: 'google-drive' });
    });
  });

  describe('findByKey', () => {
    it('should return decrypted app config', async () => {
      definitionModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockDefinition),
        }),
      });

      const result = await service.findByKey('Google-Drive');

      expect(definitionModel.findOne).toHaveBeenCalledWith({ appKey: 'google-drive' });
      expect(cryptoService.decrypt).toHaveBeenCalledWith('encrypted_client_id');
      expect(cryptoService.decrypt).toHaveBeenCalledWith('encrypted_client_secret');
      expect(result.clientId).toBe('decrypted_encrypted_client_id');
      expect(result.clientSecret).toBe('decrypted_encrypted_client_secret');
      expect(result.appKey).toBe('google-drive');
    });

    it('should decrypt tenantId when present', async () => {
      const defWithTenant = { ...mockDefinition, tenantId: 'encrypted_tenant' };
      definitionModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(defWithTenant),
        }),
      });

      const result = await service.findByKey('google-drive');
      expect(result.tenantId).toBe('decrypted_encrypted_tenant');
    });

    it('should throw NotFoundException when not found', async () => {
      definitionModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(service.findByKey('nonexistent')).rejects.toThrow();
      try {
        await service.findByKey('nonexistent');
      } catch (error) {
        expect((error as any).code).toBe(ErrorCode.CONNECTED_APP_NOT_FOUND);
      }
    });

    it('should throw NotFoundException when app is disabled', async () => {
      const disabledDef = { ...mockDefinition, enabled: false };
      definitionModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(disabledDef),
        }),
      });

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
      definitionModel.findById.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockDefinition),
        }),
      });
      connectionModel.countDocuments.mockResolvedValue(3);

      const result = await service.findById('507f1f77bcf86cd799439011');

      expect(result.id).toBe('507f1f77bcf86cd799439011');
      expect(result.clientId).toBe('****');
      expect(result.connectedUserCount).toBe(3);
    });

    it('should throw NotFoundException when not found', async () => {
      definitionModel.findById.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

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
      definitionModel.findOne.mockResolvedValue(null);

      const savedDoc = {
        ...mockDefinition,
        appKey: 'slack',
        displayName: 'Slack',
        save: jest.fn().mockResolvedValue(undefined),
        toObject: jest.fn().mockReturnValue({
          _id: '507f1f77bcf86cd799439012',
          appKey: 'slack',
          displayName: 'Slack',
          description: 'Connect to Slack',
          iconKey: 'slack',
          authorizationUrl: 'https://slack.com/oauth/v2/authorize',
          tokenUrl: 'https://slack.com/api/oauth.v2.access',
          clientId: 'encrypted_my_client_id',
          clientSecret: 'encrypted_my_client_secret',
          scopes: ['channels:read'],
          pkceEnabled: true,
          enabled: true,
          sortOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      };

      // Mock the constructor (new this.definitionModel(...))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalService = service as any;
      const originalModel = originalService.definitionModel;
      const constructorMock: any = jest.fn().mockReturnValue(savedDoc);
      constructorMock.findOne = originalModel.findOne;
      originalService.definitionModel = constructorMock;

      const result = await service.create(createDto as any);

      expect(cryptoService.encrypt).toHaveBeenCalledWith('my_client_id');
      expect(cryptoService.encrypt).toHaveBeenCalledWith('my_client_secret');
      expect(savedDoc.save).toHaveBeenCalled();
      expect(result.clientId).toBe('****');
    });

    it('should throw ConflictException when appKey already exists', async () => {
      definitionModel.findOne.mockResolvedValue({ appKey: 'slack' });

      await expect(service.create(createDto as any)).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('should preserve masked secrets (****) and not re-encrypt', async () => {
      const existingDoc = {
        ...mockDefinition,
        save: jest.fn().mockResolvedValue(undefined),
        toObject: jest.fn().mockReturnValue(mockDefinition),
      };
      definitionModel.findById.mockResolvedValue(existingDoc);

      await service.update('507f1f77bcf86cd799439011', {
        displayName: 'Updated Name',
        clientId: '****',
        clientSecret: '****',
      } as any);

      expect(cryptoService.encrypt).not.toHaveBeenCalled();
      expect(existingDoc.displayName).toBe('Updated Name');
    });

    it('should re-encrypt changed secrets', async () => {
      const existingDoc = {
        ...mockDefinition,
        save: jest.fn().mockResolvedValue(undefined),
        toObject: jest.fn().mockReturnValue(mockDefinition),
      };
      definitionModel.findById.mockResolvedValue(existingDoc);

      await service.update('507f1f77bcf86cd799439011', {
        clientId: 'new_client_id',
        clientSecret: 'new_secret',
      } as any);

      expect(cryptoService.encrypt).toHaveBeenCalledWith('new_client_id');
      expect(cryptoService.encrypt).toHaveBeenCalledWith('new_secret');
    });

    it('should throw NotFoundException when not found', async () => {
      definitionModel.findById.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { displayName: 'test' } as any),
      ).rejects.toThrow();
    });

    it('should check for duplicate appKey on rename', async () => {
      const existingDoc = {
        ...mockDefinition,
        save: jest.fn().mockResolvedValue(undefined),
        toObject: jest.fn().mockReturnValue(mockDefinition),
      };
      definitionModel.findById.mockResolvedValue(existingDoc);
      definitionModel.findOne.mockResolvedValue({ appKey: 'existing-key' });

      await expect(
        service.update('507f1f77bcf86cd799439011', { appKey: 'existing-key' } as any),
      ).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete definition and all related connections', async () => {
      definitionModel.findById.mockResolvedValue({ ...mockDefinition });
      connectionModel.deleteMany.mockResolvedValue({ deletedCount: 3 });
      definitionModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await service.delete('507f1f77bcf86cd799439011');

      expect(connectionModel.deleteMany).toHaveBeenCalledWith({ appKey: 'google-drive' });
      expect(definitionModel.deleteOne).toHaveBeenCalledWith({ _id: '507f1f77bcf86cd799439011' });
      expect(result.deletedConnections).toBe(3);
    });

    it('should throw NotFoundException when not found', async () => {
      definitionModel.findById.mockResolvedValue(null);

      await expect(service.delete('nonexistent')).rejects.toThrow();
    });
  });
});
