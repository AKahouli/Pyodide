import { Types } from 'mongoose';
import { AuthService } from './auth.service';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { UserStatus } from '../user/schemas/user.schema';

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

  const makeSessionModel = () => {
    const saved = { _id: new Types.ObjectId(), save: jest.fn().mockResolvedValue(undefined) };
    const model: any = jest.fn().mockImplementation(() => saved);
    model.countDocuments = jest.fn().mockResolvedValue(0);
    model.find = jest.fn().mockReturnValue({
      sort: () => ({ limit: () => ({ exec: jest.fn().mockResolvedValue([]) }) }),
    });
    model.findOne = jest.fn().mockResolvedValue(null);
    model.findById = jest.fn();
    model.deleteOne = jest.fn();
    model.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    return model;
  };

  const build = (user: ReturnType<typeof buildUser>) => {
    const sessionModel = makeSessionModel();
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
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const emailService = { isAvailable: jest.fn().mockReturnValue(false) };
    const usageService = {
      getDefaultPlan: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        slug: 'free',
        workspaceStorageBytes: 100,
      }),
    };
    const authorizationService = {
      getUserPermissions: jest.fn().mockResolvedValue([]),
      getUserRoleNames: jest.fn().mockResolvedValue([]),
    };
    const systemService = { isRegistrationEnabled: jest.fn().mockReturnValue(true) };
    const workspaceInitializer = {
      getOrCreatePersonalWorkspace: jest.fn().mockResolvedValue(undefined),
    };
    const registrationApprovalService = {
      notifySuperAdminsOfRegistration: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthService(
      sessionModel as never,
      userService as never,
      jwtService as never,
      configService as never,
      logger as never,
      emailService as never,
      usageService as never,
      authorizationService as never,
      systemService as never,
      workspaceInitializer as never,
      humainAgentService as never,
      registrationApprovalService as never,
    );
    return { service, sessionModel, userService };
  };

  it('rejects login for inactive users with USER_INACTIVE', async () => {
    const user = buildUser({ status: UserStatus.INACTIVE });
    const { service, userService } = build(user);

    await expect(
      service.login(
        { email: 'jane@acme.io', password: 'Str0ng!pass' } as never,
        '127.0.0.1',
        'jest-agent',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.USER_INACTIVE });
    expect(userService.validatePassword).not.toHaveBeenCalled();
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

  it('rejects refresh for inactive users and invalidates sessions', async () => {
    const user = buildUser({ status: UserStatus.INACTIVE });
    const { service, sessionModel } = build(user);
    const sessionId = new Types.ObjectId();
    sessionModel.findById.mockResolvedValue({
      _id: sessionId,
      userId: user._id,
      isValid: true,
      expiresAt: new Date(Date.now() + 60_000),
      refreshTokenHash: 'hash',
      tokenFamily: 'family-1',
    });

    await expect(
      service.refreshTokens(`${sessionId.toString()}.token`, '127.0.0.1', 'jest-agent'),
    ).rejects.toMatchObject({ code: ErrorCode.USER_INACTIVE });
    expect(sessionModel.updateMany).toHaveBeenCalled();
  });
});
