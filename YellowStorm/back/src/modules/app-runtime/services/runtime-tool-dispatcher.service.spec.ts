import { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import { AppRuntimeErrorCodes } from '../constants/app-runtime-error-codes';
import type { AppRuntimeToolCallDocument } from '../schemas/app-runtime-tool-call.schema';
import type { ToolInvokeEnvelope } from '../types/app-runtime-protocol';
import { RuntimeBindingService } from './runtime-binding.service';
import { RuntimeConnectionRegistry } from './runtime-connection.registry';
import { RuntimeToolDispatcherService } from './runtime-tool-dispatcher.service';

const CONFIG = {
  'appRuntime.heartbeatTimeoutMs': 45_000,
  'appRuntime.mutationWaitMs': 30_000,
  'appRuntime.toolTimeoutMs': 5_000,
} as Record<string, number>;

const BINDING = {
  bindingId: 'arb_1',
  workspaceId: 'sess_1',
  latestRevisionId: 'rev_0',
};

const asFailure = (envelope: ToolInvokeEnvelope) => {
  if (envelope.ok) throw new Error('expected a failed envelope');
  return envelope.error;
};

describe('RuntimeToolDispatcherService', () => {
  let dispatcher: RuntimeToolDispatcherService;
  let registry: RuntimeConnectionRegistry;
  let socket: Socket & { emit: jest.Mock };

  const findOne = jest.fn();
  const updateOne = jest.fn();
  const findByWorkspaceId = jest.fn();
  const markWaitingForBrowser = jest.fn();
  const updateRevision = jest.fn();
  const revisionExists = jest.fn().mockResolvedValue(true);

  const config = {
    get: jest.fn((key: string, fallback?: number) => CONFIG[key] ?? fallback),
  } as unknown as ConfigService;

  /** Answer the next `tool.invoke` as the browser would. */
  const browserAnswers = (
    outcome:
      | { ok: true; result: Record<string, unknown> }
      | { ok: false; error: { code: number; message: string } },
  ): void => {
    socket.emit.mockImplementation((event: string, payload: { toolCallId: string }) => {
      if (event !== 'tool.invoke') return;
      setImmediate(() =>
        outcome.ok
          ? dispatcher.handleCompleted('sess_1', {
              toolCallId: payload.toolCallId,
              result: outcome.result,
            })
          : dispatcher.handleFailed('sess_1', {
              toolCallId: payload.toolCallId,
              error: outcome.error,
            }),
      );
    });
  };

  const connect = (overrides: { capabilities?: object; revisionId?: string } = {}) =>
    registry.register({
      socket,
      runtimeSessionId: 'rts_1',
      bindingId: 'arb_1',
      workspaceId: 'sess_1',
      userId: 'user_1',
      capabilities: overrides.capabilities ?? {
        filesystem: true,
        npm: true,
        previewInspection: true,
      },
      revisionId: overrides.revisionId ?? 'rev_0',
    });

  beforeEach(() => {
    jest.clearAllMocks();

    findOne.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) });
    updateOne.mockReturnValue({ exec: () => Promise.resolve(undefined) });
    findByWorkspaceId.mockResolvedValue(BINDING);

    socket = { id: 's1', emit: jest.fn(), disconnect: jest.fn() } as unknown as Socket & {
      emit: jest.Mock;
    };
    registry = new RuntimeConnectionRegistry(config);

    dispatcher = new RuntimeToolDispatcherService(
      { findOne, updateOne } as unknown as import('mongoose').Model<AppRuntimeToolCallDocument>,
      {
        findByWorkspaceId,
        markWaitingForBrowser,
        updateRevision,
      } as unknown as RuntimeBindingService,
      registry,
      { revisionExists } as unknown as import('./runtime-revision.service').RuntimeRevisionService,
      config,
    );
  });

  it('dispatches to the browser and returns its result', async () => {
    connect();
    browserAnswers({ ok: true, result: { path: 'app.tsx', content: 'x' } });

    const envelope = await dispatcher.invoke({
      workspaceId: 'sess_1',
      toolCallId: 'tc_1',
      tool: 'read',
      arguments: { path: 'app.tsx' },
    });

    expect(envelope).toEqual({
      ok: true,
      toolCallId: 'tc_1',
      result: { path: 'app.tsx', content: 'x' },
      revisionId: undefined,
    });

    const [event, payload] = socket.emit.mock.calls[0];
    expect(event).toBe('tool.invoke');
    expect(payload).toMatchObject({
      toolCallId: 'tc_1',
      workspaceId: 'sess_1',
      tool: 'read',
      arguments: { path: 'app.tsx' },
      baseRevisionId: 'rev_0',
    });
  });

  describe('runtime availability', () => {
    it('fails with RUNTIME_OFFLINE when no browser is connected', async () => {
      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'read',
      });

      expect(asFailure(envelope).code).toBe(AppRuntimeErrorCodes.RUNTIME_OFFLINE);
      expect(markWaitingForBrowser).toHaveBeenCalledWith('sess_1');
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('fails with RUNTIME_OFFLINE when the heartbeat has timed out', async () => {
      connect();
      registry.get('sess_1')!.lastHeartbeatAt = Date.now() - 60_000;

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'read',
      });

      expect(asFailure(envelope).code).toBe(AppRuntimeErrorCodes.RUNTIME_OFFLINE);
      expect(markWaitingForBrowser).toHaveBeenCalledWith('sess_1');
    });

    it('fails pending calls when the browser disconnects mid-flight', async () => {
      connect();
      socket.emit.mockImplementation((event: string) => {
        if (event !== 'tool.invoke') return;
        setImmediate(() =>
          dispatcher.failPendingForWorkspace('sess_1', 'Browser runtime disconnected'),
        );
      });

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'read',
      });

      expect(asFailure(envelope).code).toBe(AppRuntimeErrorCodes.RUNTIME_OFFLINE);
    });
  });

  describe('capabilities', () => {
    it('fails with UNSUPPORTED_CAPABILITY without starting a microVM', async () => {
      connect({ capabilities: { filesystem: true, npm: false } });

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'run',
        arguments: { command: 'npm run build' },
      });

      expect(asFailure(envelope)).toEqual({
        code: AppRuntimeErrorCodes.UNSUPPORTED_CAPABILITY,
        message: expect.stringContaining('npm'),
        data: { requiredCapability: 'npm', fallbackAvailable: false },
      });
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('relays a capability error raised by the browser itself', async () => {
      connect();
      browserAnswers({
        ok: false,
        error: {
          code: AppRuntimeErrorCodes.UNSUPPORTED_CAPABILITY,
          message: 'native binary required',
        },
      });

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'run',
        arguments: { command: './bin/native' },
      });

      expect(asFailure(envelope)).toMatchObject({
        code: AppRuntimeErrorCodes.UNSUPPORTED_CAPABILITY,
        message: 'native binary required',
      });
    });
  });

  describe('revision guard', () => {
    it('requests rehydration and refuses a mutation on a stale filesystem', async () => {
      connect({ revisionId: 'rev_0' });
      findByWorkspaceId.mockResolvedValue({ ...BINDING, latestRevisionId: 'rev_4' });
      revisionExists.mockResolvedValueOnce(true);

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'write',
        arguments: { path: 'a.ts', content: 'x' },
      });

      expect(asFailure(envelope)).toEqual({
        code: AppRuntimeErrorCodes.REVISION_CONFLICT,
        message: expect.any(String),
        data: { expectedRevisionId: 'rev_4', actualRevisionId: 'rev_0' },
      });
      expect(socket.emit).toHaveBeenCalledWith('runtime.rehydrate', {
        workspaceId: 'sess_1',
        expectedRevisionId: 'rev_4',
        actualRevisionId: 'rev_0',
      });
      expect(socket.emit).not.toHaveBeenCalledWith('tool.invoke', expect.anything());
    });

    it('refuses rehydrate when the expected revision is not persisted yet', async () => {
      connect({ revisionId: 'rev_0' });
      findByWorkspaceId.mockResolvedValue({ ...BINDING, latestRevisionId: 'rev_4' });
      revisionExists.mockResolvedValueOnce(false);

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'write',
        arguments: { path: 'a.ts', content: 'x' },
      });

      expect(asFailure(envelope)).toEqual({
        code: AppRuntimeErrorCodes.REVISION_CONFLICT,
        message: expect.stringContaining('not yet available'),
        data: { expectedRevisionId: 'rev_4', actualRevisionId: 'rev_0' },
      });
      expect(socket.emit).not.toHaveBeenCalledWith('runtime.rehydrate', expect.anything());
    });

    it('lets a read through on a stale filesystem', async () => {
      connect({ revisionId: 'rev_0' });
      findByWorkspaceId.mockResolvedValue({ ...BINDING, latestRevisionId: 'rev_4' });
      browserAnswers({ ok: true, result: { path: 'a.ts' } });

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'read',
      });

      expect(envelope.ok).toBe(true);
    });
  });

  describe('mutations', () => {
    it('advances the binding revision and realigns the browser', async () => {
      connect();
      browserAnswers({ ok: true, result: { revisionId: 'rev_1', path: 'a.ts' } });

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'write',
        arguments: { path: 'a.ts', content: 'x' },
      });

      expect(envelope).toMatchObject({ ok: true, revisionId: 'rev_1' });
      expect(updateRevision).toHaveBeenCalledWith('sess_1', 'rev_1');
      expect(registry.get('sess_1')?.revisionId).toBe('rev_1');
    });

    it('does not advance the revision for a non-mutating tool', async () => {
      connect();
      browserAnswers({ ok: true, result: { revisionId: 'rev_9' } });

      await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'diff',
      });

      expect(updateRevision).not.toHaveBeenCalled();
    });

    it('serializes concurrent mutations on the same workspace', async () => {
      connect();
      const inFlight: string[] = [];
      socket.emit.mockImplementation(
        (event: string, payload: { toolCallId: string }) => {
          if (event !== 'tool.invoke') return;
          inFlight.push(payload.toolCallId);
          setTimeout(
            () =>
              dispatcher.handleCompleted('sess_1', {
                toolCallId: payload.toolCallId,
                result: {},
              }),
            10,
          );
        },
      );

      const both = Promise.all([
        dispatcher.invoke({
          workspaceId: 'sess_1',
          toolCallId: 'tc_1',
          tool: 'write',
          arguments: { path: 'a.ts' },
        }),
        dispatcher.invoke({
          workspaceId: 'sess_1',
          toolCallId: 'tc_2',
          tool: 'write',
          arguments: { path: 'b.ts' },
        }),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(inFlight).toEqual(['tc_1']);

      const [first, second] = await both;
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(inFlight).toEqual(['tc_1', 'tc_2']);
    });

    it('applies queued writes against the live revision instead of a stale MCP base', async () => {
      let latest = 'rev_8';
      findByWorkspaceId.mockImplementation(async () => ({
        ...BINDING,
        latestRevisionId: latest,
      }));
      updateRevision.mockImplementation(async (_workspaceId: string, revisionId: string) => {
        latest = revisionId;
      });
      connect({ revisionId: 'rev_8' });

      let next = 8;
      socket.emit.mockImplementation((event: string, payload: { toolCallId: string }) => {
        if (event !== 'tool.invoke') return;
        next += 1;
        const revisionId = `rev_${next}`;
        setImmediate(() =>
          dispatcher.handleCompleted('sess_1', {
            toolCallId: payload.toolCallId,
            result: { revisionId },
          }),
        );
      });

      const [first, second] = await Promise.all([
        dispatcher.invoke({
          workspaceId: 'sess_1',
          toolCallId: 'tc_1',
          tool: 'write',
          arguments: { path: 'a.ts' },
          baseRevisionId: 'rev_8',
        }),
        dispatcher.invoke({
          workspaceId: 'sess_1',
          toolCallId: 'tc_2',
          tool: 'write',
          arguments: { path: 'b.ts' },
          baseRevisionId: 'rev_8',
        }),
      ]);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(socket.emit).not.toHaveBeenCalledWith('runtime.rehydrate', expect.anything());
      expect(updateRevision).toHaveBeenCalledWith('sess_1', 'rev_9');
      expect(updateRevision).toHaveBeenCalledWith('sess_1', 'rev_10');
    });

    it('fails with TOOL_TIMEOUT when waiting for the mutation lock expires', async () => {
      (config.get as jest.Mock).mockImplementation(
        (key: string, fallback?: number) =>
          key === 'appRuntime.mutationWaitMs' ? 15 : (CONFIG[key] ?? fallback),
      );
      connect();

      // Hold the lock without answering so the waiter times out.
      let releaseHold!: () => void;
      const hold = new Promise<void>((resolve) => {
        releaseHold = resolve;
      });
      socket.emit.mockImplementation((event: string, payload: { toolCallId: string }) => {
        if (event !== 'tool.invoke') return;
        if (payload.toolCallId === 'tc_hold') {
          void hold.then(() =>
            dispatcher.handleCompleted('sess_1', {
              toolCallId: payload.toolCallId,
              result: {},
            }),
          );
          return;
        }
      });

      const held = dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_hold',
        tool: 'write',
        arguments: { path: 'a.ts' },
      });

      await new Promise((r) => setTimeout(r, 5));

      const blocked = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_wait',
        tool: 'write',
        arguments: { path: 'b.ts' },
      });

      expect(asFailure(blocked).code).toBe(AppRuntimeErrorCodes.TOOL_TIMEOUT);
      expect(asFailure(blocked).message).toMatch(/mutation lock/i);

      releaseHold();
      await held;

      (config.get as jest.Mock).mockImplementation(
        (key: string, fallback?: number) => CONFIG[key] ?? fallback,
      );
    });
  });

  describe('idempotency', () => {
    it('replays a succeeded call instead of dispatching again', async () => {
      connect();
      findOne.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve({
              status: 'succeeded',
              result: { path: 'a.ts' },
              resultingRevisionId: 'rev_2',
            }),
        }),
      });

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'write',
        arguments: { path: 'a.ts' },
      });

      expect(envelope).toEqual({
        ok: true,
        toolCallId: 'tc_1',
        result: { path: 'a.ts' },
        revisionId: 'rev_2',
      });
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('replays a failed call with its stored error', async () => {
      connect();
      findOne.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve({
              status: 'failed',
              error: { code: AppRuntimeErrorCodes.PROCESS_FAILED, message: 'boom' },
            }),
        }),
      });

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'run',
      });

      expect(asFailure(envelope).code).toBe(AppRuntimeErrorCodes.PROCESS_FAILED);
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('records the call as running before dispatching', async () => {
      connect();
      browserAnswers({ ok: true, result: {} });

      await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'read',
        arguments: { path: 'a.ts' },
      });

      const [filter, update, options] = updateOne.mock.calls[0];
      expect(filter).toEqual({ toolCallId: 'tc_1' });
      expect(update.$set).toMatchObject({
        bindingId: 'arb_1',
        workspaceId: 'sess_1',
        tool: 'read',
        status: 'running',
      });
      expect(update.$set.argumentsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(options).toEqual({ upsert: true });
    });

    it('attaches a retry of the same toolCallId to the in-flight call', async () => {
      connect();
      socket.emit.mockImplementation((event: string, payload: { toolCallId: string }) => {
        if (event !== 'tool.invoke') return;
        setTimeout(
          () =>
            dispatcher.handleCompleted('sess_1', {
              toolCallId: payload.toolCallId,
              result: { path: 'a.ts' },
            }),
          30,
        );
      });

      const [first, retry] = await Promise.all([
        dispatcher.invoke({
          workspaceId: 'sess_1',
          toolCallId: 'tc_1',
          tool: 'write',
          arguments: { path: 'a.ts', content: 'x' },
        }),
        dispatcher.invoke({
          workspaceId: 'sess_1',
          toolCallId: 'tc_1',
          tool: 'write',
          arguments: { path: 'a.ts', content: 'x' },
        }),
      ]);

      expect(first).toEqual(retry);
      expect(first).toMatchObject({ ok: true, toolCallId: 'tc_1', result: { path: 'a.ts' } });
      expect(socket.emit.mock.calls.filter(([event]) => event === 'tool.invoke')).toHaveLength(1);
    });

    it('does not re-dispatch a running record left by another owner', async () => {
      connect();
      findOne.mockReturnValue({
        lean: () => ({
          exec: () => Promise.resolve({ status: 'running' }),
        }),
      });

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'write',
        arguments: { path: 'a.ts', content: 'x' },
        timeoutMs: 40,
      });

      expect(asFailure(envelope).code).toBe(AppRuntimeErrorCodes.TOOL_TIMEOUT);
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('replays once a running record settles without dispatching', async () => {
      connect();
      let status: 'running' | 'succeeded' = 'running';
      findOne.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve(
              status === 'succeeded'
                ? {
                    status: 'succeeded',
                    result: { path: 'a.ts' },
                    resultingRevisionId: 'rev_2',
                  }
                : { status: 'running' },
            ),
        }),
      });
      setTimeout(() => {
        status = 'succeeded';
      }, 20);

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'write',
        arguments: { path: 'a.ts' },
        timeoutMs: 200,
      });

      expect(envelope).toEqual({
        ok: true,
        toolCallId: 'tc_1',
        result: { path: 'a.ts' },
        revisionId: 'rev_2',
      });
      expect(socket.emit).not.toHaveBeenCalled();
    });
  });

  describe('timeouts', () => {
    it('fails with TOOL_TIMEOUT when the browser never answers', async () => {
      connect();

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'read',
        timeoutMs: 20,
      });

      expect(asFailure(envelope)).toMatchObject({
        code: AppRuntimeErrorCodes.TOOL_TIMEOUT,
        data: { tool: 'read', timeoutMs: 20 },
      });
    });

    it('rearms the timeout while the browser reports progress', async () => {
      connect();
      socket.emit.mockImplementation(
        (event: string, payload: { toolCallId: string }) => {
          if (event !== 'tool.invoke') return;
          const ticks = [15, 30, 45];
          ticks.forEach((delay) =>
            setTimeout(
              () =>
                dispatcher.handleProgress('sess_1', { toolCallId: payload.toolCallId }),
              delay,
            ),
          );
          setTimeout(
            () =>
              dispatcher.handleCompleted('sess_1', {
                toolCallId: payload.toolCallId,
                result: { done: true },
              }),
            55,
          );
        },
      );

      const envelope = await dispatcher.invoke({
        workspaceId: 'sess_1',
        toolCallId: 'tc_1',
        tool: 'run',
        timeoutMs: 25,
      });

      expect(envelope).toMatchObject({ ok: true, result: { done: true } });
    });
  });

  it('ignores tool events coming from another workspace', async () => {
    connect();
    socket.emit.mockImplementation((event: string, payload: { toolCallId: string }) => {
      if (event !== 'tool.invoke') return;
      setImmediate(() => {
        dispatcher.handleCompleted('sess_other', {
          toolCallId: payload.toolCallId,
          result: { hijacked: true },
        });
        dispatcher.handleCompleted('sess_1', {
          toolCallId: payload.toolCallId,
          result: { legit: true },
        });
      });
    });

    const envelope = await dispatcher.invoke({
      workspaceId: 'sess_1',
      toolCallId: 'tc_1',
      tool: 'read',
      timeoutMs: 500,
    });

    expect(envelope).toMatchObject({ ok: true, result: { legit: true } });
  });
});
