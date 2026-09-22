import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { OAuthFlowService } from './oauth-flow.service';
import { AuthProviderService } from './auth-provider.service';
import { OAUTH_STATE_STORE, PROVIDER_LINK_TOKEN_STORE } from '../persistence/auth-provider.stores';
import { ProviderLinkService } from './provider-link.service';
import { AuthService } from '@modules/auth/auth.service';
import { UserService } from '@modules/user/user.service';
import { UsageService } from '@modules/usage';
import { AuthorizationService } from '@modules/authorization/authorization.service';
import { EmailService, EmailTemplateRenderer } from '@modules/email';
import { LoggerService } from '@modules/logger';
import { WorkspaceInitializerService } from '@modules/workspace/workspace-initializer.service';
import { UserStatus } from '@modules/user/user.types';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('OAuthFlowService', () => {
  let service: OAuthFlowService;
  let oauthStateModel: Record<string, jest.Mock>;
  let providerLinkTokenModel: Record<string, jest.Mock>;
  let authProviderService: Record<string, jest.Mock>;
  let providerLinkService: Record<string, jest.Mock>;
  let authService: Record<string, jest.Mock>;
  let userService: Record<string, jest.Mock>;
  let usageService: Record<string, jest.Mock>;
  let authorizationService: Record<string, jest.Mock>;
  let emailService: Record<string, jest.Mock>;

  const MOCK_USER_ID = new Types.ObjectId();
  const MOCK_STATE = 'a'.repeat(64);
  const MOCK_CODE = 'auth-code-123';
  const MOCK_PROVIDER_KEY = 'microsoft';

  const mockDecryptedProvider = {
    providerKey: MOCK_PROVIDER_KEY,
    displayName: 'Microsoft',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    tenantId: 'common',
    authorizationUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
    userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scopes: ['openid', 'email', 'profile'],
    pkceEnabled: true,
    enabled: true,
  };

  const mockUser = {
    _id: MOCK_USER_ID,
    email: 'user@example.com',
    emailVerified: true,
    profileComplete: true,
    status: UserStatus.ACTIVE,
    roles: [],
    profile: { firstName: 'John', lastName: 'Doe' },
    consents: { privacyPolicy: true, dataSharing: false },
    planId: null,
    planSlug: null,
    planStartedAt: null,
    permissionsVersion: 1,
  };

  const mockLoggerService = {
    setContext: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const config: Record<string, string> = {
        'app.frontendUrl': 'http://localhost:5173',
        'app.backendUrl': 'http://localhost:3000',
        'app.name': 'YelloStorm',
        'app.apiPrefix': 'api',
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    oauthStateModel = {
      create: jest.fn(),
      findOneAndDelete: jest.fn(),
    };

    providerLinkTokenModel = {
      create: jest.fn(),
      findOneAndDelete: jest.fn(),
    };

    authProviderService = {
      findByKey: jest.fn().mockResolvedValue(mockDecryptedProvider),
    };

    providerLinkService = {
      findByProviderUser: jest.fn(),
      createLink: jest.fn(),
    };

    authService = {
      generateTokens: jest.fn().mockResolvedValue({
        accessToken: 'jwt-token',
        refreshToken: 'session.refresh',
        expiresIn: 900,
      }),
    };

    userService = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      createOAuthUser: jest.fn(),
      updateLastLogin: jest.fn(),
      assignPlan: jest.fn(),
    };

    usageService = {
      getDefaultPlan: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), slug: 'unlimited' }),
    };

    authorizationService = {
      getUserPermissions: jest.fn().mockResolvedValue([]),
      getUserRoleNames: jest.fn().mockResolvedValue([]),
      findRoleByName: jest.fn().mockResolvedValue({ id: new Types.ObjectId().toHexString() }),
      assignRoleToUser: jest.fn(),
    };

    emailService = {
      isAvailable: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue({ success: true }),
    };

    const emailTemplateRenderer = {
      render: jest.fn().mockResolvedValue({ subject: 's', html: '<p>s</p>', text: 's' }),
    };

    const mockWorkspaceInitializerService = {
      initializeWorkspace: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthFlowService,
        { provide: OAUTH_STATE_STORE, useValue: { create: oauthStateModel.create, consumeByState: oauthStateModel.findOneAndDelete } },
        {
          provide: PROVIDER_LINK_TOKEN_STORE,
          useValue: {
            create: providerLinkTokenModel.create,
            consumeByToken: providerLinkTokenModel.findOneAndDelete,
            consumeByTokenAndProviderKey: providerLinkTokenModel.findOneAndDelete,
          },
        },
        { provide: AuthProviderService, useValue: authProviderService },
        { provide: ProviderLinkService, useValue: providerLinkService },
        { provide: AuthService, useValue: authService },
        { provide: UserService, useValue: userService },
        { provide: UsageService, useValue: usageService },
        { provide: AuthorizationService, useValue: authorizationService },
        { provide: EmailService, useValue: emailService },
        { provide: EmailTemplateRenderer, useValue: emailTemplateRenderer },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: WorkspaceInitializerService, useValue: mockWorkspaceInitializerService },
      ],
    }).compile();

    service = module.get<OAuthFlowService>(OAuthFlowService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('buildAuthorizationUrl', () => {
    it('should build authorization URL with state and PKCE', async () => {
      oauthStateModel.create.mockResolvedValue({});

      const url = await service.buildAuthorizationUrl(MOCK_PROVIDER_KEY);

      expect(url).toContain('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      expect(url).toContain('client_id=client-id');
      expect(url).toContain('response_type=code');
      expect(url).toContain('code_challenge=');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain('state=');
      expect(oauthStateModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          providerKey: MOCK_PROVIDER_KEY,
          codeVerifier: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
    });

    it('should build URL without PKCE when disabled', async () => {
      authProviderService.findByKey.mockResolvedValue({
        ...mockDecryptedProvider,
        pkceEnabled: false,
      });
      oauthStateModel.create.mockResolvedValue({});

      const url = await service.buildAuthorizationUrl(MOCK_PROVIDER_KEY);

      expect(url).not.toContain('code_challenge=');
      expect(oauthStateModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ codeVerifier: null }),
      );
    });

    it('should replace {tenant} in authorization URL', async () => {
      oauthStateModel.create.mockResolvedValue({});

      const url = await service.buildAuthorizationUrl(MOCK_PROVIDER_KEY);

      expect(url).toContain('login.microsoftonline.com/common/');
      expect(url).not.toContain('{tenant}');
    });
  });

  describe('handleCallback', () => {
    const setupCallbackMocks = (userInfo: Record<string, string>) => {
      oauthStateModel.findOneAndDelete.mockResolvedValue({
        state: MOCK_STATE,
        providerKey: MOCK_PROVIDER_KEY,
        codeVerifier: 'code-verifier',
        expiresAt: new Date(Date.now() + 600000),
      });

      // Mock token exchange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'provider-access-token' }),
        })
        // Mock userinfo
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(userInfo),
        });
    };

    it('should throw when state is invalid', async () => {
      oauthStateModel.findOneAndDelete.mockResolvedValue(null);

      await expect(
        service.handleCallback(MOCK_PROVIDER_KEY, MOCK_CODE, 'bad-state', '127.0.0.1', 'ua'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_STATE_INVALID,
      });
    });

    it('should throw when state provider mismatches', async () => {
      oauthStateModel.findOneAndDelete.mockResolvedValue({
        state: MOCK_STATE,
        providerKey: 'google', // Different provider
        expiresAt: new Date(Date.now() + 600000),
      });

      await expect(
        service.handleCallback(MOCK_PROVIDER_KEY, MOCK_CODE, MOCK_STATE, '127.0.0.1', 'ua'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_STATE_INVALID,
      });
    });

    it('should throw when state is expired', async () => {
      oauthStateModel.findOneAndDelete.mockResolvedValue({
        state: MOCK_STATE,
        providerKey: MOCK_PROVIDER_KEY,
        expiresAt: new Date(Date.now() - 1000), // Expired
      });

      await expect(
        service.handleCallback(MOCK_PROVIDER_KEY, MOCK_CODE, MOCK_STATE, '127.0.0.1', 'ua'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_STATE_INVALID,
      });
    });

    it('should throw when provider returns no email', async () => {
      setupCallbackMocks({ sub: 'user-123', name: 'John' }); // No email

      await expect(
        service.handleCallback(MOCK_PROVIDER_KEY, MOCK_CODE, MOCK_STATE, '127.0.0.1', 'ua'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_EMAIL_MISSING,
      });
    });

    describe('decision tree — existing link', () => {
      it('should login when provider is already linked', async () => {
        setupCallbackMocks({ sub: 'ms-123', email: 'user@example.com' });
        providerLinkService.findByProviderUser.mockResolvedValue({
          userId: MOCK_USER_ID,
          providerKey: MOCK_PROVIDER_KEY,
          providerUserId: 'ms-123',
        });
        userService.findById.mockResolvedValue(mockUser);
        providerLinkTokenModel.create.mockResolvedValue({});

        const result = await service.handleCallback(
          MOCK_PROVIDER_KEY, MOCK_CODE, MOCK_STATE, '127.0.0.1', 'ua',
        );

        expect(result.type).toBe('login');
        expect(result.accessToken).toBeDefined();
      });

      it('should throw when linked user is suspended', async () => {
        setupCallbackMocks({ sub: 'ms-123', email: 'user@example.com' });
        providerLinkService.findByProviderUser.mockResolvedValue({
          userId: MOCK_USER_ID,
          providerKey: MOCK_PROVIDER_KEY,
          providerUserId: 'ms-123',
        });
        userService.findById.mockResolvedValue({
          ...mockUser,
          status: UserStatus.SUSPENDED,
        });

        await expect(
          service.handleCallback(MOCK_PROVIDER_KEY, MOCK_CODE, MOCK_STATE, '127.0.0.1', 'ua'),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_ACCOUNT_SUSPENDED,
        });
      });

      it('should login when linked user is inactive pending approval', async () => {
        setupCallbackMocks({ sub: 'ms-123', email: 'user@example.com' });
        providerLinkService.findByProviderUser.mockResolvedValue({
          userId: MOCK_USER_ID,
          providerKey: MOCK_PROVIDER_KEY,
          providerUserId: 'ms-123',
        });
        userService.findById.mockResolvedValue({
          ...mockUser,
          status: UserStatus.INACTIVE,
        });
        providerLinkTokenModel.create.mockResolvedValue({});

        const result = await service.handleCallback(
          MOCK_PROVIDER_KEY, MOCK_CODE, MOCK_STATE, '127.0.0.1', 'ua',
        );

        expect(result.type).toBe('login');
        expect(result.accessToken).toBeDefined();
      });
    });

    describe('decision tree — email exists, not linked', () => {
      it('should return link_required and send email', async () => {
        setupCallbackMocks({ sub: 'ms-123', email: 'existing@example.com' });
        providerLinkService.findByProviderUser.mockResolvedValue(null);
        userService.findByEmail.mockResolvedValue({
          ...mockUser,
          email: 'existing@example.com',
        });
        providerLinkTokenModel.create.mockResolvedValue({});

        const result = await service.handleCallback(
          MOCK_PROVIDER_KEY, MOCK_CODE, MOCK_STATE, '127.0.0.1', 'ua',
        );

        expect(result.type).toBe('link_required');
        expect(result.maskedEmail).toBeDefined();
        expect(providerLinkTokenModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            providerKey: MOCK_PROVIDER_KEY,
            providerUserId: 'ms-123',
            providerEmail: 'existing@example.com',
          }),
        );
      });
    });

    describe('decision tree — new user', () => {
      it('should create user, link, and return login', async () => {
        setupCallbackMocks({
          sub: 'ms-new-123',
          email: 'new@example.com',
          given_name: 'Jane',
          family_name: 'Smith',
        });
        providerLinkService.findByProviderUser.mockResolvedValue(null);
        userService.findByEmail.mockResolvedValue(null);
        userService.createOAuthUser.mockResolvedValue({
          ...mockUser,
          _id: new Types.ObjectId(),
          email: 'new@example.com',
        });
        providerLinkService.createLink.mockResolvedValue({});
        providerLinkTokenModel.create.mockResolvedValue({});

        const result = await service.handleCallback(
          MOCK_PROVIDER_KEY, MOCK_CODE, MOCK_STATE, '127.0.0.1', 'ua',
        );

        expect(result.type).toBe('login');
        expect(userService.createOAuthUser).toHaveBeenCalledWith({
          email: 'new@example.com',
          profile: { firstName: 'Jane', lastName: 'Smith' },
        });
        expect(providerLinkService.createLink).toHaveBeenCalled();
        expect(usageService.getDefaultPlan).toHaveBeenCalled();
      });
    });
  });

  describe('exchangeTempToken', () => {
    it('should exchange valid temp token for JWT tokens', async () => {
      providerLinkTokenModel.findOneAndDelete.mockResolvedValue({
        token: 'temp-token',
        userId: MOCK_USER_ID,
        providerKey: '__temp_login__',
        expiresAt: new Date(Date.now() + 300000),
      });
      userService.findById.mockResolvedValue(mockUser);
      userService.updateLastLogin.mockResolvedValue(undefined);

      const result = await service.exchangeTempToken('temp-token', '127.0.0.1', 'ua');

      expect(result.accessToken).toBe('jwt-token');
      expect(result.refreshToken).toBe('session.refresh');
      expect(result.user).toBeDefined();
      expect(authService.generateTokens).toHaveBeenCalled();
      expect(userService.updateLastLogin).toHaveBeenCalled();
    });

    it('should throw when temp token not found', async () => {
      providerLinkTokenModel.findOneAndDelete.mockResolvedValue(null);

      await expect(
        service.exchangeTempToken('invalid', '127.0.0.1', 'ua'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_LINK_TOKEN_INVALID,
      });
    });

    it('should throw when temp token is expired', async () => {
      providerLinkTokenModel.findOneAndDelete.mockResolvedValue({
        token: 'expired-token',
        userId: MOCK_USER_ID,
        providerKey: '__temp_login__',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.exchangeTempToken('expired-token', '127.0.0.1', 'ua'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_LINK_TOKEN_EXPIRED,
      });
    });

    it('should throw when user is suspended', async () => {
      providerLinkTokenModel.findOneAndDelete.mockResolvedValue({
        token: 'temp-token',
        userId: MOCK_USER_ID,
        providerKey: '__temp_login__',
        expiresAt: new Date(Date.now() + 300000),
      });
      userService.findById.mockResolvedValue({
        ...mockUser,
        status: UserStatus.SUSPENDED,
      });

      await expect(
        service.exchangeTempToken('temp-token', '127.0.0.1', 'ua'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_ACCOUNT_SUSPENDED,
      });
    });

    it('should exchange a temp token for an inactive user pending approval', async () => {
      providerLinkTokenModel.findOneAndDelete.mockResolvedValue({
        token: 'temp-token',
        userId: MOCK_USER_ID,
        providerKey: '__temp_login__',
        expiresAt: new Date(Date.now() + 300000),
      });
      userService.findById.mockResolvedValue({
        ...mockUser,
        status: UserStatus.INACTIVE,
      });
      userService.updateLastLogin.mockResolvedValue(undefined);

      const result = await service.exchangeTempToken('temp-token', '127.0.0.1', 'ua');

      expect(result.accessToken).toBe('jwt-token');
      expect(result.user).toBeDefined();
    });
  });

  describe('verifyAndLink', () => {
    it('should verify token and create link', async () => {
      providerLinkTokenModel.findOneAndDelete.mockResolvedValue({
        token: 'link-token',
        userId: MOCK_USER_ID,
        providerKey: MOCK_PROVIDER_KEY,
        providerUserId: 'ms-123',
        providerEmail: 'user@example.com',
        expiresAt: new Date(Date.now() + 86400000),
      });
      providerLinkService.createLink.mockResolvedValue({});

      const result = await service.verifyAndLink('link-token');

      expect(result.userId).toBe(MOCK_USER_ID.toString());
      expect(result.providerKey).toBe(MOCK_PROVIDER_KEY);
      expect(providerLinkService.createLink).toHaveBeenCalledWith(
        MOCK_USER_ID,
        MOCK_PROVIDER_KEY,
        'ms-123',
        'user@example.com',
      );
    });

    it('should throw when token not found', async () => {
      providerLinkTokenModel.findOneAndDelete.mockResolvedValue(null);

      await expect(service.verifyAndLink('invalid')).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_LINK_TOKEN_INVALID,
      });
    });

    it('should throw when token is expired', async () => {
      providerLinkTokenModel.findOneAndDelete.mockResolvedValue({
        token: 'expired',
        userId: MOCK_USER_ID,
        providerKey: MOCK_PROVIDER_KEY,
        providerUserId: 'ms-123',
        providerEmail: 'user@example.com',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.verifyAndLink('expired')).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_LINK_TOKEN_EXPIRED,
      });
    });

    it('should reject temp login tokens', async () => {
      providerLinkTokenModel.findOneAndDelete.mockResolvedValue({
        token: 'temp',
        userId: MOCK_USER_ID,
        providerKey: '__temp_login__',
        providerUserId: '__temp__',
        providerEmail: '__temp__',
        expiresAt: new Date(Date.now() + 300000),
      });

      await expect(service.verifyAndLink('temp')).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_LINK_TOKEN_INVALID,
      });
    });
  });
});
