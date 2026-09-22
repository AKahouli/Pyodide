import { ForbiddenException } from '../../exceptions';
import { UnauthorizedException } from '../../exceptions';
import { AppBuilderAiAuthGuard } from './app-builder-ai-auth.guard';

describe('AppBuilderAiAuthGuard', () => {
  const jwtService = {
    decode: jest.fn(),
    verifyAsync: jest.fn(),
  };
  const configService = { get: jest.fn() };
  const userService = { findById: jest.fn() };
  const authService = { isSessionValid: jest.fn() };
  const appDataClient = {
    isEnabled: jest.fn(),
    forward: jest.fn(),
    getStatus: jest.fn(),
    getEndUser: jest.fn(),
    listEndUsers: jest.fn(),
  };
  const appDataCatalog = { findByAppDataId: jest.fn(), requireAppByAppDataId: jest.fn() };
  const endUserAuth = { verifyToken: jest.fn() };
  const endUserGrants = { assertUseAi: jest.fn() };
  const runtimeBindings = { findByWorkspaceId: jest.fn() };

  const createGuard = () =>
    new AppBuilderAiAuthGuard(
      jwtService as never,
      configService as never,
      userService as never,
      authService as never,
      appDataClient as never,
      appDataCatalog as never,
      endUserAuth as never,
      endUserGrants as never,
      undefined,
      runtimeBindings as never,
    );

  const ctx = (auth?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: auth ? { authorization: auth } : {},
        }),
      }),
    }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    appDataClient.isEnabled.mockReturnValue(true);
    appDataClient.forward.mockResolvedValue({ status: 200, body: {} });
    userService.findById.mockResolvedValue({ id: 'owner-1' });
    appDataClient.getStatus.mockResolvedValue({
      app: { id: 'app-1', workspaceId: 'ws-1', ownerUserId: 'owner-1' },
      environments: [],
    });
    appDataClient.getEndUser.mockResolvedValue({
      id: 'end-user-1',
      status: 'active',
      grants: { create: false, read: false, update: false, delete: false, useAi: true },
    });
    appDataClient.listEndUsers.mockResolvedValue([
      {
        id: 'end-user-1',
        status: 'active',
        grants: { create: false, read: false, update: false, delete: false, useAi: true },
      },
    ]);
  });

  it('bills the remote app owner when owner_user_id is snake_case', async () => {
    jwtService.decode.mockReturnValue({
      typ: 'app_end_user',
      appDataId: 'app-1',
      sub: 'end-user-1',
    });
    appDataClient.getStatus.mockResolvedValue({
      app: { id: 'app-1', workspace_id: 'ws-1', owner_user_id: 'owner-1' },
      environments: [],
    });

    await expect(
      createGuard().canActivate(ctx('Bearer end-user-token')),
    ).resolves.toBe(true);
    expect(userService.findById).toHaveBeenCalledWith('owner-1');
    expect(runtimeBindings.findByWorkspaceId).not.toHaveBeenCalled();
  });

  it('falls back to runtime binding user when remote owner is missing', async () => {
    jwtService.decode.mockReturnValue({
      typ: 'app_end_user',
      appDataId: 'app-1',
      sub: 'end-user-1',
    });
    appDataClient.getStatus.mockResolvedValue({
      app: { id: 'app-1', workspaceId: 'ws-1' },
      environments: [],
    });
    runtimeBindings.findByWorkspaceId.mockResolvedValue({ userId: 'owner-from-binding' });
    userService.findById.mockResolvedValue({ id: 'owner-from-binding' });

    await expect(
      createGuard().canActivate(ctx('Bearer end-user-token')),
    ).resolves.toBe(true);
    expect(runtimeBindings.findByWorkspaceId).toHaveBeenCalledWith('ws-1');
    expect(userService.findById).toHaveBeenCalledWith('owner-from-binding');
  });

  it('rejects when no billable owner can be resolved', async () => {
    jwtService.decode.mockReturnValue({
      typ: 'app_end_user',
      appDataId: 'app-1',
      sub: 'end-user-1',
    });
    appDataClient.getStatus.mockResolvedValue({
      app: { id: 'app-1', workspaceId: 'ws-1' },
      environments: [],
    });
    runtimeBindings.findByWorkspaceId.mockResolvedValue(null);
    appDataCatalog.findByAppDataId.mockResolvedValue(null);

    await expect(createGuard().canActivate(ctx('Bearer end-user-token'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects app_end_user when useAi grant is false', async () => {
    jwtService.decode.mockReturnValue({
      typ: 'app_end_user',
      appDataId: 'app-1',
      sub: 'end-user-1',
    });
    appDataClient.getEndUser.mockResolvedValue({
      id: 'end-user-1',
      status: 'active',
      grants: { create: true, read: true, update: false, delete: false, useAi: false },
    });

    await expect(createGuard().canActivate(ctx('Bearer end-user-token'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows app_end_user when useAi grant is true', async () => {
    jwtService.decode.mockReturnValue({
      typ: 'app_end_user',
      appDataId: 'app-1',
      sub: 'end-user-1',
    });

    await expect(
      createGuard().canActivate(ctx('Bearer end-user-token')),
    ).resolves.toBe(true);
    expect(appDataClient.getEndUser).toHaveBeenCalledWith('app-1', 'end-user-1');
  });
});
