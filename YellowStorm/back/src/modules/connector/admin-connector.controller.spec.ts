import { AdminConnectorController } from './admin-connector.controller';
import { ConnectorService } from './connector.service';
import { BadRequestException } from '../exceptions';
import type { ConnectorRow } from './persistence/connector.store';

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
  } as unknown as ConnectorRow;
  const config = { get: jest.fn((key: string, fallback?: string) => (
    key === 'PLAYBOOK_MCP_SERVER_URL' ? 'http://localhost:8025/mcp/' : fallback
  )) };

  function createController(connector: unknown = playbookConnector) {
    const connectorAuthService = {
      resolveRuntimeAuth: jest.fn().mockResolvedValue({
        headers: { Authorization: 'Bearer server-secret' },
        env: {},
      }),
    };
    const store = {
      findById: jest.fn().mockResolvedValue(connector),
      findByIds: jest.fn().mockResolvedValue(connector ? [connector] : []),
      insert: jest.fn(),
    };
    // The REAL service runs so stdio/unknown transports are denied exactly as
    // in production; individual tests may spy inspectMcp for call-shape checks.
    const connectorService = new ConnectorService(
      store as never,
      {} as never,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
      connectorAuthService as never,
      { syncConnectorActions: jest.fn() } as never,
    );
    const controller = new AdminConnectorController(
      connectorService as never,
      {} as never,
      {} as never,
      connectorAuthService as never,
      config as never,
    );
    return { controller, connectorService, connectorAuthService, store };
  }

  it('sends a complete actor envelope when the connector points at a trusted internal MCP server, whatever its slug', async () => {
    const { controller, connectorService } = createController();
    const inspectMcp = jest.spyOn(connectorService, 'inspectMcp')
      .mockResolvedValue({ serverName: 'playbook', tools: [] });

    await controller.inspectMcp({
      connectorId: 'connector-1',
      transportType: 'streamable_http',
      serverUrl: 'http://localhost:8025/mcp',
    }, user);

    expect(inspectMcp).toHaveBeenCalledWith(
      'streamable_http',
      'http://localhost:8025/mcp',
      {},
      'user-1',
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
    const inspectMcp = jest.spyOn(connectorService, 'inspectMcp')
      .mockResolvedValue({ serverName: 'playbook', tools: [] });

    await controller.inspectMcp({
      connectorId: 'connector-1',
      transportType: 'streamable_http',
      serverUrl: (connector as { mcpServerUrl: string }).mcpServerUrl,
    }, user);

    const headers = inspectMcp.mock.calls[0][7];
    expect(headers).toEqual({ Authorization: 'Bearer server-secret' });
    expect(headers).not.toHaveProperty('X-YellowStorm-User-Id');
  });

  it('denies stored stdio connectors on :id/inspect before any inspection side effect', async () => {
    const { controller, store } = createController({
      ...playbookConnector,
      mcpTransportType: 'stdio',
      mcpServerUrl: '/usr/local/bin/some-mcp',
    });

    await expect(controller.inspectConnector('connector-1', user, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(store.insert).not.toHaveBeenCalled();
  });

  it('denies stdio transports on the admin draft import endpoint without creating a connector', async () => {
    const { controller, store } = createController(null);

    await expect(controller.importFromMcp(
      { transportType: 'stdio', serverUrl: '/usr/local/bin/some-mcp' },
      user,
      { ip: '127.0.0.1', headers: {} } as never,
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(store.insert).not.toHaveBeenCalled();
  });
});
