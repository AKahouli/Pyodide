import { ConnectorMcpRuntimeService } from './connector-mcp-runtime.service';

describe('ConnectorMcpRuntimeService', () => {
  it('authorizes the requesting user before resolving connector-owner credentials', async () => {
    const connectors = { findById: jest.fn().mockResolvedValue({
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
