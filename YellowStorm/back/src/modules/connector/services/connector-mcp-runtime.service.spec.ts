import { ConnectorMcpRuntimeService } from './connector-mcp-runtime.service';

describe('ConnectorMcpRuntimeService', () => {
  it('issues JWTs for the requesting user after workspace access, overriding owner and caller credentials', async () => {
    const connectors = { getRuntimeById: jest.fn().mockResolvedValue({
      id: 'connector-1', isActive: true, mcpTransportType: 'streamable_http',
      mcpServerUrl: 'http://localhost:8027/mcp', mcpServerConfig: {},
      authSourceType: 'credential', createdBy: { toString: () => 'owner' },
      actions: [{ key: 'find_records', isEnabled: true, safety: 'read' }],
    }) };
    const auth = { resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }), resolveDynamicHeaders: jest.fn().mockResolvedValue({}) };
    const shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    const mcpJwt = { isJwtServer: jest.fn().mockReturnValue(true), headers: jest.fn().mockResolvedValue({ Authorization: 'Bearer signed' }) };
    const service = new ConnectorMcpRuntimeService(connectors as never, auth as never,
      { setContext: jest.fn(), warn: jest.fn() } as never, shares as never, mcpJwt as never);
    const transport = jest.spyOn(service as any, 'createTransport').mockRejectedValue(new Error('transport reached'));
    await expect(service.callTool({ connectorId: 'connector-1', workspaceId: 'workspace-1',
      authorizationUserId: 'requesting-user', toolName: 'find_records', allowedTools: ['find_records'],
      arguments: {}, authoritativeHeaders: { Authorization: 'Bearer arbitrary' },
    })).rejects.toThrow('transport reached');
    expect(mcpJwt.headers).toHaveBeenCalledWith('http://localhost:8027/mcp', 'requesting-user', { Authorization: 'Bearer arbitrary' });
    expect(transport).toHaveBeenCalledWith('streamable_http', 'http://localhost:8027/mcp', { Authorization: 'Bearer signed' });
    expect(shares.assertUserHasAccess.mock.invocationCallOrder[0]).toBeLessThan(mcpJwt.headers.mock.invocationCallOrder[0]);
  });
  it('authorizes the requesting user before resolving connector-owner credentials', async () => {
    const connectors = { getRuntimeById: jest.fn().mockResolvedValue({
      id: 'connector-1', isActive: true, mcpTransportType: 'streamable_http',
      actions: [{ key: 'search', safety: 'read', isEnabled: true }], createdBy: { toString: () => 'connector-owner' },
    }) };
    const auth = { resolveRuntimeAuth: jest.fn(), resolveDynamicHeaders: jest.fn() };
    const logger = { setContext: jest.fn(), warn: jest.fn() };
    const workspaceShares = { assertUserHasAccess: jest.fn().mockRejectedValue(new Error('denied')) };
    const service = new ConnectorMcpRuntimeService(connectors as never, auth as never, logger as never, workspaceShares as never);

    await expect(service.callTool({ connectorId: 'connector-1', workspaceId: 'workspace-1', authorizationUserId: 'requesting-user', toolName: 'search', allowedTools: ['search'], arguments: {} })).rejects.toThrow('denied');
    expect(workspaceShares.assertUserHasAccess).toHaveBeenCalledWith('requesting-user', ['workspace-1']);
    expect(auth.resolveRuntimeAuth).not.toHaveBeenCalled();
  });
});
