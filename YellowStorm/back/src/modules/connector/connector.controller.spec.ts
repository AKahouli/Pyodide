import { ConnectorController } from './connector.controller';
import { ConnectorService } from './connector.service';
import { BadRequestException } from '../exceptions';
import type { ConnectorRow } from './persistence/connector.store';

describe('ConnectorController MCP inspection (user)', () => {
  const user = { _id: { toString: () => 'user-1' }, id: { toString: () => 'user-1' } } as never;

  const stdioConnector = {
    id: 'connector-1',
    slug: 'legacy-stdio',
    isActive: true,
    authSourceType: 'credential',
    connectedAppKey: 'github',
    runtimeAuthConfig: {},
    mcpTransportType: 'stdio',
    mcpServerUrl: '/usr/local/bin/some-mcp',
    mcpServerConfig: {},
  } as unknown as ConnectorRow;

  function createController(connector: unknown = stdioConnector) {
    const connectedAppTokenService = { getValidToken: jest.fn() };
    // The REAL service runs so denials behave exactly as in production.
    const connectorService = new ConnectorService(
      { findById: jest.fn().mockResolvedValue(connector), insert: jest.fn() } as never,
      {} as never,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      connectedAppTokenService as never,
      {
        resolveRuntimeAuth: jest.fn().mockResolvedValue({ headers: {}, env: {} }),
        resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
      } as never,
      { syncConnectorActions: jest.fn() } as never,
    );
    const controller = new ConnectorController(
      connectorService as never,
      {} as never,
      {} as never,
      { buildAuthorizationUrl: jest.fn() } as never,
      { getRepositories: jest.fn() } as never,
    );
    return { controller, connectorService, connectedAppTokenService };
  }

  it('denies stored stdio connectors on POST /connectors/:id/inspect before any OAuth token fetch', async () => {
    const { controller, connectedAppTokenService } = createController();

    await expect(controller.inspectConnector('connector-1', user, { useOAuth: true } as never))
      .rejects.toBeInstanceOf(BadRequestException);

    // Zero auth side effects: the OAuth-active branch must never reach token retrieval.
    expect(connectedAppTokenService.getValidToken).not.toHaveBeenCalled();
  });

  it('denies unknown transports on POST /connectors/:id/inspect with zero auth side effects', async () => {
    const { controller, connectorService, connectedAppTokenService } = createController({
      ...stdioConnector,
      mcpTransportType: 'mystery-transport',
      mcpServerUrl: 'https://mcp.example.test/mcp',
    });
    const inspectMcp = jest.spyOn(connectorService, 'inspectMcp');

    await expect(controller.inspectConnector('connector-1', user, { useOAuth: true } as never))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(inspectMcp).not.toHaveBeenCalled();
    expect(connectedAppTokenService.getValidToken).not.toHaveBeenCalled();
  });
});
