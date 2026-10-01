import { AdminConnectorController } from './admin-connector.controller';

describe('AdminConnectorController MCP inspection', () => {
  const user = { _id: { toString: () => 'user-1' } } as never;

  const playbookConnector = {
    id: 'connector-1',
    slug: 'mcp-playbook',
    isSystem: false,
    authSourceType: 'credential',
    connectedAppKey: '',
    runtimeAuthConfig: { strategy: 'http_header_bearer', headerName: 'Authorization', headerPrefix: 'Bearer' },
    mcpTransportType: 'streamable_http',
    mcpServerUrl: 'http://localhost:8025/mcp',
    mcpServerConfig: {},
  };
  const config = { get: jest.fn((key: string, fallback?: string) => (
    key === 'PLAYBOOK_MCP_SERVER_URL' ? 'http://localhost:8025/mcp/' : fallback
  )) };

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
      config as never,
    );
    return { controller, connectorService, connectorAuthService };
  }

  it('sends a complete actor envelope when the connector points at a trusted internal MCP server, whatever its slug', async () => {
    const { controller, connectorService } = createController();

    await controller.inspectMcp({
      connectorId: 'connector-1',
      transportType: 'streamable_http',
      serverUrl: 'http://localhost:8025/mcp',
    }, user);

    expect(connectorService.inspectMcp).toHaveBeenCalledWith(
      'streamable_http',
      'http://localhost:8025/mcp',
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      {
        Authorization: 'Bearer server-secret',
        'X-YellowStorm-User-Id': 'user-1',
        'X-YellowStorm-Agent-Id': 'admin-connector-inspector',
        'X-YellowStorm-Conversation-Id': 'admin-connector-inspection',
        'X-Correlation-Id': 'admin-connector-inspection',
      },
    );
  });

  it.each([
    ['an untrusted server', { mcpServerUrl: 'https://example.com/mcp' }],
    ['a reused slug on another server', { slug: 'playbook-mcp', isSystem: true, mcpServerUrl: 'https://example.com/mcp' }],
  ])('does not send identity headers to %s', async (_name, override) => {
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
