import { ConnectorAuthServiceImpl } from './connector-auth.service';

describe('ConnectorAuthServiceImpl', () => {
  it('returns empty auth for any server_config secret key: MCP tokens are set on the connector', async () => {
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
      runtimeAuthConfig: { secretKey: 'playbook_mcp_ingress' },
    })).resolves.toEqual({ headers: {}, env: {} });
  });
});
