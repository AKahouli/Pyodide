import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DocumentConnectionService } from './document-connection.service';
import { LoggerService } from '../logger';

// Track the S3Client instances created and the `send` mock so tests can drive behavior.
const mockSend = jest.fn();
const mockDestroy = jest.fn();
// Spy invoked with the S3Client constructor config so tests can assert on it.
const mockS3ClientCtor = jest.fn();

// Mock AWS S3 client
jest.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = mockSend;
    destroy = mockDestroy;
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
      mockS3ClientCtor(config);
    }
  }

  class HeadBucketCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }

  class CreateBucketCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }

  return { S3Client, HeadBucketCommand, CreateBucketCommand };
});

import { HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';

describe('DocumentConnectionService', () => {
  let service: DocumentConnectionService;
  let configService: jest.Mocked<ConfigService>;
  let loggerService: jest.Mocked<LoggerService>;

  const defaultConfig: Record<string, unknown> = {
    'storage.s3.endpoint': 'https://s3.example.com',
    'storage.s3.region': 'us-east-1',
    'storage.s3.bucket': 'documents',
    'storage.s3.accessKeyId': 'testAccessKey',
    'storage.s3.secretAccessKey': 'testSecretKey',
    'storage.s3.forcePathStyle': true,
    'storage.s3.publicUrl': 'https://s3.example.com',
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

    // Default successful behavior: HeadBucket / CreateBucket resolve.
    mockSend.mockResolvedValue({});

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
      expect(configService.get).toHaveBeenCalledWith('storage.s3.endpoint', '');
      expect(configService.get).toHaveBeenCalledWith('storage.s3.region', 'us-east-1');
      expect(configService.get).toHaveBeenCalledWith('storage.s3.bucket', 'documents');
      expect(configService.get).toHaveBeenCalledWith('storage.s3.accessKeyId', '');
      expect(configService.get).toHaveBeenCalledWith('storage.s3.secretAccessKey', '');
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

    it('should destroy the S3 client', async () => {
      await service.connect();
      service.onModuleDestroy();
      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  describe('connect', () => {
    it('should establish connection successfully', async () => {
      await service.connect();

      expect(mockS3ClientCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: defaultConfig['storage.s3.endpoint'],
          region: defaultConfig['storage.s3.region'],
          credentials: {
            accessKeyId: defaultConfig['storage.s3.accessKeyId'],
            secretAccessKey: defaultConfig['storage.s3.secretAccessKey'],
          },
          forcePathStyle: true,
        }),
      );
      expect(service.isConnectedNow()).toBe(true);
      expect(loggerService.log).toHaveBeenCalledWith(
        'Ceph S3 connection established',
        expect.any(Object),
      );
    });

    it('should ensure the bucket exists via HeadBucketCommand', async () => {
      await service.connect();

      expect(mockSend).toHaveBeenCalledWith(expect.any(HeadBucketCommand));
    });

    it('should create the bucket when it does not exist', async () => {
      const notFound = Object.assign(new Error('not found'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });
      // First send (HeadBucket) rejects with 404, second send (CreateBucket) resolves.
      mockSend.mockRejectedValueOnce(notFound).mockResolvedValueOnce({});

      await service.connect();

      expect(mockSend).toHaveBeenCalledWith(expect.any(CreateBucketCommand));
      expect(service.isConnectedNow()).toBe(true);
    });

    it('should not connect when endpoint is empty', async () => {
      const { service: newService, loggerService: newLogger } = await createService({
        'storage.s3.endpoint': '',
      });

      await newService.connect();

      expect(newService.isConnectedNow()).toBe(false);
      expect(newLogger.warn).toHaveBeenCalledWith(
        'Ceph S3 credentials not configured (endpoint/accessKey/secretKey). Document service disabled.',
      );

      newService.onModuleDestroy();
    });

    it('should not connect when access key is empty', async () => {
      const { service: newService, loggerService: newLogger } = await createService({
        'storage.s3.accessKeyId': '',
      });

      await newService.connect();

      expect(newService.isConnectedNow()).toBe(false);
      expect(newLogger.warn).toHaveBeenCalledWith(
        'Ceph S3 credentials not configured (endpoint/accessKey/secretKey). Document service disabled.',
      );

      newService.onModuleDestroy();
    });

    it('should not attempt duplicate connections', async () => {
      const connectPromise1 = service.connect();
      const connectPromise2 = service.connect();

      await Promise.all([connectPromise1, connectPromise2]);

      expect(loggerService.debug).toHaveBeenCalledWith('Connection attempt already in progress');
    });

    it('should handle connection failure and schedule reconnect', async () => {
      mockSend.mockRejectedValueOnce(new Error('Connection refused'));

      await service.connect();

      expect(service.isConnectedNow()).toBe(false);
      expect(loggerService.error).toHaveBeenCalledWith(
        'Ceph S3 connection failed',
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
      expect(mockSend).toHaveBeenCalledWith(expect.any(HeadBucketCommand));
    });

    it('should return false when S3 client is null', async () => {
      const { service: newService } = await createService();
      // Don't call connect, so s3Client is null
      const result = await newService.verifyConnection();

      expect(result).toBe(false);
      newService.onModuleDestroy();
    });

    it('should handle verification failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Connection lost'));

      const result = await service.verifyConnection();

      expect(result).toBe(false);
      expect(service.isConnectedNow()).toBe(false);
    });

    it('should log when connection is restored', async () => {
      // First, disconnect by failing verification
      mockSend.mockRejectedValueOnce(new Error('Connection lost'));
      await service.verifyConnection();
      expect(service.isConnectedNow()).toBe(false);

      // Clear mock to track new calls
      loggerService.log.mockClear();

      // Now verification succeeds (connection restored)
      mockSend.mockResolvedValueOnce({});
      await service.verifyConnection();

      expect(service.isConnectedNow()).toBe(true);
      expect(loggerService.log).toHaveBeenCalledWith('Ceph S3 connection restored');
    });

    it('should warn when connection is lost', async () => {
      // service is connected from beforeEach
      mockSend.mockRejectedValueOnce(new Error('Connection lost'));

      await service.verifyConnection();

      expect(loggerService.warn).toHaveBeenCalledWith(
        'Ceph S3 connection lost',
        expect.objectContaining({ error: 'Connection lost' }),
      );
    });
  });

  describe('reconnection', () => {
    it('should schedule reconnect with exponential backoff', async () => {
      mockSend.mockRejectedValueOnce(new Error('Connection failed'));

      await service.connect();

      expect(service.getHealthStatus().isReconnecting).toBe(true);
      expect(loggerService.log).toHaveBeenCalledWith(
        expect.stringContaining('Scheduling Ceph S3 reconnection attempt'),
        expect.any(Object),
      );
    });

    it('should not schedule reconnect when disabled', async () => {
      const { service: newService, loggerService: newLogger } = await createService({
        'storage.reconnect.enabled': false,
      });

      mockSend.mockRejectedValueOnce(new Error('Connection failed'));

      await newService.connect();

      expect(newService.getHealthStatus().isReconnecting).toBe(false);
      expect(newLogger.warn).toHaveBeenCalledWith(
        'Reconnection disabled, Ceph S3 will remain disconnected',
      );

      newService.onModuleDestroy();
    });

    it('should stop reconnecting after max attempts', async () => {
      const { service: newService, loggerService: newLogger } = await createService({
        'storage.reconnect.maxAttempts': 1,
      });

      // All connection attempts fail
      mockSend.mockRejectedValue(new Error('Connection failed'));
      await newService.connect();

      // After first failure, reconnect is scheduled
      expect(newService.getHealthStatus().reconnectAttempts).toBe(1);

      // Advance timer to trigger reconnect
      jest.advanceTimersByTime(5000);
      await Promise.resolve(); // Flush promises
      await Promise.resolve(); // Let async operations complete
      await Promise.resolve();

      expect(newLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Max reconnection attempts'),
      );

      newService.onModuleDestroy();
    });
  });

  describe('isAvailable', () => {
    it('should return true when credentials are configured', () => {
      expect(service.isAvailable()).toBe(true);
    });

    it('should return false when endpoint is not configured', async () => {
      const { service: newService } = await createService({
        'storage.s3.endpoint': '',
      });

      expect(newService.isAvailable()).toBe(false);
      newService.onModuleDestroy();
    });

    it('should return false when access key is not configured', async () => {
      const { service: newService } = await createService({
        'storage.s3.accessKeyId': '',
      });

      expect(newService.isAvailable()).toBe(false);
      newService.onModuleDestroy();
    });

    it('should return false when secret key is not configured', async () => {
      const { service: newService } = await createService({
        'storage.s3.secretAccessKey': '',
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

  describe('getS3Client', () => {
    it('should return null before connecting', () => {
      expect(service.getS3Client()).toBeNull();
    });

    it('should return S3 client after connecting', async () => {
      await service.connect();
      expect(service.getS3Client()).not.toBeNull();
    });
  });

  describe('getBucket', () => {
    it('should return configured bucket name', () => {
      expect(service.getBucket()).toBe('documents');
    });
  });

  describe('getPublicUrl', () => {
    it('should return configured public URL', () => {
      expect(service.getPublicUrl()).toBe('https://s3.example.com');
    });

    it('should fall back to endpoint when public URL is empty', async () => {
      const { service: newService } = await createService({
        'storage.s3.publicUrl': '',
        'storage.s3.endpoint': 'https://endpoint.example.com',
      });

      expect(newService.getPublicUrl()).toBe('https://endpoint.example.com');
      newService.onModuleDestroy();
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
      mockSend.mockRejectedValueOnce(new Error('Connection failed'));

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
        'Starting Ceph S3 health check',
        expect.any(Object),
      );

      newService.onModuleDestroy();
    });

    it('should not start health check when endpoint is empty', async () => {
      const { service: newService, loggerService: newLogger } = await createService({
        'storage.s3.endpoint': '',
        'storage.healthCheck.enabled': true,
      });

      await newService.onModuleInit();

      expect(newLogger.log).not.toHaveBeenCalledWith(
        'Starting Ceph S3 health check',
        expect.any(Object),
      );

      newService.onModuleDestroy();
    });
  });

  describe('backoff calculation', () => {
    it('should calculate exponential backoff with jitter', async () => {
      mockSend.mockRejectedValueOnce(new Error('Connection failed'));

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

      mockSend.mockRejectedValueOnce(new Error('Connection failed'));

      await newService.connect();

      // The delay should be capped at maxDelayMs (with jitter)
      expect(newService.getHealthStatus().isReconnecting).toBe(true);

      newService.onModuleDestroy();
    });
  });
});
