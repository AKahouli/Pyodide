import type { ExecutionContext } from '@nestjs/common';
import { DelegatedActorGuard } from './delegated-actor.guard';

interface TestRequest {
  headers: Record<string, string>;
  method?: string;
  route?: { path?: string };
  ip?: string;
  user?: unknown;
}

const context = (request: TestRequest): ExecutionContext => ({
  switchToHttp: () => ({ getRequest: () => request }),
} as unknown as ExecutionContext);

describe('DelegatedActorGuard (ADR-0024)', () => {
  const userId = '507f1f77bcf86cd799439011';
  const users = { findById: jest.fn() };
  const authorization = {
    getUserRoles: jest.fn(),
    getUserPermissions: jest.fn(),
  };
  const mcpJwt = { verifyDelegatedActor: jest.fn() };
  const audit = { logSuccess: jest.fn() };
  const guard = () => new DelegatedActorGuard(mcpJwt as never, users as never, authorization as never, audit as never);

  beforeEach(() => {
    jest.clearAllMocks();
    (authorization.getUserRoles as jest.Mock).mockResolvedValue([{ id: 'role-1' }]);
    (authorization.getUserPermissions as jest.Mock).mockResolvedValue(['semantic-models.read']);
  });

  it('derives the actor from the signed assertion, pins it and loads that user\'s permissions', async () => {
    mcpJwt.verifyDelegatedActor.mockResolvedValue({ sub: userId, connectorId: 'connector-1' });
    users.findById.mockResolvedValue({ status: 'active', email: 'agent-user@example.com' });
    const request: TestRequest = {
      headers: {
        'x-yellowstorm-mcp-assertion': 'signed-jwt',
        'x-correlation-id': 'request-1',
        'x-yellowstorm-service-principal': 'semantic-model-mcp',
      },
      method: 'POST',
      route: { path: '/internal/semantic-model-assistant/query-records' },
    };

    await expect(guard().canActivate(context(request))).resolves.toBe(true);

    // No per-route audience fence: the credential is verified as a delegated actor.
    expect(mcpJwt.verifyDelegatedActor).toHaveBeenCalledWith('signed-jwt');
    expect(request.headers['x-yellowstorm-user-id']).toBe(userId);
    expect(authorization.getUserRoles).toHaveBeenCalledWith(userId);
    expect(authorization.getUserPermissions).toHaveBeenCalledWith(['role-1']);
    expect(request.user).toEqual({ _id: userId, permissions: ['semantic-models.read'] });
  });

  it('attributes every delegated call with actor, calling principal and correlation id (ADR-0024 §6)', async () => {
    mcpJwt.verifyDelegatedActor.mockResolvedValue({ sub: userId, connectorId: 'connector-1' });
    users.findById.mockResolvedValue({ status: 'active', email: 'agent-user@example.com' });

    await guard().canActivate(context({
      headers: {
        'x-yellowstorm-mcp-assertion': 'signed-jwt',
        'x-correlation-id': 'request-42',
        'x-yellowstorm-service-principal': 'semantic-model-mcp',
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
      correlationId: 'request-42',
      method: 'POST',
      route: '/internal/semantic-model-assistant/query-records',
    });
    // Never record anything secret-bearing (assertion/token).
    expect(JSON.stringify(record)).not.toContain('signed-jwt');
  });

  it('rejects a user-id header that disagrees with the signed assertion', async () => {
    mcpJwt.verifyDelegatedActor.mockResolvedValue({ sub: userId, connectorId: 'connector-1' });
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
    expect(mcpJwt.verifyDelegatedActor).not.toHaveBeenCalled();
    expect(audit.logSuccess).not.toHaveBeenCalled();
  });

  it('does not attribute a rejected delegated call', async () => {
    mcpJwt.verifyDelegatedActor.mockResolvedValue({ sub: userId, connectorId: 'connector-1' });
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
    mcpJwt.verifyDelegatedActor.mockResolvedValue(null);
    await expect(guard().canActivate(context({
      headers: { 'x-yellowstorm-mcp-assertion': 'forged-jwt', 'x-correlation-id': 'request-1' },
    }))).rejects.toThrow(/Invalid MCP delegated actor assertion/);
  });

  it('rejects a verified assertion whose subject is not a platform user id', async () => {
    mcpJwt.verifyDelegatedActor.mockResolvedValue({ sub: 'not-an-object-id', connectorId: 'connector-1' });
    await expect(guard().canActivate(context({
      headers: { 'x-yellowstorm-mcp-assertion': 'signed-jwt', 'x-correlation-id': 'request-1' },
    }))).rejects.toThrow(/Invalid MCP delegated actor assertion/);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('rejects a missing or invalid correlation id', async () => {
    mcpJwt.verifyDelegatedActor.mockResolvedValue({ sub: userId, connectorId: 'connector-1' });
    await expect(guard().canActivate(context({
      headers: { 'x-yellowstorm-mcp-assertion': 'signed-jwt' },
    }))).rejects.toThrow(/Missing or invalid correlation id/);
    await expect(guard().canActivate(context({
      headers: { 'x-yellowstorm-mcp-assertion': 'signed-jwt', 'x-correlation-id': 'x'.repeat(201) },
    }))).rejects.toThrow(/Missing or invalid correlation id/);
  });

  it.each([null, { status: 'inactive' }, { status: 'suspended' }])('rejects unavailable accounts before loading permissions', async (user) => {
    mcpJwt.verifyDelegatedActor.mockResolvedValue({ sub: userId, connectorId: 'connector-1' });
    users.findById.mockResolvedValue(user);
    await expect(guard().canActivate(context({
      headers: { 'x-yellowstorm-mcp-assertion': 'signed-jwt', 'x-correlation-id': 'request-1' },
    }))).rejects.toThrow();
    expect(authorization.getUserRoles).not.toHaveBeenCalled();
  });
});
