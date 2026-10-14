import { newObjectId } from '@common/postgres/object-id';
import { AuthService } from './auth.service';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { UserStatus } from '../../user/user.types';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('AuthService account access', () => {
  const buildUser = (overrides: Record<string, unknown> = {}) => ({
    _id: newObjectId(),
    email: 'jane@acme.io',
    emailVerified: true,
    emailVerificationToken: 'verify-token',
    status: UserStatus.ACTIVE,
    roles: [],
    permissionsVersion: 1,
    profile: { firstName: 'Jane', lastName: 'Doe', role: 'PM', description: 'bio' },
    appearance: { colorTheme: 'default', language: 'en' },
    consents: {},
    ...overrides,
  });

  const build = (user: ReturnType<typeof buildUser>) => {
    const humainAgentService = {
      ensureForUser: jest.fn().mockResolvedValue(undefined),
      syncFromProfile: jest.fn().mockResolvedValue(undefined),
    };
    const userService = {
      create: jest.fn().mockResolvedValue(user),
      findByEmail: jest.fn().mockResolvedValue(user),
      findById: jest.fn().mockResolvedValue(user),
      validatePassword: jest.fn().mockResolvedValue(true),
      assignPlan: jest.fn().mockResolvedValue(undefined),
      updateLastLogin: jest.fn().mockResolvedValue(undefined),
    };
    const configService = { get: jest.fn((_key: string, def: unknown) => def) };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const authEmailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      sendNewLocationAlertEmail: jest.fn().mockResolvedValue(undefined),
    };
    const sessionService = {
      generateTokens: jest.fn().mockResolvedValue({ accessToken: 'signed.jwt.token', refreshToken: 'sess.secret', expiresIn: 900 }),
      isNewLoginLocation: jest.fn().mockResolvedValue(false),
      invalidateAllUserSessions: jest.fn().mockResolvedValue(undefined),
    };
    const authorizationService = {
      getUserPermissions: jest.fn().mockResolvedValue([]),
      getUserRoleNames: jest.fn().mockResolvedValue([]),
    };
    const service = new AuthService(
      userService as never,
      sessionService as never,
      configService as never,
      logger as never,
      authEmailService as never,
      authorizationService as never,
      humainAgentService as never,
      { assertNotLocked: jest.fn(), reserveAttempt: jest.fn().mockReturnValue(null), recordSuccess: jest.fn(), release: jest.fn() } as never, // loginLockout
    );
    return { service, userService };
  };

  it('allows login for inactive users pending Super Admin approval', async () => {
    const user = buildUser({ status: UserStatus.INACTIVE, profileComplete: false });
    const { service, userService } = build(user);

    await expect(
      service.login(
        { email: 'jane@acme.io', password: 'Str0ng!pass' } as never,
        '127.0.0.1',
        'jest-agent',
      ),
    ).resolves.toMatchObject({
      loginResponse: expect.objectContaining({
        user: expect.objectContaining({ status: UserStatus.INACTIVE }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    });
    expect(userService.validatePassword).toHaveBeenCalled();
  });

  it('rejects login for suspended users with AUTH_ACCOUNT_SUSPENDED', async () => {
    const user = buildUser({ status: UserStatus.SUSPENDED });
    const { service } = build(user);

    await expect(
      service.login(
        { email: 'jane@acme.io', password: 'Str0ng!pass' } as never,
        '127.0.0.1',
        'jest-agent',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_ACCOUNT_SUSPENDED });
  });
});
