import { AdminConnectorController } from './admin-connector.controller';
import { ConnectorService } from './connector.service';
import { BadRequestException, ErrorCode } from '../exceptions';
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
    const connectorAdminAuthService = { getValidToken: jest.fn() };
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
      { logSuccess: jest.fn() } as never,
      connectorAdminAuthService as never,
      connectorAuthService as never,
      config as never,
    );
    return { controller, connectorService, connectorAuthService, connectorAdminAuthService, store };
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
    const { controller, store, connectorAdminAuthService, connectorAuthService } = createController({
      ...playbookConnector,
      mcpTransportType: 'stdio',
      mcpServerUrl: '/usr/local/bin/some-mcp',
    });

    await expect(controller.inspectConnector('connector-1', user, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(store.insert).not.toHaveBeenCalled();
    // Denial happens before any credential resolution or token refresh.
    expect(connectorAdminAuthService.getValidToken).not.toHaveBeenCalled();
    expect(connectorAuthService.resolveRuntimeAuth).not.toHaveBeenCalled();
  });

  it('denies OAuth-active stdio inspections on :id/inspect before token retrieval', async () => {
    // Non-empty connectedAppKey: without the transport guard the useOAuth
    // branch would proceed to token retrieval, so only the ERR_3102 guard can
    // produce this denial.
    const { controller, connectorAdminAuthService } = createController({
      ...playbookConnector,
      mcpTransportType: 'stdio',
      mcpServerUrl: '/usr/local/bin/some-mcp',
      connectedAppKey: 'github',
    });

    const denial = controller.inspectConnector('connector-1', user, { useOAuth: true } as never);
    await expect(denial).rejects.toBeInstanceOf(BadRequestException);
    await expect(denial).rejects.toMatchObject({ code: ErrorCode.CONNECTOR_MCP_TRANSPORT_UNSUPPORTED });
    // The useOAuth branch must never reach admin token retrieval.
    expect(connectorAdminAuthService.getValidToken).not.toHaveBeenCalled();
  });

  it('denies stdio connectors on the admin inspect endpoint before OAuth token retrieval', async () => {
    const { controller, connectorAdminAuthService, connectorAuthService } = createController({
      ...playbookConnector,
      mcpTransportType: 'stdio',
      mcpServerUrl: '/usr/local/bin/some-mcp',
    });

    await expect(controller.inspectMcp({
      connectorId: 'connector-1',
      // The DTO whitelist would already reject this at the HTTP boundary; the
      // controller guard must also reject it before token retrieval.
      transportType: 'stdio' as never,
      serverUrl: '/usr/local/bin/some-mcp',
      connectedAppKey: 'github',
    }, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(connectorAdminAuthService.getValidToken).not.toHaveBeenCalled();
    expect(connectorAuthService.resolveRuntimeAuth).not.toHaveBeenCalled();
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
