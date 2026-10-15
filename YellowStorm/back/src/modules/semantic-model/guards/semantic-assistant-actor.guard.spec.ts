import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
jest.mock('../services/semantic-model-assistant.service', () => ({ SemanticModelAssistantService: class {} }));
import { SemanticAssistantActorGuard } from './semantic-assistant-actor.guard';

const context = (headers: Record<string, string>): ExecutionContext => ({
  switchToHttp: () => ({ getRequest: () => ({ headers }) }),
} as unknown as ExecutionContext);

describe('SemanticAssistantActorGuard', () => {
  const userId = '507f1f77bcf86cd799439011';
  const users = { findById: jest.fn() };
  const authorization = { getUserRoles: jest.fn().mockResolvedValue([{ id: 'role-1' }]), getUserPermissions: jest.fn().mockResolvedValue(['semantic-models.read']) };
  const config = {
    get: jest.fn((key: string, fallback?: string) => (key === 'SEMANTIC_MODEL_MCP_AUTH_MODE' ? 'Bearer' : fallback)),
  } as unknown as ConfigService;
  const mcpJwt = { verifyMcpAssertion: jest.fn() };
  const guard = () => new SemanticAssistantActorGuard(authorization as never, users as never, config as never, mcpJwt as never);
  const headers = { 'x-yellowstorm-user-id': userId, 'x-correlation-id': 'request-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    (config.get as jest.Mock).mockImplementation((key: string, fallback?: string) => (key === 'SEMANTIC_MODEL_MCP_AUTH_MODE' ? 'Bearer' : fallback));
  });

  it('loads platform permissions for an active user (developer Bearer mode)', async () => {
    users.findById.mockResolvedValue({ status: 'active' });
    await expect(guard().canActivate(context(headers))).resolves.toBe(true);
    expect(authorization.getUserRoles).toHaveBeenCalledWith(userId);
  });

  it('derives the actor from a verified MCP assertion and pins the verified identity onto the request (WP06.4)', async () => {
    mcpJwt.verifyMcpAssertion.mockReturnValue({ sub: userId });
    users.findById.mockResolvedValue({ status: 'active' });
    const request: { headers: Record<string, string> } = { headers: { 'x-yellowstorm-mcp-assertion': 'signed-jwt', 'x-correlation-id': 'request-1' } };
    await expect(guard().canActivate(context(request.headers))).resolves.toBe(true);
    expect(mcpJwt.verifyMcpAssertion).toHaveBeenCalledWith('signed-jwt');
    expect(request.headers['x-yellowstorm-user-id']).toBe(userId);
  });

  it('rejects a user-id header that disagrees with the signed assertion', async () => {
    mcpJwt.verifyMcpAssertion.mockReturnValue({ sub: userId });
    users.findById.mockResolvedValue({ status: 'active' });
    await expect(guard().canActivate(context({
      'x-yellowstorm-mcp-assertion': 'signed-jwt',
      'x-yellowstorm-user-id': '507f1f77bcf86cd799439099',
      'x-correlation-id': 'request-1',
    }))).rejects.toThrow(/does not match the signed actor assertion/);
  });

  it('fails closed in JWT mode when no assertion is presented (WP06.1)', async () => {
    (config.get as jest.Mock).mockImplementation((key: string, fallback?: string) => (key === 'SEMANTIC_MODEL_MCP_AUTH_MODE' ? 'JWT' : fallback));
    users.findById.mockClear();
    await expect(guard().canActivate(context(headers))).rejects.toThrow(/Missing semantic MCP actor assertion/);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('rejects an assertion that does not verify', async () => {
    mcpJwt.verifyMcpAssertion.mockReturnValue(null);
    await expect(guard().canActivate(context({
      'x-yellowstorm-mcp-assertion': 'forged-jwt',
      'x-correlation-id': 'request-1',
    }))).rejects.toThrow(/Invalid semantic MCP actor assertion/);
  });

  it.each([null, { status: 'inactive' }, { status: 'suspended' }])('rejects unavailable accounts before loading permissions', async (user) => {
    users.findById.mockResolvedValue(user);
    authorization.getUserRoles.mockClear();
    await expect(guard().canActivate(context(headers))).rejects.toThrow();
    expect(authorization.getUserRoles).not.toHaveBeenCalled();
  });
});
