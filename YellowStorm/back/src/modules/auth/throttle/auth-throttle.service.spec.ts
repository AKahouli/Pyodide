import { RateLimiterService } from '../../rate-limiter';
import { AuthThrottleService } from './auth-throttle.service';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import authConfig from '@config/auth.config';

describe('AuthThrottleService', () => {
  const rule = (limit: number, windowMs = 60_000) => ({ limit, windowMs });
  const makeConfig = () =>
    ({
      rateLimits: {
        ip: {
          register: rule(5),
          login: rule(2),
          refresh: rule(30),
          verifyEmail: rule(5),
          resendVerification: rule(3),
          forgotPassword: rule(5),
          resetPassword: rule(5),
          oauthStart: rule(10),
          oauthCallback: rule(20),
        },
        account: {
          login: rule(3, 900_000),
          forgotPassword: rule(3, 900_000),
          resendVerification: rule(3, 900_000),
        },
      },
    }) as unknown as ConstructorParameters<typeof AuthThrottleService>[1];

  let limiter: RateLimiterService;
  let throttle: AuthThrottleService;

  const req = (ip: string) => ({ ip, headers: {}, socket: { remoteAddress: ip } }) as never;
  const res = () => ({ setHeader: jest.fn() });

  beforeEach(() => {
    limiter = new RateLimiterService({
      getSettings: jest.fn().mockResolvedValue({ throttle: { limit: 100, windowSeconds: 60 } }),
    } as never);
    throttle = new AuthThrottleService(limiter, makeConfig());
  });

  afterEach(() => { limiter.onModuleDestroy(); });

  it('allows requests up to the per-IP limit then answers 429 with Retry-After', async () => {
    const response = res();
    await throttle.enforceIp('login', req('203.0.113.7'), response as never);
    await throttle.enforceIp('login', req('203.0.113.7'), response as never);

    await expect(throttle.enforceIp('login', req('203.0.113.7'), response as never)).rejects.toMatchObject({
      code: ErrorCode.TOO_MANY_REQUESTS,
    });
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^\d+$/));
  });

  it('answers with HTTP 429', async () => {
    await throttle.enforceIp('login', req('203.0.113.7'));
    await throttle.enforceIp('login', req('203.0.113.7'));

    const error = await throttle.enforceIp('login', req('203.0.113.7')).catch((e: unknown) => e);
    expect((error as { getStatus(): number }).getStatus()).toBe(429);
  });

  it('buckets per scope and per IP', async () => {
    await throttle.enforceIp('login', req('203.0.113.7'));
    await throttle.enforceIp('login', req('203.0.113.7'));

    await expect(throttle.enforceIp('login', req('203.0.113.8'))).resolves.toBeUndefined();
    await expect(throttle.enforceIp('register', req('203.0.113.7'))).resolves.toBeUndefined();
  });

  it('ignores spoofed X-Forwarded-For when keying the IP bucket', async () => {
    const peer = (xff: string) =>
      ({
        headers: { 'x-forwarded-for': xff },
        socket: { remoteAddress: '192.0.2.55' },
      }) as never;
    await throttle.enforceIp('login', peer('1.1.1.1'));
    await throttle.enforceIp('login', peer('2.2.2.2'));

    await expect(throttle.enforceIp('login', peer('3.3.3.3'))).rejects.toMatchObject({
      code: ErrorCode.TOO_MANY_REQUESTS,
    });
  });

  it('throttles per account regardless of email casing/whitespace and across IPs', async () => {
    await throttle.enforceAccount('forgotPassword', 'Jane@Acme.io');
    await throttle.enforceAccount('forgotPassword', ' jane@acme.io ');
    await throttle.enforceAccount('forgotPassword', 'JANE@ACME.IO');

    await expect(throttle.enforceAccount('forgotPassword', 'jane@acme.io')).rejects.toMatchObject({
      code: ErrorCode.TOO_MANY_REQUESTS,
    });
    await expect(throttle.enforceAccount('forgotPassword', 'other@acme.io')).resolves.toBeUndefined();
  });

  it('never stores the plaintext email in limiter keys', async () => {
    await throttle.enforceAccount('forgotPassword', 'jane@acme.io');

    const keys = [...(limiter as unknown as { store: Map<string, unknown> }).store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain('jane');
    expect(keys[0]).not.toContain('acme');
  });

  it('ships sensible defaults in auth.config', () => {
    const config = authConfig() as ReturnType<typeof authConfig>;
    expect(config.rateLimits.ip.login).toEqual({ limit: 10, windowMs: 60_000 });
    expect(config.rateLimits.account.login.windowMs).toBe(900_000);
    expect(config.lockout.threshold).toBe(5);
  });
});
