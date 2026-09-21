import { Test, TestingModule } from '@nestjs/testing';
import { ConnectedAppUserService } from './connected-app-user.service';
import { ConnectedAppDefinitionService } from './connected-app-definition.service';
import { USER_APP_CONNECTION_STORE } from '../persistence/connected-app.store';
import { InMemoryConnectionStore } from '../persistence/connected-app.store.fake';
import { ConnectionStatus } from '../schemas/user-app-connection.schema';
import { LoggerService } from '@modules/logger';

const userId = '507f1f77bcf86cd799439011';

const mockApps = [
  {
    appKey: 'google-drive',
    displayName: 'Google Drive',
    description: 'Connect to Google Drive',
    iconKey: 'google-drive',
    scopes: ['drive.readonly'],
    sortOrder: 0,
  },
  {
    appKey: 'slack',
    displayName: 'Slack',
    description: 'Connect to Slack',
    iconKey: 'slack',
    scopes: ['channels:read'],
    sortOrder: 1,
  },
];

describe('ConnectedAppUserService', () => {
  let service: ConnectedAppUserService;
  let connectionStore: InMemoryConnectionStore;
  let definitionService: Record<string, jest.Mock>;

  beforeEach(async () => {
    connectionStore = new InMemoryConnectionStore();
    definitionService = {
      findAllEnabled: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectedAppUserService,
        { provide: USER_APP_CONNECTION_STORE, useValue: connectionStore },
        { provide: ConnectedAppDefinitionService, useValue: definitionService },
        {
          provide: LoggerService,
          useValue: { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ConnectedAppUserService>(ConnectedAppUserService);
    jest.clearAllMocks();
  });

  describe('getAvailableApps', () => {
    it('should return apps with connected=true/false based on user connections', async () => {
      definitionService.findAllEnabled.mockResolvedValue(mockApps);
      connectionStore.seed({
        userId,
        appKey: 'google-drive',
        status: ConnectionStatus.ACTIVE,
        scopes: ['drive.readonly'],
        providerEmail: 'user@gmail.com',
        createdAt: new Date('2026-01-01'),
      });

      const result = await service.getAvailableApps(userId);

      expect(result).toHaveLength(2);

      const googleDrive = result.find((a) => a.appKey === 'google-drive');
      expect(googleDrive!.connected).toBe(true);
      expect(googleDrive!.connection).toBeDefined();
      expect(googleDrive!.connection!.providerEmail).toBe('user@gmail.com');

      const slack = result.find((a) => a.appKey === 'slack');
      expect(slack!.connected).toBe(false);
      expect(slack!.connection).toBeUndefined();
    });

    it('should return all apps with connected=false when no connections', async () => {
      definitionService.findAllEnabled.mockResolvedValue(mockApps);

      const result = await service.getAvailableApps(userId);

      expect(result).toHaveLength(2);
      expect(result.every((a) => a.connected === false)).toBe(true);
      expect(result.every((a) => a.connection === undefined)).toBe(true);
    });
  });

  describe('getUserConnections', () => {
    it('should return connection metadata without tokens', async () => {
      connectionStore.seed({
        userId,
        appKey: 'google-drive',
        status: ConnectionStatus.ACTIVE,
        scopes: ['drive.readonly'],
        providerEmail: 'user@gmail.com',
        createdAt: new Date('2026-01-01'),
      });
      definitionService.findAllEnabled.mockResolvedValue(mockApps);

      const result = await service.getUserConnections(userId);

      expect(result).toHaveLength(1);
      expect(result[0].appKey).toBe('google-drive');
      expect(result[0].displayName).toBe('Google Drive');
      expect(result[0].iconKey).toBe('google-drive');
      expect(result[0].status).toBe(ConnectionStatus.ACTIVE);
      expect(result[0].providerEmail).toBe('user@gmail.com');
      // Ensure no token fields
      expect((result[0] as any).accessToken).toBeUndefined();
      expect((result[0] as any).refreshToken).toBeUndefined();
    });

    it('should return empty array when no connections', async () => {
      const result = await service.getUserConnections(userId);

      expect(result).toEqual([]);
      // Should not call findAllEnabled when no connections
      expect(definitionService.findAllEnabled).not.toHaveBeenCalled();
    });

    it('should skip connections for apps that no longer exist', async () => {
      connectionStore.seed({
        userId,
        appKey: 'google-drive',
        status: ConnectionStatus.ACTIVE,
        scopes: ['drive.readonly'],
        providerEmail: 'user@gmail.com',
        createdAt: new Date('2026-01-01'),
      });
      connectionStore.seed({
        userId,
        appKey: 'deleted-app',
        status: ConnectionStatus.ACTIVE,
        scopes: [],
        createdAt: new Date(),
      });
      definitionService.findAllEnabled.mockResolvedValue(mockApps);

      const result = await service.getUserConnections(userId);

      expect(result).toHaveLength(1);
      expect(result[0].appKey).toBe('google-drive');
    });
  });
});
