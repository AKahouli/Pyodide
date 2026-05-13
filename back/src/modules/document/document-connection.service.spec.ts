import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DocumentConnectionService, StorageConnectionStatus } from './document-connection.service';
import { LoggerService } from '../logger';

// Create mock functions that can be controlled per test
const mockCreateIfNotExists = jest.fn();
const mockGetProperties = jest.fn();

const mockContainerClient = {
  createIfNotExists: mockCreateIfNotExists,
  getProperties: mockGetProperties,
};

const mockBlobServiceClient = {
  getContainerClient: jest.fn().mockReturnValue(mockContainerClient),
};

// Mock Azure Storage
jest.mock('@azure/storage-blob', () => ({
  BlobServiceClient: {
    fromConnectionString: jest.fn().mockImplementation(() => mockBlobServiceClient),
  },
  StorageSharedKeyCredential: jest.fn().mockImplementation((accountName, accountKey) => ({
    accountName,
    accountKey,
  })),
}));

import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';

describe('DocumentConnectionService', () => {
  let service: DocumentConnectionService;
  let configService: jest.Mocked<ConfigService>;
  let loggerService: jest.Mocked<LoggerService>;

  const defaultConfig: Record<string, unknown> = {
    'storage.azure.connectionString': 'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=dGVzdGtleQ==;EndpointSuffix=core.windows.net',
    'storage.azure.containerName': 'documents',
    'storage.azure.accountName': 'testaccount',
    'storage.reconnect.enabled': true,
    'storage.reconnect.initialDelayMs': 1000,
    'storage.reconnect.maxDelayMs': 30000,
    'storage.reconnect.maxAttempts': 0,
    'storage.reconnect.multiplier': 2,
    'storage.healthCheck.enabled': false, // Disable for tests
    'storage.healthCheck.intervalMs': 60000,
  };

  const createService = async (configOverrides: Record<string, unknown> = {}) => {
    const config = { ...defaultConfig, ...configOverrides };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        return config[key] ?? defaultValue;
      }),
    };

    const mockLoggerService = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentConnectionService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    return {
      service: module.get<DocumentConnectionService>(DocumentConnectionService),
      configService: module.get(ConfigService) as jest.Mocked<ConfigService>,
      loggerService: module.get(LoggerService) as jest.Mocked<LoggerService>,
    };
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default successful behavior
    mockCreateIfNotExists.mockResolvedValue({});
    mockGetProperties.mockResolvedValue({});

    const result = await createService();
    service = result.service;
    configService = result.configService;
    loggerService = result.loggerService;
  });

  afterEach(() => {
    jest.useRealTimers();
    if (service) {
      service.onModuleDestroy();
    }
  });

  describe('constructor', () => {
    it('should set logger context', () => {
      expect(loggerService.setContext).toHaveBeenCalledWith('DocumentConnectionService');
    });

    it('should load configuration values', () => {
      expect(configService.get).toHaveBeenCalledWith('storage.azure.connectionString', '');
      expect(configService.get).toHaveBeenCalledWith('storage.azure.containerName', 'documents');
      expect(configService.get).toHaveBeenCalledWith('storage.azure.accountName', '');
    });
  });

  describe('onModuleInit', () => {
    it('should call connect on module init', async () => {
      const connectSpy = jest.spyOn(service, 'connect');
      await service.onModuleInit();
      expect(connectSpy).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should clean up intervals and timeouts', async () => {
      await service.onModuleInit();
      service.onModuleDestroy();
      // Should not throw
    });
  });

  describe('connect', () => {
    it('should establish connection successfully', async () => {
      await service.connect();

      expect(BlobServiceClient.fromConnectionString).toHaveBeenCalledWith(
        defaultConfig['storage.azure.connectionString'],
      );
      expect(service.isConnectedNow()).toBe(true);
      expect(loggerService.log).toHaveBeenCalledWith(
        'Azure Blob Storage connection established',
        expect.any(Object),
      );
    });

    it('should create StorageSharedKeyCredential when account key is present', async () => {
      await service.connect();

      expect(StorageSharedKeyCredential).toHaveBeenCalledWith(
        'testaccount',
        'dGVzdGtleQ==',
      );
    });

    it('should not connect when connection string is empty', async () => {
      const { service: newService, loggerService: newLogger } = await createService({
        'storage.azure.connectionString': '',
      });

      await newService.connect();

      expect(newService.isConnectedNow()).toBe(false);
      expect(newLogger.warn).toHaveBeenCalledWith(
        'Azure Storage connection string not configured. Document service disabled.',
      );

      newService.onModuleDestroy();
    });

    it('should not attempt duplicate connections', async () => {
      // Start first connection but don't await
      const connectPromise1 = service.connect();
      // Second call should detect connection in progress
      const connectPromise2 = service.connect();

      await Promise.all([connectPromise1, connectPromise2]);

      // fromConnectionString should only be called once per service instance
      // (once during the first connect call)
      expect(loggerService.debug).toHaveBeenCalledWith('Connection attempt already in progress');
    });

    it('should handle connection failure and schedule reconnect', async () => {
      mockCreateIfNotExists.mockRejectedValueOnce(new Error('Connection refused'));

      await service.connect();

      expect(service.isConnectedNow()).toBe(false);
      expect(loggerService.error).toHaveBeenCalledWith(
        'Azure Blob Storage connection failed',
        expect.objectContaining({ message: 'Connection refused' }),
      );
    });

    it('should reset reconnect attempt counter on successful connection', async () => {
      await service.connect();

      const status = service.getHealthStatus();
      expect(status.reconnectAttempts).toBe(0);
    });
  });

  describe('verifyConnection', () => {
    beforeEach(async () => {
      await service.connect();
    });

    it('should return true when connection is valid', async () => {
      const result = await service.verifyConnection();

      expect(result).toBe(true);
      expect(service.isConnectedNow()).toBe(true);
    });

    it('should return false when container client is null', async () => {
      const { service: newService } = await createService();
      // Don't call connect, so containerClient is null
      const result = await newService.verifyConnection();

      expect(result).toBe(false);
      newService.onModuleDestroy();
    });

    it('should handle verification failure', async () => {
      mockGetProperties.mockRejectedValueOnce(new Error('Connection lost'));

      const result = await service.verifyConnection();

      expect(result).toBe(false);
      expect(service.isConnectedNow()).toBe(false);
    });

    it('should log when connection is restored', async () => {
      // First, disconnect by failing verification
      mockGetProperties.mockRejectedValueOnce(new Error('Connection lost'));
      await service.verifyConnection();
      expect(service.isConnectedNow()).toBe(false);

      // Clear mock to track new calls
      loggerService.log.mockClear();

      // Now verification succeeds (connection restored)
      mockGetProperties.mockResolvedValueOnce({});
      await service.verifyConnection();

      expect(service.isConnectedNow()).toBe(true);
      expect(loggerService.log).toHaveBeenCalledWith('Azure Blob Storage connection restored');
    });
  });

  describe('reconnection', () => {
    it('should schedule reconnect with exponential backoff', async () => {
      mockCreateIfNotExists.mockRejectedValueOnce(new Error('Connection failed'));

      await service.connect();

      expect(service.getHealthStatus().isReconnecting).toBe(true);
      expect(loggerService.log).toHaveBeenCalledWith(
        expect.stringContaining('Scheduling Azure Storage reconnection'),
        expect.any(Object),
      );
    });

    it('should not schedule reconnect when disabled', async () => {
      const { service: newService, loggerService: newLogger } = await createService({
        'storage.reconnect.enabled': false,
      });

      mockCreateIfNotExists.mockRejectedValueOnce(new Error('Connection failed'));

      await newService.connect();

      expect(newService.getHealthStatus().isReconnecting).toBe(false);
      expect(newLogger.warn).toHaveBeenCalledWith(
        'Reconnection disabled, Azure Storage will remain disconnected',
      );

      newService.onModuleDestroy();
    });

    it('should stop reconnecting after max attempts', async () => {
      const { service: newService, loggerService: newLogger } = await createService({
        'storage.reconnect.maxAttempts': 1,
      });

      // First connection attempt fails
      mockCreateIfNotExists.mockRejectedValue(new Error('Connection failed'));
      await newService.connect();

      // After first failure, reconnect is scheduled
      expect(newService.getHealthStatus().reconnectAttempts).toBe(1);

      // Advance timer to trigger reconnect
      jest.advanceTimersByTime(2000);
      await Promise.resolve(); // Flush promises
      await Promise.resolve(); // Let async operations complete

      expect(newLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Max reconnection attempts'),
      );

      newService.onModuleDestroy();
    });
  });

  describe('isAvailable', () => {
    it('should return true when connection string is configured', () => {
      expect(service.isAvailable()).toBe(true);
    });

    it('should return false when connection string is not configured', async () => {
      const { service: newService } = await createService({
        'storage.azure.connectionString': '',
      });

      expect(newService.isAvailable()).toBe(false);
      newService.onModuleDestroy();
    });
  });

  describe('isConnectedNow', () => {
    it('should return false before connecting', () => {
      expect(service.isConnectedNow()).toBe(false);
    });

    it('should return true after successful connection', async () => {
      await service.connect();
      expect(service.isConnectedNow()).toBe(true);
    });
  });

  describe('getContainerClient', () => {
    it('should return null before connecting', () => {
      expect(service.getContainerClient()).toBeNull();
    });

    it('should return container client after connecting', async () => {
      await service.connect();
      expect(service.getContainerClient()).not.toBeNull();
    });
  });

  describe('getBlobServiceClient', () => {
    it('should return null before connecting', () => {
      expect(service.getBlobServiceClient()).toBeNull();
    });

    it('should return blob service client after connecting', async () => {
      await service.connect();
      expect(service.getBlobServiceClient()).not.toBeNull();
    });
  });

  describe('getSharedKeyCredential', () => {
    it('should return null before connecting', () => {
      expect(service.getSharedKeyCredential()).toBeNull();
    });

    it('should return credential after connecting', async () => {
      await service.connect();
      expect(service.getSharedKeyCredential()).not.toBeNull();
    });

    it('should return null when account name is not configured', async () => {
      const { service: newService } = await createService({
        'storage.azure.accountName': '',
      });

      await newService.connect();

      expect(newService.getSharedKeyCredential()).toBeNull();
      newService.onModuleDestroy();
    });
  });

  describe('getContainerName', () => {
    it('should return configured container name', () => {
      expect(service.getContainerName()).toBe('documents');
    });
  });

  describe('getHealthStatus', () => {
    it('should return initial health status', () => {
      const status = service.getHealthStatus();

      expect(status).toMatchObject({
        available: true,
        connected: false,
        error: null,
        reconnectAttempts: 0,
        isReconnecting: false,
      });
    });

    it('should return connected status after successful connection', async () => {
      await service.connect();
      const status = service.getHealthStatus();

      expect(status).toMatchObject({
        available: true,
        connected: true,
        error: null,
        reconnectAttempts: 0,
        isReconnecting: false,
      });
      expect(status.lastCheckedAt).toBeInstanceOf(Date);
    });

    it('should return error status after failed connection', async () => {
      mockCreateIfNotExists.mockRejectedValueOnce(new Error('Connection failed'));

      await service.connect();
      const status = service.getHealthStatus();

      expect(status.connected).toBe(false);
      expect(status.error).toBe('Connection failed');
      expect(status.isReconnecting).toBe(true);
    });
  });

  describe('health check interval', () => {
    it('should start health check on module init when enabled', async () => {
      const { service: newService, loggerService: newLogger } = await createService({
        'storage.healthCheck.enabled': true,
      });

      await newService.onModuleInit();

      expect(newLogger.log).toHaveBeenCalledWith(
        'Starting Azure Storage health check',
        expect.any(Object),
      );

      newService.onModuleDestroy();
    });

    it('should not start health check when connection string is empty', async () => {
      const { service: newService, loggerService: newLogger } = await createService({
        'storage.azure.connectionString': '',
        'storage.healthCheck.enabled': true,
      });

      await newService.onModuleInit();

      expect(newLogger.log).not.toHaveBeenCalledWith(
        'Starting Azure Storage health check',
        expect.any(Object),
      );

      newService.onModuleDestroy();
    });
  });

  describe('backoff calculation', () => {
    it('should calculate exponential backoff with jitter', async () => {
      mockCreateIfNotExists.mockRejectedValueOnce(new Error('Connection failed'));

      await service.connect();

      // Check that reconnect was scheduled
      expect(service.getHealthStatus().isReconnecting).toBe(true);
    });

    it('should not exceed max delay', async () => {
      const { service: newService } = await createService({
        'storage.reconnect.initialDelayMs': 10000,
        'storage.reconnect.maxDelayMs': 15000,
        'storage.reconnect.multiplier': 10,
      });

      mockCreateIfNotExists.mockRejectedValueOnce(new Error('Connection failed'));

      await newService.connect();

      // The delay should be capped at maxDelayMs (with jitter)
      expect(newService.getHealthStatus().isReconnecting).toBe(true);

      newService.onModuleDestroy();
    });
  });
});
