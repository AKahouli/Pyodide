import { newObjectId } from '@common/postgres/object-id';
import { RegistrationService } from './registration.service';
import { ConflictException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

describe('RegistrationService registration flows', () => {
  const buildUser = (overrides: Record<string, unknown> = {}) => ({
    _id: newObjectId(),
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

  const build = (user: ReturnType<typeof buildUser>, registerMinDurationMs = 0) => {
    const humainAgentService = { ensureForUser: jest.fn().mockResolvedValue(undefined), syncFromProfile: jest.fn().mockResolvedValue(undefined) };
    const userService = {
      create: jest.fn().mockResolvedValue(user),
      assignPlan: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      get: jest.fn((key: string, def: unknown) => (key === 'auth.registerMinDurationMs' ? registerMinDurationMs : def)),
    };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const authEmailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      sendNewLocationAlertEmail: jest.fn().mockResolvedValue(undefined),
    };
    const usageService = { getDefaultPlan: jest.fn().mockResolvedValue({ _id: newObjectId(), slug: 'unlimited', workspaceStorageBytes: 100 }) };
    const systemService = {
      isRegistrationEnabled: jest.fn().mockReturnValue(true),
      getLoginSettingsSync: () => ({ accessExpiry: '3600m', refreshExpiry: '7d' }),
    };
    const workspaceInitializer = { getOrCreatePersonalWorkspace: jest.fn().mockResolvedValue(undefined) };
    const service = new RegistrationService(
      userService as never,
      {} as never, // userInvitations
      authEmailService as never,
      usageService as never,
      workspaceInitializer as never,
      humainAgentService as never,
      systemService as never,
      configService as never,
      logger as never,
    );
    return { service, humainAgentService, userService, logger, authEmailService, usageService, workspaceInitializer };
  };

  it('creates a human agent on register', async () => {
    const user = buildUser();
    const { service, humainAgentService } = build(user);

    await expect(
      service.register({ email: 'jane@acme.io', password: 'Str0ng!pass' } as never),
    ).resolves.toEqual({ message: expect.any(String) as string });

    expect(humainAgentService.ensureForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user._id, email: user.email }),
    );
  });

  it('returns the same response for an already-registered email without side effects or PII logs', async () => {
    const user = buildUser();
    const { service, humainAgentService, userService, logger, authEmailService, usageService, workspaceInitializer } = build(user);

    const created = await service.register({ email: 'new@acme.io', password: 'Str0ng!pass' } as never);
    userService.create.mockRejectedValueOnce(new ConflictException(ErrorCode.USER_ALREADY_EXISTS, 'Email already registered'));
    humainAgentService.ensureForUser.mockClear();
    usageService.getDefaultPlan.mockClear();
    workspaceInitializer.getOrCreatePersonalWorkspace.mockClear();
    logger.log.mockClear();
    authEmailService.sendVerificationEmail.mockClear();

    const duplicate = await service.register({ email: 'jane@acme.io', password: 'Str0ng!pass' } as never);

    expect(duplicate).toEqual(created);
    expect(humainAgentService.ensureForUser).not.toHaveBeenCalled();
    expect(usageService.getDefaultPlan).not.toHaveBeenCalled();
    expect(workspaceInitializer.getOrCreatePersonalWorkspace).not.toHaveBeenCalled();
    expect(authEmailService.sendVerificationEmail).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain('jane@acme.io');
  }, 15000);

  it('takes at least the configured floor on both the new and the existing-email path', async () => {
    const floorMs = 700;
    const { service, userService } = build(buildUser(), floorMs);
    const dto = { email: 'jane@acme.io', password: 'Str0ng!pass' } as never;

    const newStart = Date.now();
    await service.register(dto);
    const newElapsed = Date.now() - newStart;

    userService.create.mockRejectedValueOnce(new ConflictException(ErrorCode.USER_ALREADY_EXISTS, 'Email already registered'));
    const existingStart = Date.now();
    await service.register(dto);
    const existingElapsed = Date.now() - existingStart;

    expect(newElapsed).toBeGreaterThanOrEqual(floorMs - 20);
    expect(existingElapsed).toBeGreaterThanOrEqual(floorMs - 20);
  }, 15000);

  it('does not wait for the verification email, and logs a send failure without the address', async () => {
    const { service, authEmailService, logger } = build(buildUser());
    authEmailService.sendVerificationEmail.mockReturnValueOnce(new Promise(() => undefined));

    await expect(service.register({ email: 'jane@acme.io', password: 'Str0ng!pass' } as never)).resolves.toEqual({
      message: expect.any(String) as string,
    });

    authEmailService.sendVerificationEmail.mockRejectedValueOnce(new Error('smtp down'));
    await service.register({ email: 'jane@acme.io', password: 'Str0ng!pass' } as never);
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to send verification email after registration',
      expect.objectContaining({ error: 'smtp down' }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('jane@acme.io');
  }, 15000);

  it('still surfaces unexpected registration failures', async () => {
    const { service, userService } = build(buildUser());
    userService.create.mockRejectedValueOnce(new Error('store down'));

    await expect(service.register({ email: 'jane@acme.io', password: 'Str0ng!pass' } as never)).rejects.toThrow('store down');
  });
});
