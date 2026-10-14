import { newObjectId } from '@common/postgres/object-id';
import { AuthService } from './auth.service';
import { makeSessionStoreFake } from './persistence/session-store.fake';
import { ErrorCode } from '../exceptions/constants/error-codes';

describe('AuthService register with an invitation token', () => {
  const buildUser = (overrides: Record<string, unknown> = {}) => ({
    _id: newObjectId(),
    email: 'jane@acme.io',
    emailVerified: false,
    emailVerificationToken: 'verify-token',
    status: 'inactive',
    roles: [],
    permissionsVersion: 1,
    profile: {},
    appearance: {},
    consents: {},
    ...overrides,
  });

  const build = () => {
    const calls: string[] = [];
    const userInvitations = {
      assertUsableForEmail: jest.fn(async () => {
        calls.push('assert');
      }),
      markConsumed: jest.fn(async () => {
        calls.push('consume');
      }),
    };
    const user = buildUser();
    const userService = {
      create: jest.fn(async () => {
        calls.push('create');
        return user;
      }),
      findByEmail: jest.fn().mockResolvedValue(null),
      assignPlan: jest.fn().mockResolvedValue(undefined),
    };
    const jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    const configService = {
      get: jest.fn((_key: string, def: unknown) => def),
    };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const emailService = { isAvailable: jest.fn().mockReturnValue(false), send: jest.fn() };
    const emailTemplateRenderer = {
      render: jest.fn().mockResolvedValue({ subject: 's', html: '<p>s</p>', text: 's' }),
    };
    const usageService = {
      getDefaultPlan: jest.fn().mockResolvedValue({ _id: newObjectId(), slug: 'free', workspaceStorageBytes: 100 }),
    };
    const authorizationService = {
      getUserPermissions: jest.fn().mockResolvedValue([]),
      getUserRoleNames: jest.fn().mockResolvedValue([]),
    };
    const systemService = {
      isRegistrationEnabled: jest.fn().mockReturnValue(true),
      getLoginSettingsSync: () => ({ accessExpiry: '3600m', refreshExpiry: '7d' }),
    };
    const workspaceInitializer = { getOrCreatePersonalWorkspace: jest.fn().mockResolvedValue(undefined) };
    const humainAgentService = { ensureForUser: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      makeSessionStoreFake() as never,
      userService as never,
      userInvitations as never,
      jwtService as never,
      configService as never,
      logger as never,
      emailService as never,
      emailTemplateRenderer as never,
      usageService as never,
      authorizationService as never,
      systemService as never,
      { getSettings: jest.fn() } as never,
      workspaceInitializer as never,
      humainAgentService as never,
      { assertNotLocked: jest.fn(), reserveAttempt: jest.fn().mockReturnValue(null), recordSuccess: jest.fn(), release: jest.fn() } as never,
    );
    return { service, calls, userInvitations, userService };
  };

  it('asserts before creating the user, then claims the invitation after', async () => {
    const { service, calls, userInvitations } = build();

    await service.register({
      email: 'jane@acme.io',
      password: 'Str0ng!pass',
      inviteToken: 'raw-token',
    } as never);

    expect(calls).toEqual(['assert', 'create', 'consume']);
    expect(userInvitations.assertUsableForEmail).toHaveBeenCalledWith('raw-token', 'jane@acme.io');
    expect(userInvitations.markConsumed).toHaveBeenCalledWith('raw-token');
  });

  it('does not create a user when the invitation is refused', async () => {
    const { service, userInvitations, userService } = build();
    userInvitations.assertUsableForEmail.mockRejectedValue(
      Object.assign(new Error('expired'), { code: ErrorCode.AUTH_INVITE_TOKEN_EXPIRED }),
    );

    await expect(
      service.register({ email: 'jane@acme.io', password: 'Str0ng!pass', inviteToken: 'raw-token' } as never),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVITE_TOKEN_EXPIRED });

    expect(userService.create).not.toHaveBeenCalled();
    expect(userInvitations.markConsumed).not.toHaveBeenCalled();
  });

  it('does not burn the invitation when user creation fails', async () => {
    const { service, userInvitations, userService } = build();
    userService.create.mockRejectedValue(new Error('store down'));

    await expect(
      service.register({ email: 'jane@acme.io', password: 'Str0ng!pass', inviteToken: 'raw-token' } as never),
    ).rejects.toThrow('store down');

    expect(userInvitations.assertUsableForEmail).toHaveBeenCalled();
    expect(userInvitations.markConsumed).not.toHaveBeenCalled();
  });

  it('leaves the plain registration path untouched when no token is sent', async () => {
    const { service, calls, userInvitations } = build();

    await service.register({ email: 'jane@acme.io', password: 'Str0ng!pass' } as never);

    expect(calls).toEqual(['create']);
    expect(userInvitations.assertUsableForEmail).not.toHaveBeenCalled();
    expect(userInvitations.markConsumed).not.toHaveBeenCalled();
  });
});
