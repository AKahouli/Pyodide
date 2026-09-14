import { ConnectorAuthServiceImpl } from './connector-auth.service';

describe('ConnectorAuthServiceImpl', () => {
  it('uses bearer authentication for the Playbook MCP server secret', async () => {
    const service = new ConnectorAuthServiceImpl(
      {} as never,
      {} as never,
      {} as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
      { get: jest.fn().mockReturnValue('ingress-secret') } as never,
    );

    await expect(service.resolveRuntimeAuth('user-1', {
      authSourceType: 'server_config',
      connectedAppKey: '',
      runtimeAuthConfig: { secretKey: 'playbook_mcp_ingress' },
    })).resolves.toEqual({
      headers: { Authorization: 'Bearer ingress-secret' },
      env: {},
    });
  });

  it('uses bearer authentication for the Agent MCP server secret', async () => {
    const configGet = jest.fn().mockImplementation((key: string) => (
      key === 'agentMcp.mcpIngressToken' ? 'agent-ingress-secret' : ''
    ));
    const service = new ConnectorAuthServiceImpl(
      {} as never,
      {} as never,
      {} as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
      { get: configGet } as never,
    );

    await expect(service.resolveRuntimeAuth('user-1', {
      authSourceType: 'server_config',
      connectedAppKey: '',
      runtimeAuthConfig: { secretKey: 'agent_mcp_ingress' },
    })).resolves.toEqual({
      headers: { Authorization: 'Bearer agent-ingress-secret' },
      env: {},
    });
  });

  it('returns empty auth for an unknown server_config secret key', async () => {
    const service = new ConnectorAuthServiceImpl(
      {} as never,
      {} as never,
      {} as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
      { get: jest.fn() } as never,
    );

    await expect(service.resolveRuntimeAuth('user-1', {
      authSourceType: 'server_config',
      connectedAppKey: '',
      runtimeAuthConfig: { secretKey: 'unknown_secret' },
    })).resolves.toEqual({ headers: {}, env: {} });
  });
});
