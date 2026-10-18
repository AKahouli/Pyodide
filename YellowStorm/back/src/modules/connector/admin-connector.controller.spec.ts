import { AdminConnectorController } from './admin-connector.controller';
import { ConnectorService } from './connector.service';
import { BadRequestException, ErrorCode } from '../exceptions';
import { McpDestinationPolicyError } from './utils/mcp-destination-policy.util';
import type { ConnectorRow } from './persistence/connector.store';

const assertMcpDestinationAllowed = jest.fn<Promise<string[]>, [string]>();

// Hermetic like connector.service.spec: the pre-check wiring is stubbed so
// trusted/untrusted header tests stay DNS-free; the policy's decision logic
// has its own suite and the denial tests below override the stub.
jest.mock('./utils/mcp-destination-policy.util', () => ({
  ...jest.requireActual('./utils/mcp-destination-policy.util'),
  assertMcpDestinationAllowed: (...args: unknown[]) => assertMcpDestinationAllowed(...(args as [string])),
}));

describe('AdminConnectorController MCP inspection', () => {
  const user = { _id: { toString: () => 'user-1' } } as never;

  beforeEach(() => {
    assertMcpDestinationAllowed.mockReset();
    assertMcpDestinationAllowed.mockResolvedValue([]);
  });

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
    key === 'PLAYBOOK_MCP_SERVER_URL' ? 'http://localhost:8025/mcp/'
      : key === 'TRUSTED_MCP_SERVER_URLS' ? 'http://localhost:8099/mcp'
      : fallback
  )) };

  function createController(connector: unknown = playbookConnector) {
    const connectorAuthService = {
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
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

  it('does not confer naked identity authority from an environment-trusted URL', async () => {
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
      },
      'connector-1',
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

  it.each([undefined, [], [{ headerName: 'X-user-id', source: 'user_id', enabled: true }]])(
    'resolves saved/draft identity headers with an isolated inspection session (%j)', async (draft) => {
      const saved = [{ headerName: 'X-user-id', source: 'user_id', enabled: true }];
      const { controller, connectorService, connectorAuthService } = createController({
        ...playbookConnector, mcpServerUrl: 'http://localhost:8099/mcp', dynamicHeaders: saved,
      });
      connectorAuthService.resolveDynamicHeaders.mockResolvedValue(draft?.length === 0 ? {} : { 'X-user-id': 'user-1' });
      const inspect = jest.spyOn(connectorService, 'inspectMcp').mockResolvedValue({ serverName: '', tools: [] });
      await controller.inspectMcp({ connectorId: 'connector-1', transportType: 'streamable_http', serverUrl: 'http://localhost:8099/mcp', dynamicHeaders: draft as never }, user);
      expect(connectorAuthService.resolveDynamicHeaders).toHaveBeenCalledWith('user-1', draft ?? saved);
      const headers = inspect.mock.calls[0][7];
      if (draft?.length === 0) {
        expect(headers).not.toHaveProperty('x-conversation-id');
      } else {
        expect(headers).toEqual(expect.objectContaining({ 'X-user-id': 'user-1', 'x-conversation-id': expect.stringMatching(/^admin-connector-inspection-/) }));
      }
    },
  );

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

  it('denies a blocked destination before OAuth token retrieval or runtime auth resolution (WP-05)', async () => {
    const { controller, connectorAdminAuthService, connectorAuthService } = createController({
      ...playbookConnector,
      mcpServerUrl: 'https://metadata.internal/mcp',
    });
    assertMcpDestinationAllowed.mockRejectedValue(new McpDestinationPolicyError('forbidden_address', 'metadata.internal'));

    await expect(controller.inspectMcp({
      connectorId: 'connector-1',
      transportType: 'streamable_http',
      serverUrl: 'https://metadata.internal/mcp',
      connectedAppKey: 'github',
    } as never, user)).rejects.toMatchObject({ code: ErrorCode.CONNECTOR_MCP_DESTINATION_BLOCKED });
    expect(connectorAdminAuthService.getValidToken).not.toHaveBeenCalled();
    expect(connectorAuthService.resolveRuntimeAuth).not.toHaveBeenCalled();
  });

  it('denies a blocked draft destination before any credential resolution (WP-05)', async () => {
    const { controller, connectorAdminAuthService, connectorAuthService } = createController(null);
    assertMcpDestinationAllowed.mockRejectedValue(new McpDestinationPolicyError('forbidden_address', '169.254.169.254'));

    await expect(controller.inspectMcp({
      transportType: 'streamable_http',
      serverUrl: 'https://169.254.169.254/mcp',
      connectedAppKey: 'github',
    }, user)).rejects.toMatchObject({ code: ErrorCode.CONNECTOR_MCP_DESTINATION_BLOCKED });
    expect(connectorAdminAuthService.getValidToken).not.toHaveBeenCalled();
    expect(connectorAuthService.resolveDynamicHeaders).not.toHaveBeenCalled();
  });

  it('runs the destination pre-check on :id/inspect before OAuth token retrieval (WP-05)', async () => {
    const { controller, connectorAdminAuthService } = createController({
      ...playbookConnector,
      mcpServerUrl: 'https://metadata.internal/mcp',
    });
    assertMcpDestinationAllowed.mockRejectedValue(new McpDestinationPolicyError('forbidden_address', 'metadata.internal'));

    await expect(controller.inspectConnector('connector-1', user, {})).rejects.toMatchObject({
      code: ErrorCode.CONNECTOR_MCP_DESTINATION_BLOCKED,
    });
    expect(connectorAdminAuthService.getValidToken).not.toHaveBeenCalled();
  });

  it('keeps an exact configured internal endpoint inspectable without OAuth side effects (WP05.5)', async () => {
    const { controller, connectorService, store } = createController();
    const inspectMcp = jest.spyOn(connectorService, 'inspectMcp')
      .mockResolvedValue({ serverName: 'playbook', tools: [] });

    await controller.inspectMcp({
      connectorId: 'connector-1',
      transportType: 'streamable_http',
      serverUrl: 'http://localhost:8025/mcp',
    }, user);

    expect(inspectMcp).toHaveBeenCalled();
    expect(store.findById).toHaveBeenCalledWith('connector-1');
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

  it('persists only nonsecret import audit fields even when a legacy mock returns an unsafe endpoint', async () => {
    const audit = { logSuccess: jest.fn() };
    const service = { importFromMcp: jest.fn().mockResolvedValue({ serverName: 'safe', tools: [] }) };
    const controller = new AdminConnectorController(service as never, audit as never,
      {} as never, {} as never, config as never);
    await controller.importFromMcp({ transportType: 'streamable_http',
      serverUrl: 'https://mcp.example.test/mcp?arbitrary=TEST_CANARY_R03',
    }, user, { ip: '127.0.0.1', headers: {} } as never);
    expect(audit.logSuccess).toHaveBeenCalledWith(expect.objectContaining({ metadata: { toolCount: 0 } }));
    expect(JSON.stringify(audit.logSuccess.mock.calls)).not.toContain('TEST_CANARY_R03');
    expect(JSON.stringify(audit.logSuccess.mock.calls)).not.toContain('serverUrl');
  });
});
