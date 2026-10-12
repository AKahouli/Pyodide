import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  OAuthController,
  OAUTH_EXCHANGE_COOKIE_NAME,
  OAUTH_STATE_BINDING_COOKIE_NAME,
} from './oauth.controller';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { OAUTH_EXCHANGE_TTL_MS, OAUTH_STATE_TTL_MS } from '../services/oauth-flow.service';

const FRONTEND_URL = 'https://app.example.test';
const EXCHANGE_PATH = '/api/v1/auth/providers/exchange';
const EXCHANGE_CODE = 'one-time-exchange-code';

describe('OAuthController login exchange', () => {
  const makeController = (overrides: Record<string, unknown> = {}) => {
    const values: Record<string, unknown> = {
      'app.frontendUrl': FRONTEND_URL,
      'app.apiPrefix': 'api',
      'auth.refreshTokenCookieName': 'refresh_token',
      'auth.cookieSecure': true,
      'auth.cookieSameSite': 'strict',
      ...overrides,
    };
    const configService = { get: jest.fn((key: string, def: unknown) => values[key] ?? def) };
    const oauthFlowService = {
      buildAuthorizationUrl: jest.fn(),
      handleCallback: jest.fn(),
      exchangeTempToken: jest.fn(),
    };
    const logger = { setContext: jest.fn(), error: jest.fn(), warn: jest.fn(), log: jest.fn() };
    const throttle = { enforceIp: jest.fn().mockResolvedValue(undefined) };
    const controller = new OAuthController(
      {} as never,
      oauthFlowService as never,
      configService as unknown as ConfigService,
      logger as never,
      throttle as never,
    );
    return { controller, oauthFlowService, throttle };
  };

  const makeRes = () => ({ redirect: jest.fn(), cookie: jest.fn(), clearCookie: jest.fn() });
  const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } } as unknown as Request;

  describe('state binding cookie', () => {
    const NONCE = 'browser-binding-nonce';
    const BINDING_PATH = '/api/v1/auth/providers/microsoft/callback';

    it('authorize sets a scoped HttpOnly Lax cookie with the state TTL, then redirects to the provider', async () => {
      const { controller, oauthFlowService } = makeController();
      oauthFlowService.buildAuthorizationUrl.mockResolvedValue({
        url: 'https://login.example.test/authorize?state=s',
        bindingNonce: NONCE,
        providerKey: 'microsoft',
      });
      const res = makeRes();

      await controller.authorize('microsoft', req, res as unknown as Response);

      expect(res.cookie).toHaveBeenCalledWith(
        OAUTH_STATE_BINDING_COOKIE_NAME,
        NONCE,
        { httpOnly: true, secure: true, sameSite: 'lax', path: BINDING_PATH, maxAge: OAUTH_STATE_TTL_MS },
      );
      expect(res.redirect).toHaveBeenCalledWith('https://login.example.test/authorize?state=s');
    });

    it('authorize sets no cookie when the flow cannot start', async () => {
      const { controller, oauthFlowService } = makeController();
      oauthFlowService.buildAuthorizationUrl.mockRejectedValue(new Error('boom'));
      const res = makeRes();

      await controller.authorize('microsoft', req, res as unknown as Response);

      expect(res.cookie).not.toHaveBeenCalled();
      expect((res.redirect.mock.calls[0] as string[])[0]).toContain('error=oauth_failed');
    });

    it('callback hands the cookie nonce to the flow service and clears the cookie', async () => {
      const { controller, oauthFlowService } = makeController();
      oauthFlowService.handleCallback.mockResolvedValue({ type: 'login', exchangeCode: EXCHANGE_CODE });
      const res = makeRes();
      const request = { ...req, cookies: { [OAUTH_STATE_BINDING_COOKIE_NAME]: NONCE } } as unknown as Request;

      await controller.callback('microsoft', 'code', 'state', '', request, res as unknown as Response);

      expect(oauthFlowService.handleCallback).toHaveBeenCalledWith(
        'microsoft', 'code', 'state', NONCE, expect.any(String), 'jest',
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        OAUTH_STATE_BINDING_COOKIE_NAME,
        { httpOnly: true, secure: true, sameSite: 'lax', path: BINDING_PATH },
      );
    });

    it('callback passes undefined when the cookie is missing, redirects with the state error and clears the cookie', async () => {
      const { controller, oauthFlowService } = makeController();
      oauthFlowService.handleCallback.mockRejectedValue(
        Object.assign(new Error('mismatch'), { code: ErrorCode.AUTH_OAUTH_STATE_INVALID }),
      );
      const res = makeRes();

      await controller.callback('microsoft', 'code', 'state', '', req, res as unknown as Response);

      expect(oauthFlowService.handleCallback).toHaveBeenCalledWith(
        'microsoft', 'code', 'state', undefined, expect.any(String), 'jest',
      );
      expect(res.cookie).not.toHaveBeenCalled();
      expect((res.redirect.mock.calls[0] as string[])[0]).toBe(
        `${FRONTEND_URL}/#/oauth-callback?error=${ErrorCode.AUTH_OAUTH_STATE_INVALID}`,
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        OAUTH_STATE_BINDING_COOKIE_NAME,
        expect.objectContaining({ path: BINDING_PATH }),
      );
    });

    it.each([
      ['provider error', 'code', 'state', 'access_denied'],
      ['missing params', '', '', ''],
    ])('callback clears the cookie on %s', async (_label, code, state, error) => {
      const { controller, oauthFlowService } = makeController();
      const res = makeRes();

      await controller.callback('microsoft', code, state, error, req, res as unknown as Response);

      expect(oauthFlowService.handleCallback).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledWith(
        OAUTH_STATE_BINDING_COOKIE_NAME,
        expect.objectContaining({ path: BINDING_PATH }),
      );
    });

    it('callback clears the cookie when throttled', async () => {
      const { controller, throttle } = makeController();
      throttle.enforceIp.mockRejectedValue({ code: ErrorCode.TOO_MANY_REQUESTS });
      const res = makeRes();

      await controller.callback('microsoft', 'code', 'state', '', req, res as unknown as Response);

      expect(res.clearCookie).toHaveBeenCalledWith(
        OAUTH_STATE_BINDING_COOKIE_NAME,
        expect.objectContaining({ path: BINDING_PATH }),
      );
    });

    it('scopes the cookie to the stored (lowercased) provider key, matching the redirect URI, for a mixed-case route key', async () => {
      const { controller, oauthFlowService } = makeController();
      oauthFlowService.buildAuthorizationUrl.mockResolvedValue({ url: 'https://x.test', bindingNonce: NONCE, providerKey: 'microsoft' });
      const res = makeRes();

      await controller.authorize('Microsoft', req, res as unknown as Response);

      expect(res.cookie).toHaveBeenCalledWith(
        OAUTH_STATE_BINDING_COOKIE_NAME,
        NONCE,
        expect.objectContaining({ path: BINDING_PATH }),
      );
    });

    it('derives cookie paths from the configured API prefix', async () => {
      const { controller, oauthFlowService } = makeController({ 'app.apiPrefix': 'gateway' });
      oauthFlowService.buildAuthorizationUrl.mockResolvedValue({ url: 'https://x.test', bindingNonce: NONCE, providerKey: 'microsoft' });
      const res = makeRes();

      await controller.authorize('microsoft', req, res as unknown as Response);

      expect(res.cookie).toHaveBeenCalledWith(
        OAUTH_STATE_BINDING_COOKIE_NAME,
        NONCE,
        expect.objectContaining({ path: '/gateway/v1/auth/providers/microsoft/callback' }),
      );
    });
  });

  describe('callback', () => {
    it('stores the exchange code in a scoped HttpOnly Lax cookie and redirects without any token', async () => {
      const { controller, oauthFlowService } = makeController();
      oauthFlowService.handleCallback.mockResolvedValue({ type: 'login', exchangeCode: EXCHANGE_CODE });
      const res = makeRes();

      await controller.callback('microsoft', 'code', 'state', '', req, res as unknown as Response);

      expect(res.cookie).toHaveBeenCalledWith(
        OAUTH_EXCHANGE_COOKIE_NAME,
        EXCHANGE_CODE,
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: EXCHANGE_PATH,
          maxAge: OAUTH_EXCHANGE_TTL_MS,
        }),
      );
      expect(res.redirect).toHaveBeenCalledTimes(1);
      const target = (res.redirect.mock.calls[0] as string[])[0];
      expect(target).toBe(`${FRONTEND_URL}/#/oauth-callback?login=success`);
      expect(target).not.toContain(EXCHANGE_CODE);
      expect(target).not.toMatch(/token=/);
    });

    it('keeps a non-strict configured SameSite value for the exchange cookie', async () => {
      const { controller, oauthFlowService } = makeController({ 'auth.cookieSameSite': 'none' });
      oauthFlowService.handleCallback.mockResolvedValue({ type: 'login', exchangeCode: EXCHANGE_CODE });
      const res = makeRes();

      await controller.callback('microsoft', 'code', 'state', '', req, res as unknown as Response);

      expect(res.cookie).toHaveBeenCalledWith(
        OAUTH_EXCHANGE_COOKIE_NAME,
        EXCHANGE_CODE,
        expect.objectContaining({ sameSite: 'none' }),
      );
    });

    it('sets no cookie when the account must be linked', async () => {
      const { controller, oauthFlowService } = makeController();
      oauthFlowService.handleCallback.mockResolvedValue({ type: 'link_required', maskedEmail: 'j***@example.com' });
      const res = makeRes();

      await controller.callback('microsoft', 'code', 'state', '', req, res as unknown as Response);

      expect(res.cookie).not.toHaveBeenCalled();
      expect((res.redirect.mock.calls[0] as string[])[0]).toContain('link_required=true');
    });
  });

  describe('exchange', () => {
    const exchangeResult = {
      accessToken: 'jwt',
      expiresIn: 900,
      refreshToken: 'refresh-secret',
      user: { id: 'u1' },
    };

    it('consumes the cookie code once, clears it and sets the Strict refresh cookie', async () => {
      const { controller, oauthFlowService } = makeController();
      oauthFlowService.exchangeTempToken.mockResolvedValue(exchangeResult);
      const res = makeRes();
      const request = { ...req, cookies: { [OAUTH_EXCHANGE_COOKIE_NAME]: EXCHANGE_CODE } } as unknown as Request;

      const body = await controller.exchange(request, res as unknown as Response);

      expect(oauthFlowService.exchangeTempToken).toHaveBeenCalledWith(EXCHANGE_CODE, expect.any(String), 'jest');
      expect(res.clearCookie).toHaveBeenCalledWith(
        OAUTH_EXCHANGE_COOKIE_NAME,
        expect.objectContaining({ httpOnly: true, path: EXCHANGE_PATH }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-secret',
        expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/api/v1/auth' }),
      );
      expect(body).toEqual({ accessToken: 'jwt', expiresIn: 900, user: { id: 'u1' } });
    });

    it('scopes the refresh cookie to the configured API prefix', async () => {
      const { controller, oauthFlowService } = makeController({ 'app.apiPrefix': 'gateway' });
      oauthFlowService.exchangeTempToken.mockResolvedValue(exchangeResult);
      const res = makeRes();
      const request = { ...req, cookies: { [OAUTH_EXCHANGE_COOKIE_NAME]: EXCHANGE_CODE } } as unknown as Request;

      await controller.exchange(request, res as unknown as Response);

      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-secret',
        expect.objectContaining({ path: '/gateway/v1/auth' }),
      );
    });

    it('rejects a request without the exchange cookie', async () => {
      const { controller, oauthFlowService } = makeController();
      const res = makeRes();
      const request = { ...req, cookies: {} } as unknown as Request;

      await expect(controller.exchange(request, res as unknown as Response)).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_LINK_TOKEN_INVALID,
      });
      expect(oauthFlowService.exchangeTempToken).not.toHaveBeenCalled();
    });

    it('does not accept the code from the request body', async () => {
      const { controller, oauthFlowService } = makeController();
      const res = makeRes();
      const request = { ...req, cookies: {}, body: { token: EXCHANGE_CODE } } as unknown as Request;

      await expect(controller.exchange(request, res as unknown as Response)).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_LINK_TOKEN_INVALID,
      });
      expect(oauthFlowService.exchangeTempToken).not.toHaveBeenCalled();
    });
  });
});
