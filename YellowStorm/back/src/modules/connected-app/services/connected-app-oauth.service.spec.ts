import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { ConnectedAppOAuthService } from './connected-app-oauth.service';
import { ConnectedAppDefinitionService } from './connected-app-definition.service';
import { ConnectedAppOAuthState } from '../schemas/connected-app-oauth-state.schema';
import { UserAppConnection } from '../schemas/user-app-connection.schema';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

const userId = new Types.ObjectId().toString();

const mockAppConfig = {
  appKey: 'google-drive',
  displayName: 'Google Drive',
  clientId: 'my_client_id',
  clientSecret: 'my_client_secret',
  tenantId: undefined,
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  scopes: ['drive.readonly'],
  pkceEnabled: false,
  enabled: true,
};

const mockAppConfigPkce = {
  ...mockAppConfig,
  pkceEnabled: true,
};

const mockAppConfigTenant = {
  ...mockAppConfig,
  appKey: 'microsoft',
  tenantId: 'my-tenant-id',
  authorizationUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
};

describe('ConnectedAppOAuthService', () => {
  let service: ConnectedAppOAuthService;
  let oauthStateModel: Record<string, jest.Mock>;
  let connectionModel: Record<string, jest.Mock>;
  let definitionService: Record<string, jest.Mock>;
  let cryptoService: Record<string, jest.Mock>;

  beforeEach(async () => {
    oauthStateModel = {
      create: jest.fn(),
      findOneAndDelete: jest.fn(),
    };

    connectionModel = {
      findOneAndUpdate: jest.fn(),
    };

    definitionService = {
      findByKey: jest.fn(),
    };

    cryptoService = {
      encrypt: jest.fn((val: string) => `encrypted_${val}`),
      decrypt: jest.fn((val: string) => `decrypted_${val}`),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectedAppOAuthService,
        {
          provide: getModelToken(ConnectedAppOAuthState.name),
          useValue: oauthStateModel,
        },
        {
          provide: getModelToken(UserAppConnection.name),
          useValue: connectionModel,
        },
        {
          provide: ConnectedAppDefinitionService,
          useValue: definitionService,
        },
        {
          provide: CryptoService,
          useValue: cryptoService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal: string) => {
              const map: Record<string, string> = {
                'app.frontendUrl': 'http://localhost:5173',
                'app.backendUrl': 'http://localhost:3000',
                'app.apiPrefix': 'api',
              };
              return map[key] || defaultVal;
            }),
          },
        },
        {
          provide: LoggerService,
          useValue: { setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ConnectedAppOAuthService>(ConnectedAppOAuthService);
    jest.clearAllMocks();
  });

  describe('buildAuthorizationUrl', () => {
    it('should generate state, save to DB, and return URL with correct params', async () => {
      definitionService.findByKey.mockResolvedValue(mockAppConfig);
      oauthStateModel.create.mockResolvedValue({});

      const url = await service.buildAuthorizationUrl(userId, 'google-drive');

      expect(definitionService.findByKey).toHaveBeenCalledWith('google-drive');
      expect(oauthStateModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          appKey: 'google-drive',
          userId: expect.any(Types.ObjectId),
          state: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
      expect(url).toContain('client_id=my_client_id');
      expect(url).toContain('response_type=code');
      expect(url).toContain('scope=drive.readonly');
      expect(url).toContain('state=');
      expect(url).toContain('redirect_uri=');
      // No PKCE params when disabled
      expect(url).not.toContain('code_challenge');
    });

    it('should add PKCE params when enabled', async () => {
      definitionService.findByKey.mockResolvedValue(mockAppConfigPkce);
      oauthStateModel.create.mockResolvedValue({});

      const url = await service.buildAuthorizationUrl(userId, 'google-drive');

      expect(url).toContain('code_challenge=');
      expect(url).toContain('code_challenge_method=S256');
      // codeVerifier should be saved in state
      expect(oauthStateModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          codeVerifier: expect.any(String),
        }),
      );
    });

    it('should replace {tenant} in URL when tenantId present', async () => {
      definitionService.findByKey.mockResolvedValue(mockAppConfigTenant);
      oauthStateModel.create.mockResolvedValue({});

      const url = await service.buildAuthorizationUrl(userId, 'microsoft');

      expect(url).toContain('login.microsoftonline.com/my-tenant-id/');
      expect(url).not.toContain('{tenant}');
    });
  });

  describe('handleCallback', () => {
    const validState = {
      state: 'valid-state',
      appKey: 'google-drive',
      userId: new Types.ObjectId(userId),
      codeVerifier: undefined,
      expiresAt: new Date(Date.now() + 60000), // not expired
    };

    it('should validate state, exchange code, encrypt tokens, and upsert connection', async () => {
      oauthStateModel.findOneAndDelete.mockResolvedValue(validState);
      definitionService.findByKey.mockResolvedValue(mockAppConfig);
      connectionModel.findOneAndUpdate.mockResolvedValue({});

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'new_access',
          refresh_token: 'new_refresh',
          expires_in: 3600,
        }),
      });

      const result = await service.handleCallback('google-drive', 'auth_code', 'valid-state');

      expect(oauthStateModel.findOneAndDelete).toHaveBeenCalledWith({ state: 'valid-state' });
      expect(cryptoService.encrypt).toHaveBeenCalledWith('new_access');
      expect(cryptoService.encrypt).toHaveBeenCalledWith('new_refresh');
      expect(connectionModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: validState.userId, appKey: 'google-drive' },
        expect.objectContaining({
          $set: expect.objectContaining({
            accessToken: 'encrypted_new_access',
            refreshToken: 'encrypted_new_refresh',
            status: 'active',
          }),
        }),
        { upsert: true, new: true },
      );
      expect(result).toEqual({ success: true, appKey: 'google-drive' });
    });

    it('should throw on invalid state (not found)', async () => {
      oauthStateModel.findOneAndDelete.mockResolvedValue(null);

      await expect(
        service.handleCallback('google-drive', 'code', 'invalid-state'),
      ).rejects.toThrow();

      try {
        oauthStateModel.findOneAndDelete.mockResolvedValue(null);
        await service.handleCallback('google-drive', 'code', 'invalid-state');
      } catch (error) {
        expect((error as any).code).toBe(ErrorCode.CONNECTED_APP_OAUTH_STATE_INVALID);
      }
    });

    it('should throw on expired state', async () => {
      const expiredState = {
        ...validState,
        expiresAt: new Date(Date.now() - 60000), // expired
      };
      oauthStateModel.findOneAndDelete.mockResolvedValue(expiredState);

      await expect(
        service.handleCallback('google-drive', 'code', 'valid-state'),
      ).rejects.toThrow();
    });

    it('should throw on app key mismatch', async () => {
      const mismatchState = { ...validState, appKey: 'different-app' };
      oauthStateModel.findOneAndDelete.mockResolvedValue(mismatchState);

      await expect(
        service.handleCallback('google-drive', 'code', 'valid-state'),
      ).rejects.toThrow();
    });

    it('should throw on provider error in token response (data.error)', async () => {
      oauthStateModel.findOneAndDelete.mockResolvedValue(validState);
      definitionService.findByKey.mockResolvedValue(mockAppConfig);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          error: 'invalid_grant',
          error_description: 'The code has expired',
        }),
      });

      await expect(
        service.handleCallback('google-drive', 'expired_code', 'valid-state'),
      ).rejects.toThrow();

      try {
        oauthStateModel.findOneAndDelete.mockResolvedValue({ ...validState });
        await service.handleCallback('google-drive', 'expired_code', 'valid-state');
      } catch (error) {
        expect((error as any).code).toBe(ErrorCode.CONNECTED_APP_OAUTH_FAILED);
      }
    });

    it('should throw when token exchange HTTP request fails', async () => {
      oauthStateModel.findOneAndDelete.mockResolvedValue(validState);
      definitionService.findByKey.mockResolvedValue(mockAppConfig);

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue('Bad Request'),
      });

      await expect(
        service.handleCallback('google-drive', 'bad_code', 'valid-state'),
      ).rejects.toThrow();
    });

    it('should throw when no access_token in response', async () => {
      oauthStateModel.findOneAndDelete.mockResolvedValue(validState);
      definitionService.findByKey.mockResolvedValue(mockAppConfig);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          token_type: 'Bearer',
          // no access_token
        }),
      });

      await expect(
        service.handleCallback('google-drive', 'code', 'valid-state'),
      ).rejects.toThrow();
    });
  });

  describe('buildCallbackHtml', () => {
    it('should return HTML with success message', () => {
      const html = service.buildCallbackHtml('google-drive', true);

      expect(html).toContain('Connected successfully');
      expect(html).toContain('"success":true');
      expect(html).toContain('"appKey":"google-drive"');
      expect(html).toContain('window.opener.postMessage');
      expect(html).toContain('window.close()');
    });

    it('should return HTML with error message', () => {
      const html = service.buildCallbackHtml('google-drive', false, 'access_denied');

      expect(html).toContain('Connection failed');
      expect(html).toContain('access_denied');
      expect(html).toContain('"success":false');
      expect(html).not.toContain('window.close()');
    });
  });
});
