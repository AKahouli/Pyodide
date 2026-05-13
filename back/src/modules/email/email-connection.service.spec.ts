import { EmailConnectionService } from './email-connection.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger';
import * as nodemailer from 'nodemailer';
import { ConfidentialClientApplication } from '@azure/msal-node';

jest.mock('nodemailer');
jest.mock('@azure/msal-node');

const mockedCreateTransport = nodemailer.createTransport as jest.Mock;
const MockedConfidentialClientApplication = ConfidentialClientApplication as jest.MockedClass<typeof ConfidentialClientApplication>;

describe('EmailConnectionService', () => {
  let service: EmailConnectionService;
  let mockTransporter: {
    verify: jest.Mock;
    close: jest.Mock;
    sendMail: jest.Mock;
  };

  const createMockLogger = (): jest.Mocked<LoggerService> =>
    ({
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }) as unknown as jest.Mocked<LoggerService>;

  const createMockConfig = (overrides: Record<string, unknown> = {}): ConfigService => {
    const defaults: Record<string, unknown> = {
      'email.provider': 'smtp',
      'email.smtp.host': 'smtp.example.com',
      'email.smtp.port': 587,
      'email.smtp.secure': false,
      'email.smtp.user': 'user',
      'email.smtp.password': 'pass',
      'email.pool.enabled': false,
      'email.pool.maxConnections': 5,
      'email.pool.maxMessages': 100,
      'email.connectionTimeoutMs': 10000,
      'email.socketTimeoutMs': 30000,
      'email.outlook.clientId': '',
      'email.outlook.clientSecret': '',
      'email.outlook.tenantId': '',
      'email.outlook.authority': 'https://login.microsoftonline.com',
      'email.outlook.senderEmail': '',
      'email.reconnect.enabled': false,
      'email.reconnect.initialDelayMs': 10,
      'email.reconnect.maxDelayMs': 100,
      'email.reconnect.maxAttempts': 3,
      'email.reconnect.multiplier': 2,
      'email.healthCheck.enabled': false,
      'email.healthCheck.intervalMs': 60000,
      ...overrides,
    };
    return {
      get: jest.fn((key: string, defaultValue?: unknown) => defaults[key] ?? defaultValue),
    } as unknown as ConfigService;
  };

  const createService = (configOverrides: Record<string, unknown> = {}): EmailConnectionService => {
    service = new EmailConnectionService(
      createMockConfig(configOverrides),
      createMockLogger(),
    );
    return service;
  };

  /** Flush the microtask queue so async callbacks settle */
  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    mockTransporter = {
      verify: jest.fn().mockResolvedValue(true),
      close: jest.fn(),
      sendMail: jest.fn(),
    };

    mockedCreateTransport.mockReturnValue(mockTransporter);
  });

  afterEach(async () => {
    if (service) {
      await service.onModuleDestroy();
    }
    jest.useRealTimers();
  });

  describe('smtp provider', () => {
    describe('connect', () => {
      it('should create transporter and verify connection', async () => {
        createService();

        await service.connect();

        expect(mockedCreateTransport).toHaveBeenCalledTimes(1);
        expect(mockTransporter.verify).toHaveBeenCalled();
        expect(service.isConnectedNow()).toBe(true);
      });

      it('should not connect when SMTP host is empty', async () => {
        createService({ 'email.smtp.host': '' });

        await service.connect();

        expect(mockedCreateTransport).not.toHaveBeenCalled();
        expect(service.isConnectedNow()).toBe(false);
      });

      it('should set isConnected to false on verify failure', async () => {
        createService();
        mockTransporter.verify.mockRejectedValue(new Error('SMTP unreachable'));

        await service.connect();

        expect(service.isConnectedNow()).toBe(false);
      });

      it('should store error message on failure', async () => {
        createService();
        mockTransporter.verify.mockRejectedValue(new Error('Auth failed'));

        await service.connect();

        const status = service.getHealthStatus();
        expect(status.error).toBe('Auth failed');
      });

      it('should close existing transporter before reconnecting', async () => {
        createService();

        await service.connect();
        await service.connect();

        expect(mockTransporter.close).toHaveBeenCalled();
      });

      it('should skip if already connecting', async () => {
        createService();

        // Make verify hang so the first connect stays in-flight
        let resolveVerify!: (v: boolean) => void;
        mockTransporter.verify.mockReturnValue(
          new Promise<boolean>((r) => { resolveVerify = r; }),
        );

        const p1 = service.connect();
        // Flush so p1 reaches past closeTransporter and into verify
        await Promise.resolve();
        await Promise.resolve();

        const p2 = service.connect(); // should bail — isConnecting is true

        resolveVerify(true);
        await Promise.all([p1, p2]);

        expect(mockedCreateTransport).toHaveBeenCalledTimes(1);
      });

      it('should include pool options when pooling is enabled', async () => {
        createService({ 'email.pool.enabled': true, 'email.pool.maxConnections': 10 });

        await service.connect();

        expect(mockedCreateTransport).toHaveBeenCalledWith(
          expect.objectContaining({
            pool: true,
            maxConnections: 10,
          }),
        );
      });

      it('should include auth when credentials are provided', async () => {
        createService();

        await service.connect();

        expect(mockedCreateTransport).toHaveBeenCalledWith(
          expect.objectContaining({
            auth: { user: 'user', pass: 'pass' },
          }),
        );
      });

      it('should not include auth when credentials are missing', async () => {
        createService({ 'email.smtp.user': '', 'email.smtp.password': '' });

        await service.connect();

        const callArg = mockedCreateTransport.mock.calls[0][0];
        expect(callArg.auth).toBeUndefined();
      });

      it('should reset reconnect attempt counter on success', async () => {
        createService({ 'email.reconnect.enabled': true });

        // Fail first to increment reconnect counter
        mockTransporter.verify.mockRejectedValueOnce(new Error('fail'));
        await service.connect();

        // Now succeed
        mockTransporter.verify.mockResolvedValue(true);
        await service.connect();

        const status = service.getHealthStatus();
        expect(status.reconnectAttempts).toBe(0);
      });
    });

    describe('verifyConnection', () => {
      it('should return false when no transporter exists', async () => {
        createService();

        const result = await service.verifyConnection();

        expect(result).toBe(false);
        expect(service.isConnectedNow()).toBe(false);
      });

      it('should return true on successful verify', async () => {
        createService();
        await service.connect();

        const result = await service.verifyConnection();

        expect(result).toBe(true);
        expect(service.isConnectedNow()).toBe(true);
      });

      it('should return false on verify failure', async () => {
        createService();
        await service.connect();

        mockTransporter.verify.mockRejectedValueOnce(new Error('Connection lost'));

        const result = await service.verifyConnection();

        expect(result).toBe(false);
        expect(service.isConnectedNow()).toBe(false);
      });

      it('should reset reconnect counter on recovery', async () => {
        createService({ 'email.reconnect.enabled': true });
        await service.connect();

        // Simulate disconnect
        mockTransporter.verify.mockRejectedValueOnce(new Error('lost'));
        await service.verifyConnection();

        // Simulate recovery
        mockTransporter.verify.mockResolvedValue(true);
        await service.verifyConnection();

        expect(service.getHealthStatus().reconnectAttempts).toBe(0);
      });
    });

    describe('isAvailable', () => {
      it('should return true when SMTP host is configured', () => {
        createService();

        expect(service.isAvailable()).toBe(true);
      });

      it('should return false when SMTP host is empty', () => {
        createService({ 'email.smtp.host': '' });

        expect(service.isAvailable()).toBe(false);
      });
    });

    describe('isConnectedNow', () => {
      it('should return false before connect', () => {
        createService();

        expect(service.isConnectedNow()).toBe(false);
      });

      it('should return true after successful connect', async () => {
        createService();
        await service.connect();

        expect(service.isConnectedNow()).toBe(true);
      });
    });

    describe('getTransporter', () => {
      it('should return null before connect', () => {
        createService();

        expect(service.getTransporter()).toBeNull();
      });

      it('should return transporter after connect', async () => {
        createService();
        await service.connect();

        expect(service.getTransporter()).toBe(mockTransporter);
      });
    });

    describe('getProvider', () => {
      it('should return smtp by default', () => {
        createService();

        expect(service.getProvider()).toBe('smtp');
      });
    });

    describe('getHealthStatus', () => {
      it('should return initial status', () => {
        createService();
        const status = service.getHealthStatus();

        expect(status.available).toBe(true);
        expect(status.connected).toBe(false);
        expect(status.error).toBeNull();
        expect(status.reconnectAttempts).toBe(0);
        expect(status.isReconnecting).toBe(false);
      });

      it('should reflect connected state after connect', async () => {
        createService();
        await service.connect();

        const status = service.getHealthStatus();

        expect(status.connected).toBe(true);
        expect(status.error).toBeNull();
        expect(status.lastCheckedAt).toBeInstanceOf(Date);
        expect(status.lastConnectedAt).toBeInstanceOf(Date);
      });

      it('should reflect error state after failed connect', async () => {
        createService();
        mockTransporter.verify.mockRejectedValue(new Error('SMTP down'));

        await service.connect();

        const status = service.getHealthStatus();

        expect(status.connected).toBe(false);
        expect(status.error).toBe('SMTP down');
      });
    });

    describe('reconnection', () => {
      it('should schedule reconnect on connection failure', async () => {
        createService({ 'email.reconnect.enabled': true });
        mockTransporter.verify
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValue(true);

        await service.connect();

        expect(service.getHealthStatus().isReconnecting).toBe(true);

        // Advance past backoff delay and flush async connect
        jest.advanceTimersByTime(200);
        await flushMicrotasks();

        expect(mockedCreateTransport).toHaveBeenCalledTimes(2);
      });

      it('should not schedule reconnect when disabled', async () => {
        createService({ 'email.reconnect.enabled': false });
        mockTransporter.verify.mockRejectedValue(new Error('fail'));

        await service.connect();

        expect(service.getHealthStatus().isReconnecting).toBe(false);
      });

      it('should stop reconnecting after maxAttempts reached', async () => {
        createService({
          'email.reconnect.enabled': true,
          'email.reconnect.maxAttempts': 1,
        });
        mockTransporter.verify.mockRejectedValue(new Error('fail'));

        // Initial connect -> fails -> scheduleReconnect (attempt becomes 1)
        await service.connect();
        const callsAfterInit = mockedCreateTransport.mock.calls.length;

        // Reconnect attempt 1 fires -> fails -> maxAttempts (1) reached
        jest.advanceTimersByTime(200);
        await flushMicrotasks();

        const callsAfterFirstReconnect = mockedCreateTransport.mock.calls.length;
        expect(callsAfterFirstReconnect).toBe(callsAfterInit + 1);

        // Advance further — no additional reconnects should fire
        jest.advanceTimersByTime(10000);
        await flushMicrotasks();

        expect(mockedCreateTransport.mock.calls.length).toBe(callsAfterFirstReconnect);
      });
    });

    describe('onModuleInit', () => {
      it('should connect on init', async () => {
        createService();

        await service.onModuleInit();

        expect(mockedCreateTransport).toHaveBeenCalled();
        expect(service.isConnectedNow()).toBe(true);
      });
    });

    describe('onModuleDestroy', () => {
      it('should close transporter on destroy', async () => {
        createService();
        await service.connect();

        await service.onModuleDestroy();

        expect(mockTransporter.close).toHaveBeenCalled();
      });

      it('should not throw when no transporter exists', async () => {
        createService({ 'email.smtp.host': '' });

        await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      });
    });

    describe('health check', () => {
      it('should start periodic health checks when enabled', async () => {
        createService({ 'email.healthCheck.enabled': true, 'email.healthCheck.intervalMs': 5000 });

        await service.onModuleInit();
        mockTransporter.verify.mockClear();

        jest.advanceTimersByTime(5100);

        expect(mockTransporter.verify).toHaveBeenCalled();
      });

      it('should not start health checks when disabled', async () => {
        createService({ 'email.healthCheck.enabled': false });

        await service.onModuleInit();
        mockTransporter.verify.mockClear();

        jest.advanceTimersByTime(120000);

        expect(mockTransporter.verify).not.toHaveBeenCalled();
      });

      it('should not start health checks when SMTP host is empty', async () => {
        createService({ 'email.smtp.host': '', 'email.healthCheck.enabled': true });

        await service.onModuleInit();

        jest.advanceTimersByTime(120000);

        expect(mockedCreateTransport).not.toHaveBeenCalled();
      });
    });
  });

  describe('outlook provider', () => {
    let mockMsalInstance: {
      acquireTokenByClientCredential: jest.Mock;
    };

    const outlookConfig: Record<string, unknown> = {
      'email.provider': 'outlook',
      'email.smtp.host': '',
      'email.outlook.clientId': 'test-client-id',
      'email.outlook.clientSecret': 'test-client-secret',
      'email.outlook.tenantId': 'test-tenant-id',
      'email.outlook.authority': 'https://login.microsoftonline.com',
      'email.outlook.senderEmail': 'sender@company.com',
    };

    beforeEach(() => {
      mockMsalInstance = {
        acquireTokenByClientCredential: jest.fn().mockResolvedValue({
          accessToken: 'mock-access-token',
        }),
      };

      MockedConfidentialClientApplication.mockImplementation(
        () => mockMsalInstance as unknown as ConfidentialClientApplication,
      );
    });

    describe('getProvider', () => {
      it('should return outlook when configured', () => {
        createService(outlookConfig);
        expect(service.getProvider()).toBe('outlook');
      });
    });

    describe('getSenderEmail', () => {
      it('should return the configured sender email', () => {
        createService(outlookConfig);
        expect(service.getSenderEmail()).toBe('sender@company.com');
      });
    });

    describe('isAvailable', () => {
      it('should return true when outlook credentials are configured', () => {
        createService(outlookConfig);
        expect(service.isAvailable()).toBe(true);
      });

      it('should return false when outlook clientId is missing', () => {
        createService({ ...outlookConfig, 'email.outlook.clientId': '' });
        expect(service.isAvailable()).toBe(false);
      });

      it('should return false when outlook clientSecret is missing', () => {
        createService({ ...outlookConfig, 'email.outlook.clientSecret': '' });
        expect(service.isAvailable()).toBe(false);
      });

      it('should return false when outlook tenantId is missing', () => {
        createService({ ...outlookConfig, 'email.outlook.tenantId': '' });
        expect(service.isAvailable()).toBe(false);
      });
    });

    describe('connectOutlook', () => {
      it('should initialize MSAL client and acquire token on success', async () => {
        createService(outlookConfig);

        await service.connect();

        expect(MockedConfidentialClientApplication).toHaveBeenCalledWith({
          auth: {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            authority: 'https://login.microsoftonline.com/test-tenant-id',
          },
        });
        expect(mockMsalInstance.acquireTokenByClientCredential).toHaveBeenCalledWith({
          scopes: ['https://graph.microsoft.com/.default'],
        });
        expect(service.isConnectedNow()).toBe(true);
      });

      it('should set isConnected to false on token acquisition failure', async () => {
        createService(outlookConfig);
        mockMsalInstance.acquireTokenByClientCredential.mockRejectedValue(
          new Error('Invalid client credentials'),
        );

        await service.connect();

        expect(service.isConnectedNow()).toBe(false);
        expect(service.getHealthStatus().error).toBe('Invalid client credentials');
      });

      it('should fail when token response has no accessToken', async () => {
        createService(outlookConfig);
        mockMsalInstance.acquireTokenByClientCredential.mockResolvedValue(null);

        await service.connect();

        expect(service.isConnectedNow()).toBe(false);
        expect(service.getHealthStatus().error).toBe('Failed to acquire access token from Azure AD');
      });

      it('should not connect when credentials are missing', async () => {
        createService({
          ...outlookConfig,
          'email.outlook.clientId': '',
        });

        await service.connect();

        expect(MockedConfidentialClientApplication).not.toHaveBeenCalled();
        expect(service.isConnectedNow()).toBe(false);
      });

      it('should skip if already connecting', async () => {
        createService(outlookConfig);

        let resolveToken!: (v: unknown) => void;
        mockMsalInstance.acquireTokenByClientCredential.mockReturnValue(
          new Promise((r) => { resolveToken = r; }),
        );

        const p1 = service.connect();
        await Promise.resolve();
        await Promise.resolve();

        const p2 = service.connect();

        resolveToken({ accessToken: 'token' });
        await Promise.all([p1, p2]);

        expect(MockedConfidentialClientApplication).toHaveBeenCalledTimes(1);
      });

      it('should reset reconnect counter on success', async () => {
        createService({ ...outlookConfig, 'email.reconnect.enabled': true });

        mockMsalInstance.acquireTokenByClientCredential.mockRejectedValueOnce(new Error('fail'));
        await service.connect();

        mockMsalInstance.acquireTokenByClientCredential.mockResolvedValue({ accessToken: 'token' });
        await service.connect();

        expect(service.getHealthStatus().reconnectAttempts).toBe(0);
      });
    });

    describe('verifyOutlookConnection', () => {
      it('should return true when token can be acquired', async () => {
        createService(outlookConfig);
        await service.connect();

        const result = await service.verifyConnection();

        expect(result).toBe(true);
        expect(service.isConnectedNow()).toBe(true);
      });

      it('should return false when MSAL client is not initialized', async () => {
        createService(outlookConfig);
        // Don't call connect — no MSAL client

        // Force provider to outlook without connecting
        const result = await service.verifyConnection();

        expect(result).toBe(false);
      });

      it('should return false when token acquisition fails', async () => {
        createService(outlookConfig);
        await service.connect();

        mockMsalInstance.acquireTokenByClientCredential.mockRejectedValueOnce(
          new Error('Token expired'),
        );

        const result = await service.verifyConnection();

        expect(result).toBe(false);
        expect(service.isConnectedNow()).toBe(false);
      });

      it('should schedule reconnect on connection loss', async () => {
        createService({ ...outlookConfig, 'email.reconnect.enabled': true });
        await service.connect();

        mockMsalInstance.acquireTokenByClientCredential.mockRejectedValueOnce(
          new Error('Connection lost'),
        );
        await service.verifyConnection();

        expect(service.getHealthStatus().isReconnecting).toBe(true);
      });
    });

    describe('getAccessToken', () => {
      it('should return access token when connected', async () => {
        createService(outlookConfig);
        await service.connect();

        const token = await service.getAccessToken();

        expect(token).toBe('mock-access-token');
      });

      it('should throw when MSAL client is not initialized', async () => {
        createService(outlookConfig);

        await expect(service.getAccessToken()).rejects.toThrow('MSAL client not initialized');
      });

      it('should throw when token response is null', async () => {
        createService(outlookConfig);
        await service.connect();

        mockMsalInstance.acquireTokenByClientCredential.mockResolvedValueOnce(null);

        await expect(service.getAccessToken()).rejects.toThrow('Failed to acquire access token');
      });
    });

    describe('reconnection', () => {
      it('should schedule reconnect on outlook connection failure', async () => {
        createService({ ...outlookConfig, 'email.reconnect.enabled': true });
        mockMsalInstance.acquireTokenByClientCredential
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValue({ accessToken: 'token' });

        await service.connect();

        expect(service.getHealthStatus().isReconnecting).toBe(true);

        jest.advanceTimersByTime(200);
        await flushMicrotasks();

        expect(MockedConfidentialClientApplication).toHaveBeenCalledTimes(2);
      });

      it('should not schedule reconnect when disabled', async () => {
        createService({ ...outlookConfig, 'email.reconnect.enabled': false });
        mockMsalInstance.acquireTokenByClientCredential.mockRejectedValue(new Error('fail'));

        await service.connect();

        expect(service.getHealthStatus().isReconnecting).toBe(false);
      });
    });

    describe('health check', () => {
      it('should start periodic health checks for outlook when enabled', async () => {
        createService({
          ...outlookConfig,
          'email.healthCheck.enabled': true,
          'email.healthCheck.intervalMs': 5000,
        });

        await service.onModuleInit();
        mockMsalInstance.acquireTokenByClientCredential.mockClear();

        jest.advanceTimersByTime(5100);

        expect(mockMsalInstance.acquireTokenByClientCredential).toHaveBeenCalled();
      });

      it('should not start health checks when outlook credentials missing', async () => {
        createService({
          ...outlookConfig,
          'email.outlook.clientId': '',
          'email.healthCheck.enabled': true,
        });

        await service.onModuleInit();

        jest.advanceTimersByTime(120000);

        expect(MockedConfidentialClientApplication).not.toHaveBeenCalled();
      });
    });

    describe('onModuleDestroy', () => {
      it('should not throw for outlook provider', async () => {
        createService(outlookConfig);
        await service.connect();

        await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      });
    });
  });
});
