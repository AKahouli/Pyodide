import { AdminConnectorController } from './admin-connector.controller';

describe('AdminConnectorController MCP inspection', () => {
  const user = { _id: { toString: () => 'user-1' } } as never;

  const playbookConnector = {
    id: 'connector-1',
    slug: 'playbook-mcp',
    isSystem: true,
    authSourceType: 'server_config',
    connectedAppKey: '',
    runtimeAuthConfig: { secretKey: 'playbook_mcp_ingress' },
    mcpTransportType: 'streamable_http',
    mcpServerUrl: 'http://localhost:8025/mcp',
    mcpServerConfig: {},
  };

  function createController(connector = playbookConnector) {
    const connectorService = {
      findById: jest.fn().mockResolvedValue(connector),
      inspectMcp: jest.fn().mockResolvedValue({ serverName: 'playbook', tools: [] }),
    };
    const connectorAuthService = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({
        headers: { Authorization: 'Bearer server-secret' },
        env: {},
      }),
    };
    const controller = new AdminConnectorController(
      connectorService as never,
      {} as never,
      {} as never,
      connectorAuthService as never,
    );
    return { controller, connectorService, connectorAuthService };
  }

  it('uses persisted server auth and a complete actor envelope for Playbook MCP inspection', async () => {
    const { controller, connectorService, connectorAuthService } = createController();

    await controller.inspectMcp({
      connectorId: 'connector-1',
      transportType: 'streamable_http',
      serverUrl: 'http://localhost:8025/mcp',
      runtimeAuthConfig: {
        strategy: 'http_header_bearer',
        headerName: 'Authorization',
        headerPrefix: 'Bearer browser-secret',
      },
    }, user);

    expect(connectorAuthService.resolveRuntimeAuth).toHaveBeenCalledWith('user-1', expect.objectContaining({
      runtimeAuthConfig: { secretKey: 'playbook_mcp_ingress' },
    }));
    expect(connectorService.inspectMcp).toHaveBeenCalledWith(
      'streamable_http',
      'http://localhost:8025/mcp',
      {},
      undefined,
      undefined,
      expect.any(Object),
      undefined,
      {
        Authorization: 'Bearer server-secret',
        'X-YellowStorm-Tenant-Id': 'default',
        'X-YellowStorm-User-Id': 'user-1',
        'X-YellowStorm-Agent-Id': 'admin-connector-inspector',
        'X-YellowStorm-Conversation-Id': 'admin-connector-inspection',
        'X-Correlation-Id': 'admin-connector-inspection',
      },
    );
  });

  it.each([
    ['non-system connector', { isSystem: false }],
    ['different slug', { slug: 'external-mcp' }],
    ['credential auth', { authSourceType: 'credential' }],
    ['different server secret', { runtimeAuthConfig: { secretKey: 'other' } }],
  ])('does not send trusted identity headers to a %s', async (_name, override) => {
    const connector = { ...playbookConnector, ...override };
    const { controller, connectorService } = createController(connector);

    await controller.inspectMcp({
      connectorId: 'connector-1',
      transportType: 'streamable_http',
      serverUrl: connector.mcpServerUrl,
    }, user);

    const headers = connectorService.inspectMcp.mock.calls[0][7];
    expect(headers).toEqual({ Authorization: 'Bearer server-secret' });
    expect(headers).not.toHaveProperty('X-YellowStorm-User-Id');
  });
});
