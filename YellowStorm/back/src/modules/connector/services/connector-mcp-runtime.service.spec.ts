import { ConnectorMcpRuntimeService } from './connector-mcp-runtime.service';
import { McpDestinationPolicyError } from '../utils/mcp-destination-policy.util';

const assertMcpDestinationAllowed = jest.fn<Promise<string[]>, [string]>();

// Hermetic like the util's own spec: runtime tests stub resolution and prove
// the wiring; the policy's decision logic has its own suite (WP-05).
jest.mock('../utils/mcp-destination-policy.util', () => ({
  ...jest.requireActual('../utils/mcp-destination-policy.util'),
  assertMcpDestinationAllowed: (serverUrl: string) => assertMcpDestinationAllowed(serverUrl),
}));

describe('ConnectorMcpRuntimeService', () => {
  beforeEach(() => {
    assertMcpDestinationAllowed.mockReset();
    assertMcpDestinationAllowed.mockResolvedValue(['93.184.216.34']);
  });

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
  it('applies the egress policy to the runtime destination before any transport is built and denies with ERR_3103', async () => {
    const connectors = { getRuntimeById: jest.fn().mockResolvedValue({
      id: 'connector-1', isActive: true, mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://mcp.example.test/mcp', mcpServerConfig: {},
      authSourceType: 'none', createdBy: { toString: () => 'owner' },
      actions: [{ key: 'find_records', isEnabled: true, safety: 'read' }],
    }) };
    const auth = { resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }), resolveDynamicHeaders: jest.fn().mockResolvedValue({}) };
    const shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    const warn = jest.fn();
    const service = new ConnectorMcpRuntimeService(connectors as never, auth as never,
      { setContext: jest.fn(), warn } as never, shares as never);
    assertMcpDestinationAllowed.mockRejectedValue(new McpDestinationPolicyError('forbidden_address', 'mcp.example.test'));

    await expect(service.callTool({ connectorId: 'connector-1', workspaceId: 'workspace-1',
      authorizationUserId: 'requesting-user', toolName: 'find_records', allowedTools: ['find_records'], arguments: {},
    })).rejects.toMatchObject({ code: 'ERR_3103' });
    expect(auth.resolveRuntimeAuth).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('Denied MCP runtime tool call destination', expect.objectContaining({ reason: 'forbidden_address' }));
  });
});
