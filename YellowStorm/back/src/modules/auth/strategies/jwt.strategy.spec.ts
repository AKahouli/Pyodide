import { JwtStrategy } from './jwt.strategy';
import { makeSessionStoreFake, sessionRecord } from '../persistence/session-store.fake';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { UserStatus } from '../../user/schemas/user.schema';
describe('JwtStrategy account access', () => {
  const payload = {
    sub: 'user-1',
    email: 'jane@acme.io',
    type: 'access' as const,
    sessionId: 'session-1',
    permissions: [],
    roleNames: [],
    permissionsVersion: 1,
  };

  const makeStrategy = (user: { status: string } | null) => {
    const sessionStore = makeSessionStoreFake([
      sessionRecord({
        id: 'session-1',
        userId: 'user-1',
        isValid: true,
        expiresAt: new Date(Date.now() + 60_000),
        deviceInfo: {},
        refreshTokenHash: 'hash',
        tokenFamily: 'family',
      }),
    ]);
    if (user) {
      (Object.assign(sessionStore.records[0], {}) as unknown as Record<string, unknown>);
      jest.spyOn(sessionStore, 'findValidByIdWithUser').mockResolvedValue({
        session: sessionStore.records[0],
        user: { id: 'user-1', status: user.status } as never,
        valid: true,
      });
    } else {
      jest.spyOn(sessionStore, 'findValidByIdWithUser').mockResolvedValue(null);
    }
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          'jwt.secret': 'test-secret-key-for-jwt-strategy-unit-tests',
          'jwt.issuer': 'test-issuer',
          'jwt.audience': 'test-audience',
        };
        return values[key];
      }),
    };
    const userService = { findById: jest.fn().mockResolvedValue(user) };
    const authService = { isSessionValid: jest.fn().mockResolvedValue(true) };
    const strategy = new JwtStrategy(
      configService as never,
      userService as never,
      { isSessionValid: jest.fn().mockResolvedValue(true) } as never,
      sessionStore as never,
    );
    return { strategy, sessionStore };
  };

  it('rejects suspended users with AUTH_ACCOUNT_SUSPENDED', async () => {
    const { strategy } = makeStrategy({ status: UserStatus.SUSPENDED });

    await expect(strategy.validate(payload)).rejects.toMatchObject({
      code: ErrorCode.AUTH_ACCOUNT_SUSPENDED,
    });
  });

  it('allows inactive users pending Super Admin approval', async () => {
    const user = { status: UserStatus.INACTIVE };
    const { strategy } = makeStrategy(user);

    await expect(strategy.validate(payload)).resolves.toMatchObject({
      status: UserStatus.INACTIVE,
      permissions: [],
    });
  });

  it('allows active users', async () => {
    const user = { status: UserStatus.ACTIVE };
    const { strategy } = makeStrategy(user);

    await expect(strategy.validate(payload)).resolves.toMatchObject({
      status: UserStatus.ACTIVE,
      permissions: [],
    });
  });

  // R-09: a Postgres outage must answer 503 so clients keep retrying —
  // never 401, which would destroy a valid login context.
  it('answers 503 (not 401) when the session store is down with a wrapped 57P01', async () => {
    const { strategy, sessionStore } = makeStrategy({ status: UserStatus.ACTIVE });
    jest.spyOn(sessionStore, 'findValidByIdWithUser').mockRejectedValue(
      new Error('Failed query: select ...', {
        cause: Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }),
      }),
    );

    await expect(strategy.validate(payload)).rejects.toMatchObject({
      code: ErrorCode.AUTH_DEPENDENCY_UNAVAILABLE,
      getStatus: expect.anything(),
    });
    await strategy.validate(payload).catch((e) => {
      expect(e.getStatus()).toBe(503);
    });
  });
});
