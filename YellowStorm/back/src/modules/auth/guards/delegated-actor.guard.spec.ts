import type { ExecutionContext } from '@nestjs/common';
import { DelegatedActorGuard } from './delegated-actor.guard';

jest.mock('@modules/connector/services/mcp-jwt.service', () => ({ McpJwtService: class McpJwtService {} }));

interface TestRequest {
  headers: Record<string, string>;
  method?: string;
  route?: { path?: string };
  ip?: string;
  user?: unknown;
}

const context = (request: TestRequest): ExecutionContext => ({
  switchToHttp: () => ({ getRequest: () => request }),
  getHandler: () => function handler() {},
  getClass: () => class Controller {},
} as unknown as ExecutionContext);

describe('DelegatedActorGuard (ADR-0024)', () => {
  const userId = '507f1f77bcf86cd799439011';
  const users = { findById: jest.fn() };
  const authorization = {
    getUserRoles: jest.fn(),
    getUserPermissions: jest.fn(),
  };
  const mcpJwt = { verifyMcpAssertion: jest.fn() };
  const audit = { logSuccess: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn(() => 'mcp-semantic-model') };
  const guard = () => new DelegatedActorGuard(mcpJwt as never, users as never, authorization as never, audit as never, reflector as never);

  beforeEach(() => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue('mcp-semantic-model');
    (authorization.getUserRoles as jest.Mock).mockResolvedValue([{ id: 'role-1' }]);
    (authorization.getUserPermissions as jest.Mock).mockResolvedValue(['semantic-models.read']);
  });

  it('derives the actor from the signed assertion, pins it and loads that user\'s permissions', async () => {
    mcpJwt.verifyMcpAssertion.mockResolvedValue({ sub: userId, connectorId: 'connector-1', aud: 'mcp-semantic-model' });
    users.findById.mockResolvedValue({ status: 'active', email: 'agent-user@example.com' });
    const request: TestRequest = {
      headers: {
        'x-yellowstorm-mcp-assertion': 'signed-jwt',
        'x-correlation-id': 'request-1',
        'x-yellowstorm-service-principal': 'untrusted-principal',
      },
      method: 'POST',
      route: { path: '/internal/semantic-model-assistant/query-records' },
    };

    await expect(guard().canActivate(context(request))).resolves.toBe(true);

    expect(mcpJwt.verifyMcpAssertion).toHaveBeenCalledWith('signed-jwt', ['mcp-semantic-model']);
    expect(request.headers['x-yellowstorm-user-id']).toBe(userId);
    expect(authorization.getUserRoles).toHaveBeenCalledWith(userId);
    expect(authorization.getUserPermissions).toHaveBeenCalledWith(['role-1']);
    expect(request.user).toEqual({ _id: userId, permissions: ['semantic-models.read'] });
  });

  it('attributes every delegated call with actor, calling principal and correlation id (ADR-0024 Â§6)', async () => {
    mcpJwt.verifyMcpAssertion.mockResolvedValue({ sub: userId, connectorId: 'connector-1', aud: 'mcp-semantic-model' });
    users.findById.mockResolvedValue({ status: 'active', email: 'agent-user@example.com' });

    await guard().canActivate(context({
      headers: {
        'x-yellowstorm-mcp-assertion': 'signed-jwt',
        'x-correlation-id': 'request-42',
      },
      method: 'POST',
      route: { path: '/internal/semantic-model-assistant/query-records' },
    }));

    expect(audit.logSuccess).toHaveBeenCalledTimes(1);
    const records = (audit.logSuccess as jest.Mock).mock.calls as [Record<string, unknown>][];
    const record = records[0][0];
    expect(record).toMatchObject({
      actorId: userId,
      actorEmail: 'agent-user@example.com',
      action: 'mcp.delegated_call',
      targetType: 'internal_mcp_route',
    });
    // target_id is a 24-char id column: the route must live in metadata, not there.
    expect(record.targetId).toBeUndefined();
    expect(record.metadata).toEqual({
      servicePrincipal: 'semantic-model-mcp',
      connectorId: 'connector-1',
      correlationId: 'request-42',
      method: 'POST',
      route: '/internal/semantic-model-assistant/query-records',
    });
    // Never record anything secret-bearing (assertion/token).
    expect(JSON.stringify(record)).not.toContain('signed-jwt');
  });

  it('rejects a user-id header that disagrees with the signed assertion', async () => {
    mcpJwt.verifyMcpAssertion.mockResolvedValue({ sub: userId, connectorId: 'connector-1', aud: 'mcp-semantic-model' });
    users.findById.mockResolvedValue({ status: 'active' });

    await expect(guard().canActivate(context({
      headers: {
        'x-yellowstorm-mcp-assertion': 'signed-jwt',
        'x-yellowstorm-user-id': '507f1f77bcf86cd799439099',
        'x-correlation-id': 'request-1',
      },
    }))).rejects.toThrow(/does not match the signed actor assertion/);
  });

  it('fails closed when no assertion is presented', async () => {
    await expect(guard().canActivate(context({
      headers: { 'x-yellowstorm-user-id': userId, 'x-correlation-id': 'request-1' },
    }))).rejects.toThrow(/Missing MCP delegated actor assertion/);
    expect(users.findById).not.toHaveBeenCalled();
    expect(mcpJwt.verifyMcpAssertion).not.toHaveBeenCalled();
    expect(audit.logSuccess).not.toHaveBeenCalled();
  });

  it('does not attribute a rejected delegated call', async () => {
    mcpJwt.verifyMcpAssertion.mockResolvedValue({ sub: userId, connectorId: 'connector-1', aud: 'mcp-semantic-model' });
    users.findById.mockResolvedValue({ status: 'active', email: 'agent-user@example.com' });

    await expect(guard().canActivate(context({
      headers: {
        'x-yellowstorm-mcp-assertion': 'signed-jwt',
        'x-yellowstorm-user-id': '507f1f77bcf86cd799439099',
        'x-correlation-id': 'request-1',
      },
    }))).rejects.toThrow(/does not match the signed actor assertion/);
    expect(audit.logSuccess).not.toHaveBeenCalled();
  });

  it('rejects an assertion that does not verify', async () => {
    mcpJwt.verifyMcpAssertion.mockResolvedValue(null);
    await expect(guard().canActivate(context({
      headers: { 'x-yellowstorm-mcp-assertion': 'forged-jwt', 'x-correlation-id': 'request-1' },
    }))).rejects.toThrow(/Invalid MCP delegated actor assertion/);
  });

  it('rejects a verified assertion whose subject is not a platform user id', async () => {
    mcpJwt.verifyMcpAssertion.mockResolvedValue({ sub: 'not-an-object-id', connectorId: 'connector-1', aud: 'mcp-semantic-model' });
    await expect(guard().canActivate(context({
      headers: { 'x-yellowstorm-mcp-assertion': 'signed-jwt', 'x-correlation-id': 'request-1' },
    }))).rejects.toThrow(/Invalid MCP delegated actor assertion/);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('rejects a missing or invalid correlation id', async () => {
    mcpJwt.verifyMcpAssertion.mockResolvedValue({ sub: userId, connectorId: 'connector-1', aud: 'mcp-semantic-model' });
    await expect(guard().canActivate(context({
      headers: { 'x-yellowstorm-mcp-assertion': 'signed-jwt' },
    }))).rejects.toThrow(/Missing or invalid correlation id/);
    await expect(guard().canActivate(context({
      headers: { 'x-yellowstorm-mcp-assertion': 'signed-jwt', 'x-correlation-id': 'x'.repeat(201) },
    }))).rejects.toThrow(/Missing or invalid correlation id/);
  });

  it.each([null, { status: 'inactive' }, { status: 'suspended' }])('rejects unavailable accounts before loading permissions', async (user) => {
    mcpJwt.verifyMcpAssertion.mockResolvedValue({ sub: userId, connectorId: 'connector-1', aud: 'mcp-semantic-model' });
    users.findById.mockResolvedValue(user);
    await expect(guard().canActivate(context({
      headers: { 'x-yellowstorm-mcp-assertion': 'signed-jwt', 'x-correlation-id': 'request-1' },
    }))).rejects.toThrow();
    expect(authorization.getUserRoles).not.toHaveBeenCalled();
  });

  it('fails closed without route-owned audience metadata', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined as never);
    await expect(guard().canActivate(context({ headers: {
      'x-yellowstorm-mcp-assertion': 'signed-jwt', 'x-correlation-id': 'request-1',
    } }))).rejects.toThrow(/Missing trusted MCP route audience/);
    expect(mcpJwt.verifyMcpAssertion).not.toHaveBeenCalled();
  });

  it('never selects the audience from caller headers and rejects a failed policy/audience verification', async () => {
    mcpJwt.verifyMcpAssertion.mockResolvedValue(null);
    await expect(guard().canActivate(context({ headers: {
      'x-yellowstorm-mcp-assertion': 'foreign-jwt', 'x-correlation-id': 'request-1',
      'x-yellowstorm-mcp-audience': 'mcp-agent',
    } }))).rejects.toThrow(/Invalid MCP delegated actor assertion/);
    expect(mcpJwt.verifyMcpAssertion).toHaveBeenCalledWith('foreign-jwt', ['mcp-semantic-model']);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('rejects duplicate actor headers before assertion verification', async () => {
    await expect(guard().canActivate(context({ headers: {
      'x-yellowstorm-mcp-assertion': 'one,two', 'x-correlation-id': 'request-1',
    } }))).rejects.toThrow(/Ambiguous security header/);
    expect(mcpJwt.verifyMcpAssertion).not.toHaveBeenCalled();
  });

  it('rejects duplicate correlation headers before assertion verification', async () => {
    await expect(guard().canActivate(context({ headers: {
      'x-yellowstorm-mcp-assertion': 'signed-jwt', 'x-correlation-id': 'one,two',
    } }))).rejects.toThrow(/Ambiguous security header/);
    expect(mcpJwt.verifyMcpAssertion).not.toHaveBeenCalled();
  });

  it('accepts a route-declared migration audience and attributes its own principal', async () => {
    reflector.getAllAndOverride.mockReturnValue(['mcp-semantic-model', 'mcp-platform'] as never);
    mcpJwt.verifyMcpAssertion.mockResolvedValue({ sub: userId, connectorId: 'connector-9', aud: 'mcp-platform' });
    users.findById.mockResolvedValue({ status: 'active', email: 'agent-user@example.com' });

    await guard().canActivate(context({
      headers: { 'x-yellowstorm-mcp-assertion': 'signed-jwt', 'x-correlation-id': 'request-1' },
      method: 'POST',
      route: { path: '/internal/semantic-model-assistant/query-records' },
    }));

    expect(mcpJwt.verifyMcpAssertion).toHaveBeenCalledWith('signed-jwt', ['mcp-semantic-model', 'mcp-platform']);
    const record = (audit.logSuccess as jest.Mock).mock.calls[0][0];
    expect(record.metadata.servicePrincipal).toBe('mcp-platform');
  });
});
