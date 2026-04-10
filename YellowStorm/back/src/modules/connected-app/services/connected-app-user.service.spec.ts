import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConnectedAppUserService } from './connected-app-user.service';
import { ConnectedAppDefinitionService } from './connected-app-definition.service';
import { UserAppConnection, ConnectionStatus } from '../schemas/user-app-connection.schema';
import { LoggerService } from '@modules/logger';

const userId = new Types.ObjectId().toString();

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

const mockConnection = {
  appKey: 'google-drive',
  status: ConnectionStatus.ACTIVE,
  scopes: ['drive.readonly'],
  providerEmail: 'user@gmail.com',
  createdAt: new Date('2026-01-01'),
};

describe('ConnectedAppUserService', () => {
  let service: ConnectedAppUserService;
  let connectionModel: Record<string, jest.Mock>;
  let definitionService: Record<string, jest.Mock>;

  beforeEach(async () => {
    connectionModel = {
      find: jest.fn(),
    };

    definitionService = {
      findAllEnabled: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectedAppUserService,
        {
          provide: getModelToken(UserAppConnection.name),
          useValue: connectionModel,
        },
        {
          provide: ConnectedAppDefinitionService,
          useValue: definitionService,
        },
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
      connectionModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([mockConnection]),
        }),
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
      connectionModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getAvailableApps(userId);

      expect(result).toHaveLength(2);
      expect(result.every((a) => a.connected === false)).toBe(true);
      expect(result.every((a) => a.connection === undefined)).toBe(true);
    });
  });

  describe('getUserConnections', () => {
    it('should return connection metadata without tokens', async () => {
      connectionModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([mockConnection]),
        }),
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
      connectionModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getUserConnections(userId);

      expect(result).toEqual([]);
      // Should not call findAllEnabled when no connections
      expect(definitionService.findAllEnabled).not.toHaveBeenCalled();
    });

    it('should skip connections for apps that no longer exist', async () => {
      const orphanConnection = {
        appKey: 'deleted-app',
        status: ConnectionStatus.ACTIVE,
        scopes: [],
        createdAt: new Date(),
      };
      connectionModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([mockConnection, orphanConnection]),
        }),
      });
      definitionService.findAllEnabled.mockResolvedValue(mockApps);

      const result = await service.getUserConnections(userId);

      expect(result).toHaveLength(1);
      expect(result[0].appKey).toBe('google-drive');
    });
  });
});
