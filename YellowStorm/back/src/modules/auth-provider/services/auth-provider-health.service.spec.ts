import { Test, TestingModule } from '@nestjs/testing';
import { AuthProviderHealthService } from './auth-provider-health.service';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { AUTH_PROVIDER_STORE } from '../persistence/auth-provider.stores';
import { makeProviderStoreFake, providerRecord, type AuthProviderStoreFake } from '../persistence/auth-provider-stores.fake';

describe('AuthProviderHealthService', () => {
  let service: AuthProviderHealthService;
  let providerStore: AuthProviderStoreFake;
  let cryptoService: { decrypt: jest.Mock };

  const mockLoggerService = {
    setContext: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  const mockProvider = (overrides = {}) => ({
    providerKey: 'microsoft',
    displayName: 'Microsoft',
    clientId: 'encrypted-id',
    clientSecret: 'encrypted-secret',
    tenantId: null,
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    enabled: true,
    ...overrides,
  });

  beforeEach(async () => {
    providerStore = makeProviderStoreFake();

    cryptoService = {
      decrypt: jest.fn().mockReturnValue('decrypted-value'),
    };

    // Mock global fetch
    global.fetch = jest.fn().mockResolvedValue({ status: 200 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthProviderHealthService,
        { provide: AUTH_PROVIDER_STORE, useValue: providerStore },
        { provide: CryptoService, useValue: cryptoService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    service = module.get<AuthProviderHealthService>(AuthProviderHealthService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should return up when no providers are configured', async () => {
    providerStore.records.splice(0, providerStore.records.length, ...([].map((p) => providerRecord(p))));

    const result = await service.check();

    expect(result.status).toBe('up');
    expect(result.message).toBe('No providers configured');
  });

  it('should return up when all enabled providers are healthy', async () => {
    providerStore.records.splice(0, providerStore.records.length, ...([mockProvider()].map((p) => providerRecord(p))));

    const result = await service.check();

    expect(result.status).toBe('up');
    expect(result.providers).toHaveLength(1);
    expect(result.providers![0].decryptionOk).toBe(true);
    expect(result.providers![0].authorizationUrlReachable).toBe(true);
  });

  it('should return down when decryption fails for all providers', async () => {
    cryptoService.decrypt.mockImplementation(() => {
      throw new Error('Unsupported state or unable to authenticate data');
    });
    providerStore.records.splice(0, providerStore.records.length, ...([mockProvider()].map((p) => providerRecord(p))));

    const result = await service.check();

    expect(result.status).toBe('down');
    expect(result.providers![0].decryptionOk).toBe(false);
    expect(result.providers![0].error).toContain('Decryption failed');
  });

  it('should return degraded when some providers are unhealthy', async () => {
    const providers = [
      mockProvider({ providerKey: 'microsoft' }),
      mockProvider({ providerKey: 'google', clientId: 'bad-encrypted' }),
    ];
    providerStore.records.splice(0, providerStore.records.length, ...(providers.map((p) => providerRecord(p))));

    // First provider decrypts fine, second fails
    let callCount = 0;
    cryptoService.decrypt.mockImplementation(() => {
      callCount++;
      if (callCount > 2) throw new Error('Bad key');
      return 'ok';
    });

    const result = await service.check();

    expect(result.status).toBe('degraded');
  });

  it('should return up when all providers are disabled', async () => {
    providerStore.records.splice(0, providerStore.records.length, ...([mockProvider({ enabled: false })].map((p) => providerRecord(p))));

    const result = await service.check();

    expect(result.status).toBe('up');
    expect(result.message).toContain('none enabled');
  });

  it('should skip URL check for disabled providers', async () => {
    providerStore.records.splice(0, providerStore.records.length, ...([mockProvider({ enabled: false })].map((p) => providerRecord(p))));

    await service.check();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should mark URL unreachable on network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));
    providerStore.records.splice(0, providerStore.records.length, ...([mockProvider()].map((p) => providerRecord(p))));

    const result = await service.check();

    expect(result.status).toBe('down');
    expect(result.providers![0].authorizationUrlReachable).toBe(false);
    expect(result.providers![0].error).toContain('unreachable');
  });

  it('should mark URL unreachable on 500 response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ status: 500 });
    providerStore.records.splice(0, providerStore.records.length, ...([mockProvider()].map((p) => providerRecord(p))));

    const result = await service.check();

    expect(result.providers![0].authorizationUrlReachable).toBe(false);
  });

  it('should accept 302/400/405 as reachable (expected from OAuth endpoints)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ status: 302 });
    providerStore.records.splice(0, providerStore.records.length, ...([mockProvider()].map((p) => providerRecord(p))));

    const result = await service.check();

    expect(result.providers![0].authorizationUrlReachable).toBe(true);
  });
});
