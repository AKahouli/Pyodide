import type { ConfigService } from '@nestjs/config';
import { AuthController } from './controllers/auth.controller';
import { getAuthCookiePath } from './auth-cookie-path';

const configWith = (values: Record<string, unknown>) =>
  ({ get: jest.fn((key: string, def?: unknown) => values[key] ?? def) }) as unknown as ConfigService;

describe('getAuthCookiePath', () => {
  it('keeps /api/v1/auth with the default configuration', () => {
    expect(getAuthCookiePath(configWith({}))).toBe('/api/v1/auth');
    expect(getAuthCookiePath(configWith({ 'app.apiPrefix': 'api' }))).toBe('/api/v1/auth');
  });

  it('follows the configured global prefix', () => {
    expect(getAuthCookiePath(configWith({ 'app.apiPrefix': 'gateway' }))).toBe('/gateway/v1/auth');
  });
});

describe('AuthController refresh cookie path', () => {
  const makeController = (values: Record<string, unknown>) => {
    const authService = {
      login: jest.fn().mockResolvedValue({ loginResponse: { accessToken: 'a' }, refreshToken: 'r' }),
    };
    const sessionService = {
      logout: jest.fn().mockResolvedValue(undefined),
      getRefreshTokenExpiryMs: jest.fn().mockReturnValue(1000),
    };
    const throttle = { enforceIp: jest.fn().mockResolvedValue(undefined) };
    return new AuthController(
      authService as never,
      sessionService as never,
      {} as never, // registrationService
      {} as never, // userService
      {} as never, // userInvitations
      configWith(values),
      throttle as never,
    );
  };
  const req = { ip: '127.0.0.1', headers: {}, socket: { remoteAddress: '127.0.0.1' }, cookies: {} } as never;
  const res = () => ({ cookie: jest.fn(), clearCookie: jest.fn(), setHeader: jest.fn() });

  it.each([
    [{}, '/api/v1/auth'],
    [{ 'app.apiPrefix': 'gateway' }, '/gateway/v1/auth'],
  ])('sets and clears the refresh cookie on the same path (%j)', async (values, expectedPath) => {
    const controller = makeController(values);
    const response = res();

    await controller.login({ email: 'a@b.test', password: 'x' } as never, req, response as never);
    await controller.logout(req, response as never);

    expect(response.cookie).toHaveBeenCalledWith('refresh_token', 'r', expect.objectContaining({ path: expectedPath }));
    expect(response.clearCookie).toHaveBeenCalledWith('refresh_token', expect.objectContaining({ path: expectedPath }));
  });
});
