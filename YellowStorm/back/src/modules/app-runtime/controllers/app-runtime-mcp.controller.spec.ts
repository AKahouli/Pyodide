import { IS_PUBLIC_KEY } from '@modules/auth/decorators/public.decorator';
import { SKIP_RESPONSE_WRAP_KEY } from '@modules/response/decorators/skip-response-wrap.decorator';
import { ServiceUnavailableException } from '@nestjs/common';
import { RuntimeMcpDispatcherService } from '../services/runtime-mcp-dispatcher.service';
import { AppRuntimeMcpController } from './app-runtime-mcp.controller';

describe('AppRuntimeMcpController', () => {
  const handleRequest = jest.fn();
  const isEnabled = jest.fn().mockReturnValue(true);
  const dispatcher = {
    handleRequest,
    isEnabled,
  } as unknown as RuntimeMcpDispatcherService;

  const controller = new AppRuntimeMcpController(dispatcher);

  beforeEach(() => jest.clearAllMocks());

  it('is public and skips the global response wrapper', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AppRuntimeMcpController)).toBe(true);
    expect(Reflect.getMetadata(SKIP_RESPONSE_WRAP_KEY, AppRuntimeMcpController)).toBe(true);
  });

  it('delegates JSON-RPC bodies to the dispatcher', async () => {
    handleRequest.mockResolvedValueOnce({ jsonrpc: '2.0', id: 1, result: { ok: true } });

    const response = await controller.runtimeMcp(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      'Bearer token',
    );

    expect(handleRequest).toHaveBeenCalledWith(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      'Bearer token',
    );
    expect(response).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  });

  it('returns 503 when MCP is disabled', async () => {
    isEnabled.mockReturnValueOnce(false);

    await expect(
      controller.runtimeMcp({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
