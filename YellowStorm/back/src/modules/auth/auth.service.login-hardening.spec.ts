import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { LoginLockoutService } from './throttle/login-lockout.service';
import { makeSessionStoreFake } from './persistence/session-store.fake';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { UserStatus } from '../user/user.types';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('decoy-hash'),
  compare: jest.fn().mockResolvedValue(false),
}));

describe('AuthService login hardening', () => {
  const EMAIL = 'jane@acme.io';
  const PASSWORD_INPUT = 'whatever-input';

  const buildUser = (overrides: Record<string, unknown> = {}) => ({
    _id: '64b000000000000000000001',
    email: EMAIL,
    emailVerified: true,
    emailVerificationToken: 'verify-token',
    status: UserStatus.ACTIVE,
    roles: [],
    permissionsVersion: 1,
    profile: { firstName: 'Jane', lastName: 'Doe' },
    appearance: { colorTheme: 'default', language: 'en' },
    consents: {},
    ...overrides,
  });

  const build = (user: ReturnType<typeof buildUser> | null, passwordOk: boolean) => {
    const userService = {
      findByEmail: jest.fn().mockResolvedValue(user),
      validatePassword: jest.fn().mockResolvedValue(passwordOk),
      updateLastLogin: jest.fn().mockResolvedValue(undefined),
    };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const lockout = new LoginLockoutService({
      lockout: { threshold: 3, baseSeconds: 30, maxSeconds: 120, resetSeconds: 600 },
      rateLimits: { account: { login: { limit: 100, windowMs: 900_000 } } },
    } as never);
    const service = new AuthService(
      makeSessionStoreFake() as never,
      userService as never,
      { sign: jest.fn().mockReturnValue('signed.jwt') } as never,
      { get: jest.fn((_key: string, def: unknown) => def) } as never,
      logger as never,
      { isAvailable: jest.fn().mockReturnValue(false) } as never,
      { render: jest.fn() } as never,
      {} as never,
      {
        getUserPermissions: jest.fn().mockResolvedValue([]),
        getUserRoleNames: jest.fn().mockResolvedValue([]),
      } as never,
      { isRegistrationEnabled: jest.fn(), getLoginSettingsSync: () => ({ accessExpiry: '15m', refreshExpiry: '7d' }) } as never,
      {
        getSettings: jest.fn().mockResolvedValue({ auth: { maxSessionsPerUser: 10 } }),
      } as never,
      {} as never,
      { ensureForUser: jest.fn().mockResolvedValue(undefined) } as never,
      lockout,
    );
    return { service, userService, logger, lockout };
  };

  const attempt = (service: AuthService, email = EMAIL, ip = '127.0.0.1') =>
    service.login({ email, password: PASSWORD_INPUT } as never, ip, 'jest-agent');

  const errorOf = async (promise: Promise<unknown>) => promise.then(() => undefined, (e: unknown) => e as { code: string; message: string });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('user enumeration', () => {
    it('returns the same error for unknown email and wrong password', async () => {
      const unknown = build(null, false);
      const wrong = build(buildUser(), false);

      const unknownError = await errorOf(attempt(unknown.service, 'ghost@acme.io'));
      const wrongError = await errorOf(attempt(wrong.service));

      expect(unknownError).toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
      expect(wrongError).toMatchObject({ code: unknownError!.code, message: unknownError!.message });
    });

    it('runs a bcrypt comparison against a decoy hash for unknown users', async () => {
      const { service, userService } = build(null, false);

      await errorOf(attempt(service, 'ghost@acme.io'));

      expect(userService.validatePassword).not.toHaveBeenCalled();
      expect(bcrypt.hash).toHaveBeenCalledTimes(1);
      expect(bcrypt.compare).toHaveBeenCalledWith(PASSWORD_INPUT, 'decoy-hash');
    });

    it('does not reveal a suspended account without the valid password', async () => {
      const { service } = build(buildUser({ status: UserStatus.SUSPENDED }), false);

      await expect(attempt(service)).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    });

    it('reveals suspension only after a valid password', async () => {
      const { service } = build(buildUser({ status: UserStatus.SUSPENDED }), true);

      await expect(attempt(service)).rejects.toMatchObject({ code: ErrorCode.AUTH_ACCOUNT_SUSPENDED });
    });

    it('does not reveal an unverified email without the valid password, and does after', async () => {
      const wrong = build(buildUser({ emailVerified: false }), false);
      await expect(attempt(wrong.service)).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });

      const right = build(buildUser({ emailVerified: false }), true);
      await expect(attempt(right.service)).rejects.toMatchObject({ code: ErrorCode.AUTH_EMAIL_NOT_VERIFIED });
    });
  });

  describe('progressive lockout', () => {
    it('answers 429 once the streak hits the threshold, even with the right password', async () => {
      const { service, userService } = build(buildUser(), false);

      for (let i = 0; i < 3; i++) {
        await expect(attempt(service)).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
      }
      userService.validatePassword.mockResolvedValue(true);

      await expect(attempt(service)).rejects.toMatchObject({ code: ErrorCode.TOO_MANY_REQUESTS });
      expect(userService.findByEmail).toHaveBeenCalledTimes(3);
    });

    it('locks unknown emails exactly like known ones', async () => {
      const { service } = build(null, false);

      for (let i = 0; i < 3; i++) await errorOf(attempt(service, 'ghost@acme.io'));

      await expect(attempt(service, 'ghost@acme.io')).rejects.toMatchObject({
        code: ErrorCode.TOO_MANY_REQUESTS,
      });
    });

    it('does not lock the real owner out when someone else guesses from another IP', async () => {
      const { service, userService } = build(buildUser(), false);

      for (let i = 0; i < 3; i++) await errorOf(attempt(service, EMAIL, '198.51.100.66'));
      await expect(attempt(service, EMAIL, '198.51.100.66')).rejects.toMatchObject({
        code: ErrorCode.TOO_MANY_REQUESTS,
      });

      userService.validatePassword.mockResolvedValue(true);
      await expect(attempt(service, EMAIL, '203.0.113.5')).resolves.toMatchObject({
        refreshToken: expect.any(String),
      });
    });

    it('does not count an outage as a failed attempt', async () => {
      const { service, userService } = build(buildUser(), false);
      userService.findByEmail.mockRejectedValue(new Error('db down'));

      for (let i = 0; i < 5; i++) await expect(attempt(service)).rejects.toThrow('db down');

      userService.findByEmail.mockResolvedValue(buildUser());
      await expect(attempt(service)).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    });

    it('resets the streak after a successful login', async () => {
      const { service, userService, lockout } = build(buildUser(), false);

      await errorOf(attempt(service));
      await errorOf(attempt(service));
      userService.validatePassword.mockResolvedValue(true);
      await expect(attempt(service)).resolves.toMatchObject({ refreshToken: expect.any(String) });
      userService.validatePassword.mockResolvedValue(false);

      expect(lockout.reserveAttempt(EMAIL, '127.0.0.1')).toBeNull();
    });
  });

  describe('PII in logs', () => {
    it('never logs the email address on a successful login', async () => {
      const { service, logger } = build(buildUser(), true);

      await attempt(service);

      const logged = JSON.stringify([
        logger.log.mock.calls,
        logger.warn.mock.calls,
        logger.error.mock.calls,
        logger.debug.mock.calls,
      ]);
      expect(logger.log).toHaveBeenCalledWith('User logged in', expect.objectContaining({ userId: expect.anything() }));
      expect(logged).not.toContain(EMAIL);
      expect(logged).not.toContain('127.0.0.1');
    });

    it('logs the lockout without the email address', async () => {
      const { service, logger } = build(buildUser(), false);

      for (let i = 0; i < 3; i++) await errorOf(attempt(service));

      expect(logger.warn).toHaveBeenCalledWith(
        'Login temporarily locked after repeated failures',
        expect.objectContaining({ lockSeconds: 30 }),
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(EMAIL);
    });

    it('does not log the email for a non-existent address on forgot-password', async () => {
      const { service, logger, userService } = build(null, false);
      Object.assign(userService, { generatePasswordResetToken: jest.fn().mockResolvedValue(null) });

      await service.forgotPassword('ghost@acme.io');

      expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('ghost@acme.io');
    });
  });
});
