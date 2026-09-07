import { JwtStrategy } from './jwt.strategy';
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
      authService as never,
    );
    return { strategy };
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
});
