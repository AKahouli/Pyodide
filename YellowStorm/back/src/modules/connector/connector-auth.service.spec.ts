import { ConnectorAuthServiceImpl } from './connector-auth.service';

describe('ConnectorAuthServiceImpl', () => {
  const create = (credential: unknown = null) => new ConnectorAuthServiceImpl(
    {} as never, { findActiveByConnectorId: jest.fn().mockResolvedValue(credential) } as never,
    {} as never, { setContext: jest.fn(), warn: jest.fn() } as never,
    { get: jest.fn() } as never,
  );

  it('uses the explicitly saved bearer value once when no per-user credential exists', async () => {
    const service = create();
    await expect(service.resolveRuntimeAuth('user-1', { connectorId: 'connector-1',
      authSourceType: 'credential', connectedAppKey: '',
      runtimeAuthConfig: { strategy: 'custom_headers', headerMappings: { Authorization: 'Bearer saved-test-token' } },
    })).resolves.toEqual({ headers: { Authorization: 'Bearer saved-test-token' }, env: {} });
  });

  it('never appends a user token to a literal saved bearer header', async () => {
    await expect(create({ status: 'active', authPayload: { token: 'different-user-token' } }).resolveRuntimeAuth('user-1', {
      connectorId: 'connector-1', authSourceType: 'credential', connectedAppKey: '',
      runtimeAuthConfig: { strategy: 'custom_headers', headerMappings: { Authorization: 'Bearer saved-test-token' } },
    })).resolves.toEqual({ headers: { Authorization: 'Bearer saved-test-token' }, env: {} });
  });

  it('does not emit an unresolved user-token template as a static credential', async () => {
    await expect(create().resolveRuntimeAuth('user-1', { connectorId: 'connector-1', authSourceType: 'credential', connectedAppKey: '',
      runtimeAuthConfig: { strategy: 'custom_headers', headerMappings: { Authorization: 'Bearer {token}' } },
    })).resolves.toEqual({ headers: {}, env: {} });
  });

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

  it('does not put arbitrary provider errors or error names in connector auth telemetry', async () => {
    const error = new Error('https://mcp.example.test/mcp?token=TEST_CANARY_R03');
    error.name = 'TEST_CANARY_R03';
    const logger = { setContext: jest.fn(), warn: jest.fn() };
    const service = new ConnectorAuthServiceImpl({ getValidToken: jest.fn().mockRejectedValue(error) } as never,
      {} as never, {} as never, logger as never);
    await expect(service.resolveRuntimeAuth('user-1', { authSourceType: 'connected_app', connectedAppKey: 'microsoft',
      runtimeAuthConfig: { strategy: 'http_header_bearer' },
    })).resolves.toEqual({ headers: {}, env: {} });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('TEST_CANARY_R03');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('https://');
  });
});
