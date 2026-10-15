import { AuthController } from './auth.controller';
import { AuthThrottleService } from '../throttle/auth-throttle.service';
import { RateLimiterService } from '../../rate-limiter';
import { LoginLockedException } from '../throttle/login-lockout.service';
import { ErrorCode } from '../../exceptions/constants/error-codes';

describe('AuthController throttling', () => {
  const rule = (limit: number, windowMs = 60_000) => ({ limit, windowMs });
  const config = {
    rateLimits: {
      ip: {
        register: rule(2),
        login: rule(2),
        refresh: rule(2),
        verifyEmail: rule(2),
        resendVerification: rule(2),
        forgotPassword: rule(2),
        resetPassword: rule(2),
        oauthStart: rule(2),
        oauthCallback: rule(2),
        inviteLookup: rule(2),
      },
      account: { login: rule(100), forgotPassword: rule(1), resendVerification: rule(2) },
    },
  } as never;

  let limiter: RateLimiterService;
  let authService: Record<string, jest.Mock>;
  let sessionService: Record<string, jest.Mock>;
  let userInvitations: Record<string, jest.Mock>;
  let controller: AuthController;

  const req = (ip = '203.0.113.9') =>
    ({ ip, headers: { 'user-agent': 'jest' }, socket: { remoteAddress: ip }, cookies: {} }) as never;
  const res = () => ({ setHeader: jest.fn(), cookie: jest.fn() }) as never;

  beforeEach(() => {
    limiter = new RateLimiterService({
      getSettings: jest.fn().mockResolvedValue({ throttle: { limit: 100, windowSeconds: 60 } }),
    } as never);
    authService = {
      login: jest.fn().mockResolvedValue({ loginResponse: { accessToken: 'a' }, refreshToken: 'r' }),
      forgotPassword: jest.fn().mockResolvedValue(undefined),
    };
    sessionService = {
      refreshTokens: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 1 }),
      getRefreshTokenExpiryMs: jest.fn().mockReturnValue(1000),
    };
    userInvitations = {
      resolve: jest.fn().mockResolvedValue({ email: 'jane@acme.io', expiresAt: new Date() }),
    };
    controller = new AuthController(
      authService as never,
      sessionService as never,
      {} as never, // registrationService
      {} as never, // userService
      userInvitations as never,
      { get: jest.fn((_k: string, def: unknown) => def) } as never,
      new AuthThrottleService(limiter, config),
    );
  });

  afterEach(() => { limiter.onModuleDestroy(); });

  const dto = { email: 'jane@acme.io', password: 'irrelevant' };

  it('rejects the login request over the per-IP limit with 429 before reaching the service', async () => {
    await controller.login(dto, req(), res());
    await controller.login(dto, req(), res());

    await expect(controller.login(dto, req(), res())).rejects.toMatchObject({
      code: ErrorCode.TOO_MANY_REQUESTS,
    });
    expect(authService.login).toHaveBeenCalledTimes(2);
  });

  it('sets Retry-After when the service answers with a login lock', async () => {
    authService.login.mockRejectedValue(new LoginLockedException(42));
    const response = res();

    await expect(controller.login(dto, req(), response)).rejects.toMatchObject({
      code: ErrorCode.TOO_MANY_REQUESTS,
    });
    expect((response as unknown as { setHeader: jest.Mock }).setHeader).toHaveBeenCalledWith('Retry-After', '42');
  });

  it('throttles forgot-password per email even from different IPs', async () => {
    await controller.forgotPassword({ email: 'jane@acme.io' }, req('198.51.100.1'), res());

    await expect(
      controller.forgotPassword({ email: 'Jane@Acme.io' }, req('198.51.100.2'), res()),
    ).rejects.toMatchObject({ code: ErrorCode.TOO_MANY_REQUESTS });
    expect(authService.forgotPassword).toHaveBeenCalledTimes(1);
  });

  it('throttles refresh per IP', async () => {
    const withCookie = () => ({ ...(req() as object), cookies: { refresh_token: 'rt' } }) as never;
    await controller.refresh(withCookie(), res());
    await controller.refresh(withCookie(), res());

    await expect(controller.refresh(withCookie(), res())).rejects.toMatchObject({
      code: ErrorCode.TOO_MANY_REQUESTS,
    });
    expect(sessionService.refreshTokens).toHaveBeenCalledTimes(2);
  });

  it('throttles the public invite lookup per IP', async () => {
    await controller.getInvitation('token-a', req(), res());
    await controller.getInvitation('token-b', req(), res());

    await expect(controller.getInvitation('token-c', req(), res())).rejects.toMatchObject({
      code: ErrorCode.TOO_MANY_REQUESTS,
    });
    expect(userInvitations.resolve).toHaveBeenCalledTimes(2);
  });
});
