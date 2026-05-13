import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';
import { DatabaseConnectionService } from './database-connection.service';
import { LoggerService } from '../logger';

describe('DatabaseConnectionService', () => {
  let service: DatabaseConnectionService;
  let mockConnection: Partial<Connection>;
  let loggerService: jest.Mocked<LoggerService>;

  const createService = async (connectionOverrides: Partial<Connection> = {}) => {
    const defaultConnection: Partial<Connection> = {
      readyState: ConnectionStates.connected,
      host: 'localhost',
      port: 27017,
      name: 'testdb',
      ...connectionOverrides,
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
        { provide: getConnectionToken(), useValue: defaultConnection },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    return {
      service: module.get<DatabaseConnectionService>(DatabaseConnectionService),
      connection: defaultConnection,
      loggerService: module.get(LoggerService) as jest.Mocked<LoggerService>,
    };
  };

  beforeEach(async () => {
    const result = await createService();
    service = result.service;
    mockConnection = result.connection;
    loggerService = result.loggerService;
  });

  describe('constructor', () => {
    it('should set logger context', () => {
      expect(loggerService.setContext).toHaveBeenCalledWith('DatabaseConnectionService');
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });
  });

  describe('isConnected', () => {
    it('should return true when connection state is connected', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.connected,
      });

      expect(service.isConnected()).toBe(true);
    });

    it('should return false when connection state is disconnected', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.disconnected,
      });

      expect(service.isConnected()).toBe(false);
    });

    it('should return false when connection state is connecting', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.connecting,
      });

      expect(service.isConnected()).toBe(false);
    });

    it('should return false when connection state is disconnecting', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.disconnecting,
      });

      expect(service.isConnected()).toBe(false);
    });

    it('should return false when connection state is uninitialized', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.uninitialized,
      });

      expect(service.isConnected()).toBe(false);
    });

    it('should return false when connection is undefined', async () => {
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
          { provide: getConnectionToken(), useValue: undefined },
          { provide: LoggerService, useValue: mockLoggerService },
        ],
      }).compile();

      const serviceWithNoConnection = module.get<DatabaseConnectionService>(DatabaseConnectionService);
      expect(serviceWithNoConnection.isConnected()).toBe(false);
    });
  });

  describe('getConnection', () => {
    it('should return the connection object', () => {
      const connection = service.getConnection();

      expect(connection).toBeDefined();
      expect(connection).toBe(mockConnection);
    });

    it('should return connection with correct properties', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.connected,
        host: 'mongodb.example.com',
        port: 27018,
        name: 'production_db',
      });

      const connection = service.getConnection();

      expect(connection.host).toBe('mongodb.example.com');
      expect(connection.port).toBe(27018);
      expect(connection.name).toBe('production_db');
    });
  });

  describe('getConnectionState', () => {
    it('should return "connected" when state is connected', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.connected,
      });

      expect(service.getConnectionState()).toBe('connected');
    });

    it('should return "disconnected" when state is disconnected', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.disconnected,
      });

      expect(service.getConnectionState()).toBe('disconnected');
    });

    it('should return "connecting" when state is connecting', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.connecting,
      });

      expect(service.getConnectionState()).toBe('connecting');
    });

    it('should return "disconnecting" when state is disconnecting', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.disconnecting,
      });

      expect(service.getConnectionState()).toBe('disconnecting');
    });

    it('should return "uninitialized" when state is uninitialized', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.uninitialized,
      });

      expect(service.getConnectionState()).toBe('uninitialized');
    });

    it('should return "not_initialized" when connection is undefined', async () => {
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
          { provide: getConnectionToken(), useValue: undefined },
          { provide: LoggerService, useValue: mockLoggerService },
        ],
      }).compile();

      const serviceWithNoConnection = module.get<DatabaseConnectionService>(DatabaseConnectionService);
      expect(serviceWithNoConnection.getConnectionState()).toBe('not_initialized');
    });

    it('should return "unknown" for unexpected state values', async () => {
      const { service } = await createService({
        readyState: 100 as ConnectionStates, // Invalid state (99 is uninitialized)
      });

      expect(service.getConnectionState()).toBe('unknown');
    });
  });

  describe('getConnectionInfo', () => {
    it('should return complete connection info when connected', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.connected,
        host: 'localhost',
        port: 27017,
        name: 'testdb',
      });

      const info = service.getConnectionInfo();

      expect(info).toEqual({
        state: 'connected',
        host: 'localhost',
        port: 27017,
        name: 'testdb',
        reconnectAttempts: 0,
        isReconnecting: false,
      });
    });

    it('should return disconnected state info', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.disconnected,
        host: 'localhost',
        port: 27017,
        name: 'testdb',
      });

      const info = service.getConnectionInfo();

      expect(info.state).toBe('disconnected');
      expect(info.isReconnecting).toBe(false);
    });

    it('should indicate reconnecting when state is connecting', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.connecting,
        host: 'localhost',
        port: 27017,
        name: 'testdb',
      });

      const info = service.getConnectionInfo();

      expect(info.state).toBe('connecting');
      expect(info.isReconnecting).toBe(true);
    });

    it('should handle undefined host, port, and name', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.connected,
        host: undefined,
        port: undefined,
        name: undefined,
      });

      const info = service.getConnectionInfo();

      expect(info.host).toBeUndefined();
      expect(info.port).toBeUndefined();
      expect(info.name).toBeUndefined();
    });

    it('should always return 0 for reconnectAttempts', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.connecting,
      });

      const info = service.getConnectionInfo();

      // MongooseModule handles reconnection internally, so we always report 0
      expect(info.reconnectAttempts).toBe(0);
    });

    it('should return info with different port numbers', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.connected,
        host: 'db.example.com',
        port: 27018,
        name: 'custom_db',
      });

      const info = service.getConnectionInfo();

      expect(info.host).toBe('db.example.com');
      expect(info.port).toBe(27018);
      expect(info.name).toBe('custom_db');
    });

    it('should handle disconnecting state', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.disconnecting,
        host: 'localhost',
        port: 27017,
        name: 'testdb',
      });

      const info = service.getConnectionInfo();

      expect(info.state).toBe('disconnecting');
      expect(info.isReconnecting).toBe(false);
    });

    it('should handle uninitialized state', async () => {
      const { service } = await createService({
        readyState: ConnectionStates.uninitialized,
        host: undefined,
        port: undefined,
        name: undefined,
      });

      const info = service.getConnectionInfo();

      expect(info.state).toBe('uninitialized');
      expect(info.isReconnecting).toBe(false);
    });
  });

  describe('connection state transitions', () => {
    it('should correctly report state changes', async () => {
      // Create a mutable connection mock
      const mutableConnection = {
        readyState: ConnectionStates.disconnected as ConnectionStates,
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
          { provide: getConnectionToken(), useValue: mutableConnection },
          { provide: LoggerService, useValue: mockLoggerService },
        ],
      }).compile();

      const testService = module.get<DatabaseConnectionService>(DatabaseConnectionService);

      // Initial state: disconnected
      expect(testService.isConnected()).toBe(false);
      expect(testService.getConnectionState()).toBe('disconnected');

      // Transition to connecting
      mutableConnection.readyState = ConnectionStates.connecting;
      expect(testService.isConnected()).toBe(false);
      expect(testService.getConnectionState()).toBe('connecting');
      expect(testService.getConnectionInfo().isReconnecting).toBe(true);

      // Transition to connected
      mutableConnection.readyState = ConnectionStates.connected;
      expect(testService.isConnected()).toBe(true);
      expect(testService.getConnectionState()).toBe('connected');
      expect(testService.getConnectionInfo().isReconnecting).toBe(false);

      // Transition to disconnecting
      mutableConnection.readyState = ConnectionStates.disconnecting;
      expect(testService.isConnected()).toBe(false);
      expect(testService.getConnectionState()).toBe('disconnecting');

      // Back to disconnected
      mutableConnection.readyState = ConnectionStates.disconnected;
      expect(testService.isConnected()).toBe(false);
      expect(testService.getConnectionState()).toBe('disconnected');
    });
  });

  describe('edge cases', () => {
    it('should handle null connection gracefully', async () => {
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
          { provide: getConnectionToken(), useValue: null },
          { provide: LoggerService, useValue: mockLoggerService },
        ],
      }).compile();

      const serviceWithNullConnection = module.get<DatabaseConnectionService>(DatabaseConnectionService);

      expect(serviceWithNullConnection.isConnected()).toBe(false);
      expect(serviceWithNullConnection.getConnectionState()).toBe('not_initialized');
    });

    it('should return connection even if state is not connected', async () => {
      const { service, connection } = await createService({
        readyState: ConnectionStates.disconnected,
      });

      // getConnection should return the connection object regardless of state
      expect(service.getConnection()).toBe(connection);
    });
  });
});
