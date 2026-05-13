import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AuthProviderService } from './auth-provider.service';
import { AuthProvider } from '../schemas/auth-provider.schema';
import { UserProviderLink } from '../schemas/user-provider-link.schema';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { SystemService } from '@modules/system/system.service';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

function createQueryChain(resolvedValue: unknown) {
  const chain: Record<string, jest.Mock> = {};
  ['select', 'lean', 'sort', 'skip', 'limit', 'populate'].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

describe('AuthProviderService', () => {
  let service: AuthProviderService;
  let authProviderModel: Record<string, jest.Mock>;
  let userProviderLinkModel: Record<string, jest.Mock>;
  let cryptoService: { encrypt: jest.Mock; decrypt: jest.Mock; isEncrypted: jest.Mock };
  let systemService: {
    isRegistrationEnabled: jest.Mock;
    setRegistrationEnabled: jest.Mock;
    isClassicAuthEnabled: jest.Mock;
    setClassicAuthEnabled: jest.Mock;
  };

  const MOCK_ID = new Types.ObjectId().toHexString();

  const mockProvider = {
    _id: new Types.ObjectId(MOCK_ID),
    providerKey: 'microsoft',
    displayName: 'Microsoft',
    clientId: 'encrypted:real-client-id',
    clientSecret: 'encrypted:real-client-secret',
    tenantId: 'encrypted:real-tenant-id',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scopes: ['openid', 'email', 'profile'],
    iconKey: 'microsoft',
    sortOrder: 0,
    pkceEnabled: true,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockLoggerService = {
    setContext: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    authProviderModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      deleteOne: jest.fn(),
      create: jest.fn(),
    };

    userProviderLinkModel = {
      countDocuments: jest.fn(),
      deleteMany: jest.fn(),
    };

    cryptoService = {
      encrypt: jest.fn((val: string) => `encrypted:${val}`),
      decrypt: jest.fn((val: string) => val.replace('encrypted:', '')),
      isEncrypted: jest.fn(() => true),
    };

    systemService = {
      isRegistrationEnabled: jest.fn().mockReturnValue(true),
      setRegistrationEnabled: jest.fn().mockResolvedValue({ enabled: true }),
      isClassicAuthEnabled: jest.fn().mockReturnValue(true),
      setClassicAuthEnabled: jest.fn().mockResolvedValue({ enabled: true, classicAuthEnabled: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthProviderService,
        { provide: getModelToken(AuthProvider.name), useValue: authProviderModel },
        { provide: getModelToken(UserProviderLink.name), useValue: userProviderLinkModel },
        { provide: CryptoService, useValue: cryptoService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: SystemService, useValue: systemService },
      ],
    }).compile();

    service = module.get<AuthProviderService>(AuthProviderService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAll', () => {
    it('should return classic provider first, then all providers with masked secrets', async () => {
      const chain = createQueryChain([mockProvider]);
      authProviderModel.find.mockReturnValue(chain);
      userProviderLinkModel.countDocuments.mockResolvedValue(3);

      const result = await service.findAll();

      // Classic provider is prepended
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('classic');
      expect(result[0].id).toBe('classic');
      expect(result[0].providerKey).toBe('classic');
      expect(result[0].registrationEnabled).toBe(true);

      // OAuth provider follows
      expect(result[1].type).toBe('oauth');
      expect(result[1].clientId).toBe('****');
      expect(result[1].clientSecret).toBe('****');
      expect(result[1].tenantId).toBe('****');
      expect(result[1].linkedUserCount).toBe(3);
      expect(result[1].providerKey).toBe('microsoft');
    });

    it('should return only classic provider when no OAuth providers exist', async () => {
      const chain = createQueryChain([]);
      authProviderModel.find.mockReturnValue(chain);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('classic');
      expect(result[0].providerKey).toBe('classic');
    });
  });

  describe('findEnabled', () => {
    it('should return enabled OAuth providers plus classic provider', async () => {
      const chain = createQueryChain([mockProvider]);
      authProviderModel.find.mockReturnValue(chain);

      const result = await service.findEnabled();

      expect(result).toHaveLength(2);
      // OAuth provider first (sorted by sortOrder)
      expect(result[0]).toEqual({
        type: 'oauth',
        providerKey: 'microsoft',
        displayName: 'Microsoft',
        iconKey: 'microsoft',
        sortOrder: 0,
      });
      // Classic provider appended last
      expect(result[1]).toEqual({
        type: 'classic',
        providerKey: 'classic',
        displayName: 'Email & Password',
        iconKey: 'email',
        sortOrder: 999,
        registrationEnabled: true,
      });
      expect(authProviderModel.find).toHaveBeenCalledWith({ enabled: true });
    });

    it('should reflect registration disabled in classic provider', async () => {
      const chain = createQueryChain([]);
      authProviderModel.find.mockReturnValue(chain);
      systemService.isRegistrationEnabled.mockReturnValue(false);

      const result = await service.findEnabled();

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('classic');
      expect(result[0].registrationEnabled).toBe(false);
    });

    it('should exclude classic provider when classic auth is disabled', async () => {
      const chain = createQueryChain([mockProvider]);
      authProviderModel.find.mockReturnValue(chain);
      systemService.isClassicAuthEnabled.mockReturnValue(false);

      const result = await service.findEnabled();

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('oauth');
      expect(result[0].providerKey).toBe('microsoft');
    });
  });

  describe('findByKey', () => {
    it('should return decrypted provider config', async () => {
      const chain = createQueryChain(mockProvider);
      authProviderModel.findOne.mockReturnValue(chain);

      const result = await service.findByKey('microsoft');

      expect(result.clientId).toBe('real-client-id');
      expect(result.clientSecret).toBe('real-client-secret');
      expect(result.tenantId).toBe('real-tenant-id');
      expect(cryptoService.decrypt).toHaveBeenCalledTimes(3);
    });

    it('should throw when provider not found', async () => {
      const chain = createQueryChain(null);
      authProviderModel.findOne.mockReturnValue(chain);

      await expect(service.findByKey('unknown')).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_PROVIDER_NOT_FOUND,
      });
    });

    it('should throw when provider is disabled', async () => {
      const chain = createQueryChain({ ...mockProvider, enabled: false });
      authProviderModel.findOne.mockReturnValue(chain);

      await expect(service.findByKey('microsoft')).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_PROVIDER_DISABLED,
      });
    });
  });

  describe('findById', () => {
    it('should return masked provider with linked user count', async () => {
      const chain = createQueryChain(mockProvider);
      authProviderModel.findById.mockReturnValue(chain);
      userProviderLinkModel.countDocuments.mockResolvedValue(5);

      const result = await service.findById(MOCK_ID);

      expect(result.clientId).toBe('****');
      expect(result.linkedUserCount).toBe(5);
    });

    it('should throw when not found', async () => {
      const chain = createQueryChain(null);
      authProviderModel.findById.mockReturnValue(chain);

      await expect(service.findById(MOCK_ID)).rejects.toMatchObject({
        code: ErrorCode.AUTH_PROVIDER_NOT_FOUND,
      });
    });
  });

  describe('create', () => {
    it('should encrypt secrets and create provider', async () => {
      authProviderModel.findOne.mockResolvedValue(null);

      const saveMock = jest.fn().mockResolvedValue(undefined);
      const mockInstance = {
        ...mockProvider,
        save: saveMock,
        toObject: jest.fn().mockReturnValue(mockProvider),
      };

      // Mock the constructor (new this.authProviderModel(...))
      // We need to use a function constructor for the model
      const constructorMock = jest.fn().mockReturnValue(mockInstance);
      Object.assign(constructorMock, authProviderModel);
      (service as any).authProviderModel = constructorMock;

      const dto = {
        providerKey: 'microsoft',
        displayName: 'Microsoft',
        clientId: 'real-client-id',
        clientSecret: 'real-client-secret',
        tenantId: 'real-tenant-id',
        authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
      };

      const result = await service.create(dto);

      expect(cryptoService.encrypt).toHaveBeenCalledWith('real-client-id');
      expect(cryptoService.encrypt).toHaveBeenCalledWith('real-client-secret');
      expect(cryptoService.encrypt).toHaveBeenCalledWith('real-tenant-id');
      expect(saveMock).toHaveBeenCalled();
      expect(result.clientId).toBe('****');
    });

    it('should reject duplicate provider key', async () => {
      authProviderModel.findOne.mockResolvedValue(mockProvider);

      const dto = {
        providerKey: 'microsoft',
        displayName: 'Microsoft',
        clientId: 'id',
        clientSecret: 'secret',
        authorizationUrl: 'https://example.com/auth',
        tokenUrl: 'https://example.com/token',
        userinfoUrl: 'https://example.com/userinfo',
      };

      await expect(service.create(dto)).rejects.toMatchObject({
        code: ErrorCode.AUTH_PROVIDER_ALREADY_EXISTS,
      });
    });
  });

  describe('delete', () => {
    it('should delete provider without removing links by default', async () => {
      authProviderModel.findById.mockResolvedValue(mockProvider);
      authProviderModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await service.delete(MOCK_ID);

      expect(authProviderModel.deleteOne).toHaveBeenCalledWith({ _id: MOCK_ID });
      expect(userProviderLinkModel.deleteMany).not.toHaveBeenCalled();
      expect(result.unlinkedUsers).toBe(0);
    });

    it('should delete provider and links when deleteLinks is true', async () => {
      authProviderModel.findById.mockResolvedValue(mockProvider);
      authProviderModel.deleteOne.mockResolvedValue({ deletedCount: 1 });
      userProviderLinkModel.deleteMany.mockResolvedValue({ deletedCount: 5 });

      const result = await service.delete(MOCK_ID, true);

      expect(userProviderLinkModel.deleteMany).toHaveBeenCalledWith({
        providerKey: 'microsoft',
      });
      expect(authProviderModel.deleteOne).toHaveBeenCalled();
      expect(result.unlinkedUsers).toBe(5);
    });

    it('should throw when provider not found', async () => {
      authProviderModel.findById.mockResolvedValue(null);

      await expect(service.delete(MOCK_ID)).rejects.toMatchObject({
        code: ErrorCode.AUTH_PROVIDER_NOT_FOUND,
      });
    });
  });

  describe('getLinkedUserCount', () => {
    it('should return the count of linked users', async () => {
      userProviderLinkModel.countDocuments.mockResolvedValue(7);

      const count = await service.getLinkedUserCount('microsoft');

      expect(count).toBe(7);
      expect(userProviderLinkModel.countDocuments).toHaveBeenCalledWith({
        providerKey: 'microsoft',
      });
    });
  });

  describe('updateClassicAuth', () => {
    it('should delegate registration toggle to SystemService', async () => {
      const result = await service.updateClassicAuth(
        { registrationEnabled: false },
        'user-123',
      );

      expect(systemService.setRegistrationEnabled).toHaveBeenCalledWith(false, {
        userId: 'user-123',
      });
      expect(result.type).toBe('classic');
      expect(result.id).toBe('classic');
    });

    it('should delegate enabled toggle to SystemService', async () => {
      const result = await service.updateClassicAuth(
        { enabled: false },
        'user-123',
      );

      expect(systemService.setClassicAuthEnabled).toHaveBeenCalledWith(false, {
        userId: 'user-123',
      });
      expect(result.type).toBe('classic');
    });

    it('should not call any setter when nothing provided', async () => {
      const result = await service.updateClassicAuth({});

      expect(systemService.setRegistrationEnabled).not.toHaveBeenCalled();
      expect(systemService.setClassicAuthEnabled).not.toHaveBeenCalled();
      expect(result.type).toBe('classic');
    });
  });

  describe('getClassicAuthAdmin', () => {
    it('should return classic auth admin response with registration status', () => {
      systemService.isRegistrationEnabled.mockReturnValue(true);

      const result = service.getClassicAuthAdmin();

      expect(result.type).toBe('classic');
      expect(result.id).toBe('classic');
      expect(result.providerKey).toBe('classic');
      expect(result.displayName).toBe('Email & Password');
      expect(result.enabled).toBe(true);
      expect(result.registrationEnabled).toBe(true);
    });
  });
});
