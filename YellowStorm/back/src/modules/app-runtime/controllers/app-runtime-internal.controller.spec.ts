import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '@modules/auth/decorators/public.decorator';
import { InternalServiceGuard } from '@modules/auth/guards/internal-service.guard';
import { SKIP_RESPONSE_WRAP_KEY } from '@modules/response/decorators/skip-response-wrap.decorator';
import { AppRuntimeErrorCodes } from '../constants/app-runtime-error-codes';
import { RuntimeBindingService } from '../services/runtime-binding.service';
import { RuntimeToolDispatcherService } from '../services/runtime-tool-dispatcher.service';
import { AppRuntimeInternalController } from './app-runtime-internal.controller';

describe('AppRuntimeInternalController', () => {
  const bind = jest.fn();
  const invoke = jest.fn();
  const controller = new AppRuntimeInternalController(
    { bind } as unknown as RuntimeBindingService,
    { invoke } as unknown as RuntimeToolDispatcherService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('is service-authenticated and bypasses the user JWT guard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AppRuntimeInternalController,
    ) as unknown[];

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AppRuntimeInternalController)).toBe(true);
    expect(guards).toContain(InternalServiceGuard);
  });

  it('returns the raw body so the gateway can read bindingId directly', () => {
    expect(
      Reflect.getMetadata(SKIP_RESPONSE_WRAP_KEY, AppRuntimeInternalController),
    ).toBe(true);
  });

  it('delegates bind to the binding service and leaks no token hash', async () => {
    bind.mockResolvedValueOnce({
      bindingId: 'arb_aabbccddeeff',
      workspaceId: 'sess_1',
      latestRevisionId: 'rev_0',
      mcpUrl: 'http://apimanus:8000/api/v1/opencode/runtime-mcp',
      mcpToken: 'plaintext-token',
    });

    const result = await controller.bind({
      conversationSessionId: 'sess_1',
      userId: 'user_1',
    });

    expect(bind).toHaveBeenCalledWith({
      conversationSessionId: 'sess_1',
      userId: 'user_1',
    });
    expect(Object.keys(result).sort()).toEqual([
      'bindingId',
      'latestRevisionId',
      'mcpToken',
      'mcpUrl',
      'workspaceId',
    ]);
  });

  it('forwards a tool invocation to the dispatcher', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      toolCallId: 'tc_1',
      result: { path: 'a.ts' },
    });

    const dto = {
      workspaceId: 'sess_1',
      toolCallId: 'tc_1',
      tool: 'read',
      arguments: { path: 'a.ts' },
    };
    await expect(controller.invokeTool(dto)).resolves.toEqual({
      ok: true,
      toolCallId: 'tc_1',
      result: { path: 'a.ts' },
    });
    expect(invoke).toHaveBeenCalledWith(dto);
  });

  it('returns a typed offline error in the body rather than as an HTTP status', async () => {
    invoke.mockResolvedValueOnce({
      ok: false,
      toolCallId: 'tc_1',
      error: {
        code: AppRuntimeErrorCodes.RUNTIME_OFFLINE,
        message: 'No browser runtime is connected for this workspace',
      },
    });

    const result = await controller.invokeTool({
      workspaceId: 'sess_1',
      toolCallId: 'tc_1',
      tool: 'read',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: AppRuntimeErrorCodes.RUNTIME_OFFLINE },
    });
  });
});
