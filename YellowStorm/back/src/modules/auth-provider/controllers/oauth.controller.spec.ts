import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { OAuthController, OAUTH_EXCHANGE_COOKIE_NAME } from './oauth.controller';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { OAUTH_EXCHANGE_TTL_MS } from '../services/oauth-flow.service';

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
    return { controller, oauthFlowService };
  };

  const makeRes = () => ({ redirect: jest.fn(), cookie: jest.fn(), clearCookie: jest.fn() });
  const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } } as unknown as Request;

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
