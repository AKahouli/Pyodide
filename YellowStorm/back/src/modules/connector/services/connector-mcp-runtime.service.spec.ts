import { ConnectorMcpRuntimeService } from './connector-mcp-runtime.service';
import { McpDestinationPolicyError } from '../utils/mcp-destination-policy.util';

const assertMcpDestinationAllowed = jest.fn<Promise<string[]>, [string, unknown?]>();

// Hermetic like the util's own spec: runtime tests stub resolution and prove
// the wiring; the policy's decision logic has its own suite (WP-05).
jest.mock('../utils/mcp-destination-policy.util', () => ({
  ...jest.requireActual('../utils/mcp-destination-policy.util'),
  assertMcpDestinationAllowed: (serverUrl: string, options?: unknown) => assertMcpDestinationAllowed(serverUrl, options),
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
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'mcp-semantic-model', actorDelegation: 'verified_user', allowPrivateNetwork: true, requiredPermissions: [] },
      authSourceType: 'credential', createdBy: { toString: () => 'owner' },
      actions: [{ key: 'find_records', isEnabled: true, safety: 'read' }],
    }) };
    const auth = { resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }), resolveDynamicHeaders: jest.fn().mockResolvedValue({}) };
    const shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    const mcpJwt = { assertConnectorAccess: jest.fn().mockResolvedValue(undefined), headers: jest.fn().mockResolvedValue({ Authorization: 'Bearer signed' }) };
    const service = new ConnectorMcpRuntimeService(connectors as never, auth as never,
      { setContext: jest.fn(), warn: jest.fn() } as never, shares as never, mcpJwt as never);
    const transport = jest.spyOn(service as any, 'createTransport').mockRejectedValue(new Error('transport reached'));
    await expect(service.callTool({ connectorId: 'connector-1', workspaceId: 'workspace-1',
      authorizationUserId: 'requesting-user', toolName: 'find_records', allowedTools: ['find_records'],
      arguments: {}, authoritativeHeaders: { Authorization: 'Bearer arbitrary' },
    })).rejects.toThrow('transport reached');
    expect(mcpJwt.headers).toHaveBeenCalledWith('http://localhost:8027/mcp', 'requesting-user', { Authorization: 'Bearer arbitrary' }, 'connector-1');
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
  it('fails configured connections with missing credentials before constructing a transport', async () => {
    const connectors = { getRuntimeById: jest.fn().mockResolvedValue({
      id: 'connector-1', isActive: true, mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://example.test/mcp', mcpServerConfig: {}, authSourceType: 'credential',
      createdBy: 'owner', actions: [{ key: 'search', safety: 'read', isEnabled: true }],
    }) };
    const auth = { resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }), resolveDynamicHeaders: jest.fn() };
    const service = new ConnectorMcpRuntimeService(connectors as never, auth as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
      { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) } as never);
    const transport = jest.spyOn(service as any, 'createTransport');
    await expect(service.callTool({ connectorId: 'connector-1', workspaceId: 'workspace-1',
      authorizationUserId: 'requesting-user', toolName: 'search', allowedTools: ['search'], arguments: {} }))
      .rejects.toThrow('no usable background credential');
    expect(transport).not.toHaveBeenCalled();
    expect(auth.resolveDynamicHeaders).not.toHaveBeenCalled();
  });
  it.each(['empty', 'failed'])('denies %s connected-account auth despite caller trace and stored static credentials', async failure => {
    const connectors = { getRuntimeById: jest.fn().mockResolvedValue({
      id: 'connector-1', isActive: true, mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://example.test/mcp', authSourceType: 'connected_app', connectedAppKey: 'provider',
      mcpServerConfig: { headers: { Authorization: 'Bearer forbidden-static' } }, createdBy: 'owner',
      actions: [{ key: 'search', safety: 'read', isEnabled: true }],
    }) };
    const auth = { resolveRuntimeAuth: failure === 'failed' ? jest.fn().mockRejectedValue(new Error('credential revoked'))
      : jest.fn().mockResolvedValue({ headers: {}, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({ 'X-User-Id': 'owner', 'X-Correlation-ID': 'trace' }) };
    const service = new ConnectorMcpRuntimeService(connectors as never, auth as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
      { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) } as never);
    const transport = jest.spyOn(service as any, 'createTransport');
    await expect(service.callTool({ connectorId: 'connector-1', workspaceId: 'workspace-1',
      authorizationUserId: 'user-1', toolName: 'search', allowedTools: ['search'], arguments: {},
      authoritativeHeaders: { 'X-User-Id': 'user-1', 'X-Correlation-ID': 'caller-trace' } })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    expect(auth.resolveDynamicHeaders).not.toHaveBeenCalled();
  });
  it.each([
    ['credential', 'Authorization'], ['credential', 'X-Api-Key'],
    ['server_config', 'Authorization'], ['server_config', 'X-Api-Key'],
  ])('rejects static-only %s/%s credentials that evidence transport would strip', async (authSourceType, header) => {
    const connectors = { getRuntimeById: jest.fn().mockResolvedValue({
      id: 'connector-1', isActive: true, mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://example.test/mcp', authSourceType,
      mcpServerConfig: { headers: { [header]: 'static-only-canary' } }, createdBy: 'owner',
      actions: [{ key: 'search', safety: 'read', isEnabled: true }],
    }) };
    const auth = { resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({ 'X-Correlation-Id': 'trace' }) };
    const service = new ConnectorMcpRuntimeService(connectors as never, auth as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
      { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) } as never);
    const transport = jest.spyOn(service as any, 'createTransport').mockRejectedValue(new Error('transport reached'));
    await expect(service.callTool({ connectorId: 'connector-1', workspaceId: 'workspace-1',
      authorizationUserId: 'user-1', toolName: 'search', allowedTools: ['search'], arguments: {},
    })).rejects.toThrow('no usable background credential');
    expect(transport).not.toHaveBeenCalled();
    expect(auth.resolveDynamicHeaders).not.toHaveBeenCalled();
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

  it('applies the connector insecure-HTTP grant to evidence execution like inspection', async () => {
    const connectors = { getRuntimeById: jest.fn().mockResolvedValue({
      id: 'connector-1', isActive: true, mcpTransportType: 'streamable_http',
      mcpServerUrl: 'http://127.0.0.1:8132/mcp', mcpServerConfig: {},
      mcpSecurityPolicy: { version: 1, profile: 'configured', actorDelegation: 'none', allowPrivateNetwork: false, allowInsecureHttp: true, requiredPermissions: [] },
      authSourceType: 'credential', createdBy: { toString: () => 'owner' },
      actions: [{ key: 'hello', isEnabled: true, safety: 'read' }],
    }) };
    const auth = { resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: { Authorization: 'Bearer resolved' }, env: {} }), resolveDynamicHeaders: jest.fn().mockResolvedValue({}) };
    const service = new ConnectorMcpRuntimeService(connectors as never, auth as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
      { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) } as never,
      undefined,
      { get: jest.fn(<T = string>(path: string, defaultValue?: T) => path === 'NODE_ENV' ? 'development' as unknown as T : (defaultValue as T)) } as never);
    jest.spyOn(service as any, 'createTransport').mockRejectedValue(new Error('transport reached'));

    await expect(service.callTool({ connectorId: 'connector-1', workspaceId: 'workspace-1',
      authorizationUserId: 'requesting-user', toolName: 'hello', allowedTools: ['hello'], arguments: {},
    })).rejects.toThrow('transport reached');
    expect(assertMcpDestinationAllowed).toHaveBeenCalledWith('http://127.0.0.1:8132/mcp',
      expect.objectContaining({ allowInsecureHttp: true, requireTls: false }));
  });
  it('keeps evidence execution HTTPS-only in production even with the connector grant', async () => {
    const connectors = { getRuntimeById: jest.fn().mockResolvedValue({
      id: 'connector-1', isActive: true, mcpTransportType: 'streamable_http',
      mcpServerUrl: 'http://127.0.0.1:8132/mcp', mcpServerConfig: {},
      mcpSecurityPolicy: { version: 1, profile: 'configured', actorDelegation: 'none', allowPrivateNetwork: false, allowInsecureHttp: true, requiredPermissions: [] },
      authSourceType: 'credential', createdBy: { toString: () => 'owner' },
      actions: [{ key: 'hello', isEnabled: true, safety: 'read' }],
    }) };
    const service = new ConnectorMcpRuntimeService({ getRuntimeById: connectors.getRuntimeById } as never,
      { resolveRuntimeAuth: jest.fn(), resolveDynamicHeaders: jest.fn() } as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
      { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) } as never,
      undefined,
      { get: jest.fn(<T = string>(path: string, defaultValue?: T) => path === 'NODE_ENV' ? 'production' as unknown as T : (defaultValue as T)) } as never);
    jest.spyOn(service as any, 'createTransport');
    assertMcpDestinationAllowed.mockRejectedValue(new McpDestinationPolicyError('insecure_http', '127.0.0.1'));

    await expect(service.callTool({ connectorId: 'connector-1', workspaceId: 'workspace-1',
      authorizationUserId: 'requesting-user', toolName: 'hello', allowedTools: ['hello'], arguments: {},
    })).rejects.toMatchObject({ code: 'ERR_3103' });
    expect(assertMcpDestinationAllowed).toHaveBeenCalledWith('http://127.0.0.1:8132/mcp',
      expect.objectContaining({ allowInsecureHttp: false, requireTls: true }));
  });
});
