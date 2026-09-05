import { Types } from 'mongoose';
import { AuthService } from './auth.service';

describe('AuthService human-agent creation', () => {
  const buildUser = (overrides: Record<string, unknown> = {}) => ({
    _id: new Types.ObjectId(),
    email: 'jane@acme.io',
    emailVerified: true,
    emailVerificationToken: 'verify-token',
    status: 'active',
    roles: [],
    permissionsVersion: 1,
    profile: { firstName: 'Jane', lastName: 'Doe', role: 'PM', description: 'bio' },
    appearance: { colorTheme: 'default', language: 'en' },
    consents: {},
    ...overrides,
  });

  // sessionModel doubles as a constructor (new sessionModel({...})) and a static query object.
  const makeSessionModel = () => {
    const saved = { _id: new Types.ObjectId(), save: jest.fn().mockResolvedValue(undefined) };
    const model: any = jest.fn().mockImplementation(() => saved);
    model.countDocuments = jest.fn().mockResolvedValue(0);
    model.find = jest.fn().mockReturnValue({ sort: () => ({ limit: () => ({ exec: jest.fn().mockResolvedValue([]) }) }) });
    model.findOne = jest.fn().mockResolvedValue(null);
    return model;
  };

  const build = (user: ReturnType<typeof buildUser>) => {
    const humainAgentService = { ensureForUser: jest.fn().mockResolvedValue(undefined), syncFromProfile: jest.fn().mockResolvedValue(undefined) };
    const userService = {
      create: jest.fn().mockResolvedValue(user),
      findByEmail: jest.fn().mockResolvedValue(user),
      validatePassword: jest.fn().mockResolvedValue(true),
      assignPlan: jest.fn().mockResolvedValue(undefined),
      updateLastLogin: jest.fn().mockResolvedValue(undefined),
    };
    const jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    const configService = { get: jest.fn((_key: string, def: unknown) => def) };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const emailService = { isAvailable: jest.fn().mockReturnValue(false) };
    const usageService = { getDefaultPlan: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), slug: 'free', workspaceStorageBytes: 100 }) };
    const authorizationService = { getUserPermissions: jest.fn().mockResolvedValue([]), getUserRoleNames: jest.fn().mockResolvedValue([]) };
    const systemService = { isRegistrationEnabled: jest.fn().mockReturnValue(true) };
    const workspaceInitializer = { getOrCreatePersonalWorkspace: jest.fn().mockResolvedValue(undefined) };
    const registrationApprovalService = { notifySuperAdminsOfRegistration: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      makeSessionModel() as never,
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
    return { service, humainAgentService, userService, registrationApprovalService };
  };

  it('creates a human agent on register', async () => {
    const user = buildUser();
    const { service, humainAgentService, registrationApprovalService } = build(user);

    await expect(
      service.register({ email: 'jane@acme.io', password: 'Str0ng!pass' } as never),
    ).resolves.toMatchObject({ userId: user._id.toString() });

    expect(humainAgentService.ensureForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user._id.toString(), email: user.email }),
    );
    expect(registrationApprovalService.notifySuperAdminsOfRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user._id.toString(), email: user.email }),
    );
  });

  it('ensures a human agent on login (covers already-registered users)', async () => {
    const user = buildUser();
    const { service, humainAgentService } = build(user);

    await service.login({ email: 'jane@acme.io', password: 'Str0ng!pass' } as never, '127.0.0.1', 'jest-agent');

    expect(humainAgentService.ensureForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user._id.toString(), email: user.email, firstName: 'Jane', role: 'PM' }),
    );
  });

  it('completes registration when super admin notification fails', async () => {
    const user = buildUser();
    const { service, registrationApprovalService } = build(user);
    registrationApprovalService.notifySuperAdminsOfRegistration.mockRejectedValue(new Error('smtp down'));

    await expect(
      service.register({ email: 'jane@acme.io', password: 'Str0ng!pass' } as never),
    ).resolves.toMatchObject({ userId: user._id.toString() });
  });
});
