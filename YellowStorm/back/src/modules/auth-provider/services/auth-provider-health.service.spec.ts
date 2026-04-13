import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AuthProviderHealthService } from './auth-provider-health.service';
import { AuthProvider } from '../schemas/auth-provider.schema';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';

function createQueryChain(resolvedValue: unknown) {
  const chain: Record<string, jest.Mock> = {};
  ['select', 'lean', 'sort', 'skip', 'limit', 'populate'].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

describe('AuthProviderHealthService', () => {
  let service: AuthProviderHealthService;
  let authProviderModel: Record<string, jest.Mock>;
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
    authProviderModel = {
      find: jest.fn(),
    };

    cryptoService = {
      decrypt: jest.fn().mockReturnValue('decrypted-value'),
    };

    // Mock global fetch
    global.fetch = jest.fn().mockResolvedValue({ status: 200 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthProviderHealthService,
        { provide: getModelToken(AuthProvider.name), useValue: authProviderModel },
        { provide: CryptoService, useValue: cryptoService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    service = module.get<AuthProviderHealthService>(AuthProviderHealthService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should return up when no providers are configured', async () => {
    const chain = createQueryChain([]);
    authProviderModel.find.mockReturnValue(chain);

    const result = await service.check();

    expect(result.status).toBe('up');
    expect(result.message).toBe('No providers configured');
  });

  it('should return up when all enabled providers are healthy', async () => {
    const chain = createQueryChain([mockProvider()]);
    authProviderModel.find.mockReturnValue(chain);

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
    const chain = createQueryChain([mockProvider()]);
    authProviderModel.find.mockReturnValue(chain);

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
    const chain = createQueryChain(providers);
    authProviderModel.find.mockReturnValue(chain);

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
    const chain = createQueryChain([mockProvider({ enabled: false })]);
    authProviderModel.find.mockReturnValue(chain);

    const result = await service.check();

    expect(result.status).toBe('up');
    expect(result.message).toContain('none enabled');
  });

  it('should skip URL check for disabled providers', async () => {
    const chain = createQueryChain([mockProvider({ enabled: false })]);
    authProviderModel.find.mockReturnValue(chain);

    await service.check();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should mark URL unreachable on network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));
    const chain = createQueryChain([mockProvider()]);
    authProviderModel.find.mockReturnValue(chain);

    const result = await service.check();

    expect(result.status).toBe('down');
    expect(result.providers![0].authorizationUrlReachable).toBe(false);
    expect(result.providers![0].error).toContain('unreachable');
  });

  it('should mark URL unreachable on 500 response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ status: 500 });
    const chain = createQueryChain([mockProvider()]);
    authProviderModel.find.mockReturnValue(chain);

    const result = await service.check();

    expect(result.providers![0].authorizationUrlReachable).toBe(false);
  });

  it('should accept 302/400/405 as reachable (expected from OAuth endpoints)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ status: 302 });
    const chain = createQueryChain([mockProvider()]);
    authProviderModel.find.mockReturnValue(chain);

    const result = await service.check();

    expect(result.providers![0].authorizationUrlReachable).toBe(true);
  });
});
