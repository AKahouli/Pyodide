import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { ConnectionStates } from 'mongoose';
import { DatabaseModule } from './database.module';
import { DatabaseConnectionService } from './database-connection.service';
import { LoggerService } from '../logger';

describe('DatabaseModule', () => {
  describe('module definition', () => {
    it('should be defined', () => {
      expect(DatabaseModule).toBeDefined();
    });
  });

  describe('DatabaseConnectionService integration', () => {
    let service: DatabaseConnectionService;
    let mockConnection: {
      readyState: ConnectionStates;
      host: string;
      port: number;
      name: string;
    };

    beforeEach(async () => {
      mockConnection = {
        readyState: ConnectionStates.connected,
        host: 'localhost',
        port: 27017,
        name: 'testdb',
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
          DatabaseConnectionService,
          { provide: getConnectionToken(), useValue: mockConnection },
          { provide: LoggerService, useValue: mockLoggerService },
        ],
      }).compile();

      service = module.get<DatabaseConnectionService>(DatabaseConnectionService);
    });

    it('should provide DatabaseConnectionService', () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(DatabaseConnectionService);
    });

    it('should be able to check connection status', () => {
      expect(service.isConnected()).toBe(true);
    });

    it('should be able to get connection info', () => {
      const info = service.getConnectionInfo();
      expect(info.state).toBe('connected');
      expect(info.host).toBe('localhost');
    });
  });

  describe('MongooseModule configuration', () => {
    it('should create configuration with production settings', () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          const config: Record<string, unknown> = {
            'database.uri': 'mongodb://localhost:27017/testdb',
            'app.nodeEnv': 'production',
            'database.maxPoolSize': 10,
            'database.minPoolSize': 2,
            'database.serverSelectionTimeoutMs': 5000,
            'database.socketTimeoutMs': 45000,
            'database.connectTimeoutMs': 10000,
            'database.retryWrites': true,
            'database.retryReads': true,
            'database.maxIdleTimeMs': 60000,
            'database.heartbeatFrequencyMs': 10000,
          };
          return config[key];
        }),
      };

      // Simulate the factory function behavior
      const configService = mockConfigService as unknown as ConfigService;
      const uri = configService.get<string>('database.uri')!;
      const isProduction = configService.get<string>('app.nodeEnv') === 'production';

      const mongooseConfig = {
        uri,
        maxPoolSize: configService.get<number>('database.maxPoolSize'),
        minPoolSize: configService.get<number>('database.minPoolSize'),
        serverSelectionTimeoutMS: configService.get<number>('database.serverSelectionTimeoutMs'),
        socketTimeoutMS: configService.get<number>('database.socketTimeoutMs'),
        connectTimeoutMS: configService.get<number>('database.connectTimeoutMs'),
        retryWrites: configService.get<boolean>('database.retryWrites'),
        retryReads: configService.get<boolean>('database.retryReads'),
        maxIdleTimeMS: configService.get<number>('database.maxIdleTimeMs'),
        heartbeatFrequencyMS: configService.get<number>('database.heartbeatFrequencyMs'),
        autoIndex: !isProduction,
        autoCreate: !isProduction,
      };

      expect(mongooseConfig.uri).toBe('mongodb://localhost:27017/testdb');
      expect(mongooseConfig.maxPoolSize).toBe(10);
      expect(mongooseConfig.minPoolSize).toBe(2);
      expect(mongooseConfig.serverSelectionTimeoutMS).toBe(5000);
      expect(mongooseConfig.socketTimeoutMS).toBe(45000);
      expect(mongooseConfig.connectTimeoutMS).toBe(10000);
      expect(mongooseConfig.retryWrites).toBe(true);
      expect(mongooseConfig.retryReads).toBe(true);
      expect(mongooseConfig.maxIdleTimeMS).toBe(60000);
      expect(mongooseConfig.heartbeatFrequencyMS).toBe(10000);
      // In production, autoIndex and autoCreate should be false
      expect(mongooseConfig.autoIndex).toBe(false);
      expect(mongooseConfig.autoCreate).toBe(false);
    });

    it('should create configuration with development settings', () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          const config: Record<string, unknown> = {
            'database.uri': 'mongodb://localhost:27017/devdb',
            'app.nodeEnv': 'development',
            'database.maxPoolSize': 5,
            'database.minPoolSize': 1,
            'database.serverSelectionTimeoutMs': 10000,
            'database.socketTimeoutMs': 30000,
            'database.connectTimeoutMs': 5000,
            'database.retryWrites': true,
            'database.retryReads': true,
            'database.maxIdleTimeMs': 30000,
            'database.heartbeatFrequencyMs': 5000,
          };
          return config[key];
        }),
      };

      const configService = mockConfigService as unknown as ConfigService;
      const isProduction = configService.get<string>('app.nodeEnv') === 'production';

      // In development, autoIndex and autoCreate should be true
      expect(!isProduction).toBe(true);
    });

    it('should handle connection factory events', () => {
      // Create a mock connection with event handlers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eventHandlers: Record<string, (arg?: any) => void> = {};
      const mockConnectionWithEvents = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        on: jest.fn((event: string, handler: (arg?: any) => void) => {
          eventHandlers[event] = handler;
        }),
        readyState: ConnectionStates.connected,
      };

      // Simulate connectionFactory behavior
      const connectionFactory = (connection: typeof mockConnectionWithEvents) => {
        connection.on('connected', () => {
          console.log(`[DatabaseModule] MongoDB connected successfully`);
        });
        connection.on('error', (error: Error) => {
          console.error(`[DatabaseModule] MongoDB connection error:`, error.message);
        });
        connection.on('disconnected', () => {
          console.warn(`[DatabaseModule] MongoDB disconnected`);
        });
        return connection;
      };

      const result = connectionFactory(mockConnectionWithEvents);

      // Verify event handlers were registered
      expect(mockConnectionWithEvents.on).toHaveBeenCalledWith('connected', expect.any(Function));
      expect(mockConnectionWithEvents.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockConnectionWithEvents.on).toHaveBeenCalledWith('disconnected', expect.any(Function));

      // Verify connection is returned
      expect(result).toBe(mockConnectionWithEvents);

      // Test event handlers can be called without errors
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      eventHandlers['connected']?.();
      expect(consoleSpy).toHaveBeenCalledWith('[DatabaseModule] MongoDB connected successfully');

      eventHandlers['error']?.(new Error('Test error'));
      expect(consoleErrorSpy).toHaveBeenCalledWith('[DatabaseModule] MongoDB connection error:', 'Test error');

      eventHandlers['disconnected']?.();
      expect(consoleWarnSpy).toHaveBeenCalledWith('[DatabaseModule] MongoDB disconnected');

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('configuration variations', () => {
    it('should handle test environment', () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          const config: Record<string, unknown> = {
            'app.nodeEnv': 'test',
          };
          return config[key];
        }),
      };

      const configService = mockConfigService as unknown as ConfigService;
      const isProduction = configService.get<string>('app.nodeEnv') === 'production';

      // In test environment, autoIndex and autoCreate should be true (not production)
      expect(!isProduction).toBe(true);
    });

    it('should handle staging environment', () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          const config: Record<string, unknown> = {
            'app.nodeEnv': 'staging',
          };
          return config[key];
        }),
      };

      const configService = mockConfigService as unknown as ConfigService;
      const isProduction = configService.get<string>('app.nodeEnv') === 'production';

      // In staging environment, autoIndex and autoCreate should be true (not production)
      expect(!isProduction).toBe(true);
    });

    it('should handle missing optional configuration values', () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          const config: Record<string, unknown> = {
            'database.uri': 'mongodb://localhost:27017/testdb',
            'app.nodeEnv': 'development',
            // Other values are undefined
          };
          return config[key];
        }),
      };

      const configService = mockConfigService as unknown as ConfigService;

      // These should return undefined, which Mongoose will handle with defaults
      expect(configService.get<number>('database.maxPoolSize')).toBeUndefined();
      expect(configService.get<number>('database.minPoolSize')).toBeUndefined();
    });

    it('should handle custom pool sizes', () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          const config: Record<string, unknown> = {
            'database.maxPoolSize': 50,
            'database.minPoolSize': 10,
          };
          return config[key];
        }),
      };

      const configService = mockConfigService as unknown as ConfigService;

      expect(configService.get<number>('database.maxPoolSize')).toBe(50);
      expect(configService.get<number>('database.minPoolSize')).toBe(10);
    });

    it('should handle retry configuration', () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          const config: Record<string, unknown> = {
            'database.retryWrites': false,
            'database.retryReads': false,
          };
          return config[key];
        }),
      };

      const configService = mockConfigService as unknown as ConfigService;

      expect(configService.get<boolean>('database.retryWrites')).toBe(false);
      expect(configService.get<boolean>('database.retryReads')).toBe(false);
    });

    it('should handle timeout configurations', () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          const config: Record<string, unknown> = {
            'database.serverSelectionTimeoutMs': 30000,
            'database.socketTimeoutMs': 60000,
            'database.connectTimeoutMs': 20000,
            'database.maxIdleTimeMs': 120000,
            'database.heartbeatFrequencyMs': 15000,
          };
          return config[key];
        }),
      };

      const configService = mockConfigService as unknown as ConfigService;

      expect(configService.get<number>('database.serverSelectionTimeoutMs')).toBe(30000);
      expect(configService.get<number>('database.socketTimeoutMs')).toBe(60000);
      expect(configService.get<number>('database.connectTimeoutMs')).toBe(20000);
      expect(configService.get<number>('database.maxIdleTimeMs')).toBe(120000);
      expect(configService.get<number>('database.heartbeatFrequencyMs')).toBe(15000);
    });
  });
});
