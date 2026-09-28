import { Types } from 'mongoose';
import { AuthService } from './auth.service';
import { makeSessionStoreFake, sessionRecord } from './persistence/session-store.fake';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { UserStatus } from '../user/user.types';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('AuthService account access', () => {
  const buildUser = (overrides: Record<string, unknown> = {}) => ({
    _id: new Types.ObjectId(),
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
    const sessionStore = makeSessionStoreFake();
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
    const jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    const configService = { get: jest.fn((_key: string, def: unknown) => def) };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const emailService = { isAvailable: jest.fn().mockReturnValue(false) };
    const emailTemplateRenderer = {
      render: jest.fn().mockResolvedValue({ subject: 's', html: '<p>s</p>', text: 's' }),
    };
    const usageService = {
      getDefaultPlan: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        slug: 'unlimited',
        workspaceStorageBytes: 100,
      }),
    };
    const authorizationService = {
      getUserPermissions: jest.fn().mockResolvedValue([]),
      getUserRoleNames: jest.fn().mockResolvedValue([]),
    };
    const systemService = {
      isRegistrationEnabled: jest.fn().mockReturnValue(true),
      getLoginSettingsSync: () => ({ accessExpiry: '3600m', refreshExpiry: '7d' }),
    };
    const workspaceInitializer = {
      getOrCreatePersonalWorkspace: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthService(
      sessionStore as never,
      userService as never,
      jwtService as never,
      configService as never,
      logger as never,
      emailService as never,
      emailTemplateRenderer as never,
      usageService as never,
      authorizationService as never,
      systemService as never,
      { getSettings: jest.fn().mockResolvedValue({ throttle: { limit: 100, windowSeconds: 60 }, auth: { maxSessionsPerUser: 10 }, documentUpload: { maxFileSizeMb: 50, maxFilesPerUpload: 10, allowedMimeTypes: [] } }) } as never, // platformSettings
      workspaceInitializer as never,
      humainAgentService as never,
    );
    return { service, sessionStore, userService };
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
        user: expect.objectContaining({ status: UserStatus.INACTIVE }),
      }),
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

  it('refreshes tokens for inactive users without invalidating sessions', async () => {
    const user = buildUser({ status: UserStatus.INACTIVE });
    const { service, sessionStore } = build(user);
    const sessionId = 'c0000000000000000000aaa';
    sessionStore.records.push({
      ...sessionRecord({ id: sessionId, userId: String(user._id), refreshTokenHash: 'hash', tokenFamily: 'family-1' }),
    });

    await expect(
      service.refreshTokens(`${sessionId}.token`, '127.0.0.1', 'jest-agent'),
    ).resolves.toMatchObject({
      accessToken: 'signed.jwt.token',
    });
    expect(sessionStore.invalidateByFamily).not.toHaveBeenCalled();
});
});
