import { ConfigService } from '@nestjs/config';
import { JsonRpcErrorCode, McpError } from '../mcp/runtime-mcp.errors';
import type { RuntimeBindingRecord as AppRuntimeBinding } from '../persistence/runtime-binding.store';
import { RuntimeBrokerService } from './runtime-broker.service';
import { RuntimeToolDispatcherService } from './runtime-tool-dispatcher.service';
import { AppRuntimeConversationNotifierService } from './app-runtime-conversation-notifier.service';

describe('RuntimeBrokerService', () => {
  const invoke = jest.fn();
  const dispatcher = { invoke } as unknown as RuntimeToolDispatcherService;
  const config = {
    get: jest.fn((_key: string, fallback?: number) => fallback ?? 180_000),
  } as unknown as ConfigService;

  const notifyFinalize = jest.fn().mockResolvedValue(undefined);
  const conversationNotifier = {
    notifyFinalize,
  } as unknown as AppRuntimeConversationNotifierService;

  const broker = new RuntimeBrokerService(dispatcher, config, conversationNotifier);

  const binding = (): AppRuntimeBinding =>
    ({
      bindingId: 'arb_1',
      workspaceId: 'sess_1',
      userId: 'user_1',
      latestRevisionId: 'rev_0',
    }) as AppRuntimeBinding;

  beforeEach(() => jest.clearAllMocks());

  it('rejects unknown tools before dispatch', async () => {
    await expect(
      broker.dispatch('not_a_tool', {}, binding(), 'tc_1'),
    ).rejects.toMatchObject({ message: expect.stringContaining('Unknown tool') });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('dispatches read and returns dispatcher result', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      toolCallId: 'tc_read',
      result: { path: 'src/App.jsx', content: 'hello' },
    });

    const outcome = await broker.dispatch(
      'read',
      { path: 'src/App.jsx' },
      binding(),
      'tc_read',
    );

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'sess_1',
        tool: 'read',
        toolCallId: 'tc_read',
        baseRevisionId: 'rev_0',
      }),
    );
    expect(outcome.result).toEqual({ path: 'src/App.jsx', content: 'hello' });
  });

  it('requires verification.build before finalize dispatch', async () => {
    await expect(
      broker.dispatch(
        'finalize',
        { verification: { preview: 'ok' } },
        binding(),
        'tc_fin',
      ),
    ).rejects.toBeInstanceOf(McpError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects finalize when preview is not healthy after dispatch', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      toolCallId: 'tc_fin',
      result: { revisionId: 'rev_1', preview: { healthy: false } },
    });

    await expect(
      broker.dispatch(
        'finalize',
        {
          title: 'My App',
          verification: { build: 'npm run build exit 0' },
        },
        binding(),
        'tc_fin',
      ),
    ).rejects.toMatchObject({
      code: JsonRpcErrorCode.INVALID_PARAMS,
      message: expect.stringContaining('healthy preview'),
    });
  });

  it('pushes application_component after successful finalize', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      toolCallId: 'tc_fin',
      result: {
        revisionId: 'rev_3',
        cephManifestPath: 'appbuilder/manifests/sess_1/rev_3.json',
        preview: { healthy: true },
        fileTree: { name: '/', type: 'dir', children: [{ name: 'App.jsx', type: 'file' }] },
      },
    });

    const args = {
      title: 'Shop',
      verification: { build: 'npm run build exit 0', preview: 'ok', tests: '' },
    };
    const b = binding();
    const outcome = await broker.dispatch('finalize', args, b, 'tc_fin');

    expect(outcome.result?.revisionId).toBe('rev_3');
    expect(notifyFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: 'arb_1', workspaceId: 'sess_1' }),
      expect.objectContaining({
        title: 'Shop',
        revisionId: 'rev_0',
        verification: args.verification,
      }),
      expect.objectContaining({ revisionId: 'rev_3' }),
    );
  });

  it('updates binding revision after mutating tools', async () => {
    const b = binding();
    invoke.mockResolvedValueOnce({
      ok: true,
      toolCallId: 'tc_write',
      result: { path: 'a.ts', revisionId: 'rev_1' },
    });

    await broker.dispatch('write', { path: 'a.ts', content: 'x' }, b, 'tc_write');

    expect(b.latestRevisionId).toBe('rev_1');
  });

  it('maps dispatcher errors onto broker errors', async () => {
    invoke.mockResolvedValueOnce({
      ok: false,
      toolCallId: 'tc_1',
      error: { code: -32002, message: 'Runtime offline' },
    });

    const outcome = await broker.dispatch('read', { path: 'a.ts' }, binding(), 'tc_1');

    expect(outcome.error).toEqual({
      code: -32002,
      message: 'Runtime offline',
      data: undefined,
    });
  });
});
