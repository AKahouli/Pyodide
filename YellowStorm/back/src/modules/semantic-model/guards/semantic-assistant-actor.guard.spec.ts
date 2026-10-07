// The authorization barrel pulls in the whole user module (a cycle); the guard only needs its types.
jest.mock('@modules/authorization', () => ({ AuthorizationService: class {} }));
jest.mock('../services/semantic-model-assistant.service', () => ({ SemanticModelAssistantService: class {} }));

import { SemanticAssistantActorGuard } from './semantic-assistant-actor.guard';

describe('SemanticAssistantActorGuard', () => {
  const userId = '6984baadd6b2ec4585e8c707';
  const authorization = { getUserRoles: jest.fn(), getUserPermissions: jest.fn() };
  const access = { get: jest.fn() };
  const guard = new SemanticAssistantActorGuard(authorization as never, access as never);
  const run = async (headers: Record<string, string>) => {
    const request: { headers: Record<string, string>; user?: { permissions: string[] } } = { headers };
    const allowed = await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never);
    return { allowed, request };
  };
  const headers = { 'x-yellowstorm-user-id': userId, 'x-correlation-id': 'c-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    authorization.getUserRoles.mockResolvedValue([{ id: 'r1' }]);
    authorization.getUserPermissions.mockResolvedValue(['workspaces.read']);
  });

  it('gives the person their own permissions while checks are enforced', async () => {
    access.get.mockResolvedValue({ enforcePermissions: true });
    const { request } = await run(headers);
    expect(request.user!.permissions).toEqual(['workspaces.read']);
  });

  it('adds every semantic_models permission when an admin turned the check off, nothing else', async () => {
    access.get.mockResolvedValue({ enforcePermissions: false });
    const { request } = await run(headers);
    expect(request.user!.permissions).toEqual(['workspaces.read', 'semantic_models.*']);
  });

  it('still refuses a call without an acting person', async () => {
    access.get.mockResolvedValue({ enforcePermissions: false });
    await expect(run({ 'x-correlation-id': 'c-1' })).rejects.toThrow();
  });
});
