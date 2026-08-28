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
});
