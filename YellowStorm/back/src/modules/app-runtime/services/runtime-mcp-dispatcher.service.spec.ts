import { ConfigService } from '@nestjs/config';
import { JsonRpcErrorCode } from '../mcp/runtime-mcp.errors';
import { RuntimeBrokerService } from './runtime-broker.service';
import { RuntimeMcpAuthService } from './runtime-mcp-auth.service';
import { RuntimeMcpDispatcherService } from './runtime-mcp-dispatcher.service';

describe('RuntimeMcpDispatcherService', () => {
  const resolveBinding = jest.fn();
  const dispatch = jest.fn();
  const auth = { resolveBinding } as unknown as RuntimeMcpAuthService;
  const broker = { dispatch } as unknown as RuntimeBrokerService;
  const config = {
    get: jest.fn((_key: string, fallback?: boolean) => fallback ?? true),
  } as unknown as ConfigService;

  const svc = new RuntimeMcpDispatcherService(auth, broker, config);

  beforeEach(() => jest.clearAllMocks());

  it('returns initialize payload', async () => {
    const response = await svc.handleRequest(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      undefined,
    );

    expect(response.result).toMatchObject({
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'yellowmind-runtime' },
    });
  });

  it('lists all runtime tools with schemas', async () => {
    const response = await svc.handleRequest(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      undefined,
    );

    const names = (response.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toContain('read');
    expect(names).toContain('finalize');
    expect(names.length).toBe(12);
  });

  it('dispatches tools/call through the broker', async () => {
    resolveBinding.mockResolvedValueOnce({
      bindingId: 'arb_1',
      workspaceId: 'sess_1',
      latestRevisionId: 'rev_0',
    });
    dispatch.mockResolvedValueOnce({
      result: { path: 'src/App.jsx', content: 'hello' },
    });

    const response = await svc.handleRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'read',
          arguments: { path: 'src/App.jsx' },
          toolCallId: 'tc_1',
        },
      },
      'Bearer token',
    );

    expect(resolveBinding).toHaveBeenCalledWith('Bearer token');
    expect(dispatch).toHaveBeenCalledWith(
      'read',
      { path: 'src/App.jsx' },
      expect.objectContaining({ bindingId: 'arb_1' }),
      'tc_1',
    );
    expect(response.result).toMatchObject({
      content: expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.any(String) }),
      ]),
    });
  });

  it('returns auth errors as JSON-RPC errors', async () => {
    const { AuthError } = await import('../mcp/runtime-mcp.errors');
    resolveBinding.mockRejectedValueOnce(new AuthError(401, 'Missing Authorization header'));

    const response = await svc.handleRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'read', arguments: { path: 'a.ts' } },
      },
      undefined,
    );

    expect(response.error).toEqual({
      code: 401,
      message: 'Missing Authorization header',
    });
  });

  it('returns method not found for unknown methods', async () => {
    const response = (await svc.handleRequest(
      { jsonrpc: '2.0', id: 5, method: 'unknown/method' },
      undefined,
    )) as { error?: { code: number } };

    expect(response.error?.code).toBe(JsonRpcErrorCode.METHOD_NOT_FOUND);
  });
});
