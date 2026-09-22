import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AuthProviderService } from './auth-provider.service';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { SystemService } from '@modules/system/system.service';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { AUTH_PROVIDER_STORE, USER_PROVIDER_LINK_STORE } from '../persistence/auth-provider.stores';
import {
  linkRecord,
  makeProviderStoreFake,
  makeUserProviderLinkStoreFake,
  providerRecord,
  type AuthProviderStoreFake,
  type UserProviderLinkStoreFake,
} from '../persistence/auth-provider-stores.fake';

describe('AuthProviderService', () => {
  let service: AuthProviderService;
  let providerStore: AuthProviderStoreFake;
  let linkStore: UserProviderLinkStoreFake;
  let cryptoService: { encrypt: jest.Mock; decrypt: jest.Mock; isEncrypted: jest.Mock };
  let systemService: {
    isRegistrationEnabled: jest.Mock;
    setRegistrationEnabled: jest.Mock;
    isClassicAuthEnabled: jest.Mock;
    setClassicAuthEnabled: jest.Mock;
  };

  const mockId = new Types.ObjectId().toHexString();

  const seedProvider = (overrides = {}) => {
    const record = providerRecord({ id: mockId, ...overrides });
    providerStore.records.push(record);
    return record;
  };

  const mockLoggerService = {
    setContext: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    providerStore = makeProviderStoreFake();
    linkStore = makeUserProviderLinkStoreFake();

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
        { provide: AUTH_PROVIDER_STORE, useValue: providerStore },
        { provide: USER_PROVIDER_LINK_STORE, useValue: linkStore },
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
      seedProvider({ tenantId: 'encrypted:real-tenant-id' });
      linkStore.records.push(linkRecord({ providerKey: 'microsoft' }), linkRecord({ providerKey: 'microsoft' }), linkRecord({ providerKey: 'microsoft' }));

      const result = await service.findAll();

      // Classic provider is prepended
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('classic');
      expect(result[0].id).toBe('classic');
      expect(result[0].providerKey).toBe('classic');
      expect(result[0].registrationEnabled).toBe(true);

      // OAuth provider follows, secrets masked
      expect(result[1].type).toBe('oauth');
      expect(result[1].clientId).toBe('****');
      expect(result[1].clientSecret).toBe('****');
      expect(result[1].tenantId).toBe('****');
      expect(result[1].linkedUserCount).toBe(3);
      expect(result[1].providerKey).toBe('microsoft');
    });

    it('should return only classic provider when no OAuth providers exist', async () => {
      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('classic');
      expect(result[0].providerKey).toBe('classic');
    });
  });

  describe('findEnabled', () => {
    it('should return enabled OAuth providers plus classic provider', async () => {
      seedProvider();

      const result = await service.findEnabled();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        type: 'oauth',
        providerKey: 'microsoft',
        displayName: 'Microsoft',
        iconKey: 'microsoft',
        sortOrder: 0,
      });
      expect(result[1]).toEqual({
        type: 'classic',
        providerKey: 'classic',
        displayName: 'Email & Password',
        iconKey: 'email',
        sortOrder: 999,
        registrationEnabled: true,
      });
    });

    it('should reflect registration disabled in classic provider', async () => {
      systemService.isRegistrationEnabled.mockReturnValue(false);

      const result = await service.findEnabled();

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('classic');
      expect(result[0].registrationEnabled).toBe(false);
    });

    it('should exclude classic provider when classic auth is disabled', async () => {
      seedProvider();
      systemService.isClassicAuthEnabled.mockReturnValue(false);

      const result = await service.findEnabled();

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('oauth');
      expect(result[0].providerKey).toBe('microsoft');
    });
  });

  describe('findByKey', () => {
    it('should return decrypted provider config', async () => {
      seedProvider({
        clientId: 'encrypted:real-client-id',
        clientSecret: 'encrypted:real-client-secret',
        tenantId: 'encrypted:real-tenant-id',
      });

      const result = await service.findByKey('microsoft');

      expect(result.clientId).toBe('real-client-id');
      expect(result.clientSecret).toBe('real-client-secret');
      expect(result.tenantId).toBe('real-tenant-id');
      expect(cryptoService.decrypt).toHaveBeenCalledTimes(3);
    });

    it('should throw when provider not found', async () => {
      await expect(service.findByKey('unknown')).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_PROVIDER_NOT_FOUND,
      });
    });

    it('should throw when provider is disabled', async () => {
      seedProvider({ enabled: false });

      await expect(service.findByKey('microsoft')).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_PROVIDER_DISABLED,
      });
    });
  });

  describe('findById', () => {
    it('should return masked provider with linked user count', async () => {
      seedProvider();
      linkStore.records.push(
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
      );

      const result = await service.findById(mockId);

      expect(result.clientId).toBe('****');
      expect(result.linkedUserCount).toBe(5);
    });

    it('should throw when not found', async () => {
      await expect(service.findById(mockId)).rejects.toMatchObject({
        code: ErrorCode.AUTH_PROVIDER_NOT_FOUND,
      });
    });
  });

  describe('create', () => {
    it('should encrypt secrets and create provider', async () => {
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
      expect(providerStore.records).toHaveLength(1);
      expect(result.clientId).toBe('****');
    });

    it('should reject duplicate provider key', async () => {
      seedProvider();

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
      seedProvider();
      linkStore.records.push(linkRecord({ providerKey: 'microsoft' }));

      const result = await service.delete(mockId);

      expect(providerStore.records).toHaveLength(0);
      expect(linkStore.records).toHaveLength(1); // links preserved
      expect(result.unlinkedUsers).toBe(0);
    });

    it('should delete provider and links when deleteLinks is true', async () => {
      seedProvider();
      linkStore.records.push(
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
      );

      const result = await service.delete(mockId, true);

      expect(providerStore.records).toHaveLength(0);
      expect(linkStore.records).toHaveLength(0);
      expect(result.unlinkedUsers).toBe(5);
    });

    it('should throw when provider not found', async () => {
      await expect(service.delete(mockId)).rejects.toMatchObject({
        code: ErrorCode.AUTH_PROVIDER_NOT_FOUND,
      });
    });
  });

  describe('getLinkedUserCount', () => {
    it('should return the count of linked users', async () => {
      linkStore.records.push(
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
        linkRecord({ providerKey: 'microsoft' }),
      );

      const count = await service.getLinkedUserCount('microsoft');

      expect(count).toBe(7);
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
