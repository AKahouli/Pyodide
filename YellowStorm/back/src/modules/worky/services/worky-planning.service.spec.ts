import { Types } from 'mongoose';
import { WorkyPlanningService } from './worky-planning.service';

interface MakeOptions {
  stream?: any;
  board?: Record<string, any[]>;
  /**
   * The value returned by `ModelsService.getModelIdentifier(defaultModel)`
   * when the admin default is queried. `null` (or `'__none__'`) means
   * "no admin default configured". Defaults to `'gpt-4o-mini'`.
   */
  defaultModel?: string | null;
}

const makeService = (options: MakeOptions = {}) => {
  const streamObjectId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const stream = options.stream ?? {
    _id: streamObjectId,
    ownerUserId: ownerId,
    status: 'planning',
    currentPlanVersion: 0,
    budget: { limitUsd: 0, spendUsd: 0 },
  };
  const streamModel = {
    findById: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(stream),
    }),
  };
  const messageModel = {
    create: jest.fn((doc) => Promise.resolve({ _id: new Types.ObjectId(), ...doc, createdAt: new Date() })),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
        }),
      }),
    }),
  };
  const taskService = {
    projectForBoard: jest.fn().mockResolvedValue(options.board ?? {}),
  };
  const runtime = { baseURL: 'http://runtime' } as any;
  const events = { emit: jest.fn() } as any;
  // Default admin model identifier. `null` = "no admin default
  // configured" (forces the planning service to reject with
  // ERR_3430 when no other layer resolves a model id).
  const defaultIdentifier =
    options.defaultModel === undefined ? 'gpt-4o-mini' : options.defaultModel;
  const defaultModelDoc = defaultIdentifier
    ? { id: 'default-id', litellmModel: defaultIdentifier }
    : null;
  const models = {
    getDefaultModel: jest.fn().mockResolvedValue(defaultModelDoc),
    getModelIdentifier: jest.fn(
      (m: { id?: string; litellmModel?: string } | null | undefined) =>
        m?.id || m?.litellmModel || '',
    ),
  } as any;
  const config = { get: jest.fn((key: string, fallback?: number) => fallback ?? 0) } as any;
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as any;
  const service = new WorkyPlanningService(
    streamModel as any,
    messageModel as any,
    taskService as any,
    runtime,
    events,
    models,
    config,
    logger,
  );
  return { service, streamModel, messageModel, taskService, events, models, ownerId, streamObjectId };
};

describe('WorkyPlanningService.appendOwnerMessage', () => {
  const streamId = new Types.ObjectId().toString();
  it('persists the message and emits message.appended on the SSE channel', async () => {
    const { service, messageModel, events, ownerId } = makeService();
    const result = await service.appendOwnerMessage(ownerId.toString(), streamId, {
      content: 'Hello Manager',
    });
    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'owner', content: 'Hello Manager' }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      ownerId.toString(),
      streamId,
      expect.objectContaining({ type: 'message.appended' }),
    );
    expect(result.content).toBe('Hello Manager');
  });

  it('rejects when the stream is in an execution phase', async () => {
    const { service, streamModel, ownerId } = makeService();
    streamModel.findById.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        ownerUserId: ownerId,
        status: 'active',
        currentPlanVersion: 0,
        budget: { limitUsd: 0, spendUsd: 0 },
      }),
    });
    await expect(
      service.appendOwnerMessage(ownerId.toString(), streamId, { content: 'x' }),
    ).rejects.toMatchObject({ code: 'ERR_3409' });
  });
});

describe('WorkyPlanningService.startTurn (SSE relay)', () => {
  const streamId = new Types.ObjectId().toString();
  const sseFrame = (event: string, data: unknown) =>
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  const stubFetch = (chunks: string[]) => {
    // global fetch is part of Node 20+ runtime
    const encoder = new TextEncoder();
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => {
          let i = 0;
          return {
            read: async () => {
              if (i >= chunks.length) return { value: undefined, done: true };
              const value = encoder.encode(chunks[i++]);
              return { value, done: false };
            },
            releaseLock: jest.fn(),
          };
        },
      },
    });
  };

  it('translates each runtime frame to the canonical WorkyEventType', async () => {
    stubFetch([
      sseFrame('planning.ack', { type: 'planning.ack', emitted_at: 1, payload: {} }),
      sseFrame('planning.token', { type: 'planning.token', emitted_at: 2, payload: { text: 'Hi ' } }),
      sseFrame('planning.token', { type: 'planning.token', emitted_at: 3, payload: { text: 'there' } }),
      sseFrame('planning.delta.applied', {
        type: 'planning.delta.applied',
        emitted_at: 4,
        payload: { resultPlanVersion: 7 },
      }),
      sseFrame('planning.done', { type: 'planning.done', emitted_at: 5, payload: {} }),
    ]);
    const { service, events, ownerId } = makeService();
    const obs = service.startTurn({
      streamId,
      userId: ownerId.toString(),
      content: 'Hello',
      triggerKind: 'owner_message',
    });
    // Drain the whole observable — it completes after the runtime sends `planning.done`.
    await new Promise<void>((resolve) => {
      obs.subscribe({
        complete: () => resolve(),
        error: () => resolve(),
      });
    });
    const emitTypes = events.emit.mock.calls.map((c: any[]) => c[2]?.type);
    expect(emitTypes).toEqual(
      expect.arrayContaining([
        'stream.updated',
        'assistant_token',
        'plan.delta.applied',
        'plan.version.created',
        'task.updated',
      ]),
    );
  });

  it('emits a stream.terminal event when the runtime returns non-OK', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
    });
    const { service, events, ownerId } = makeService();
    const obs = service.startTurn({
      streamId,
      userId: ownerId.toString(),
      content: 'x',
      triggerKind: 'owner_message',
    });
    await new Promise<void>((resolve) => {
      obs.subscribe({
        complete: () => resolve(),
        error: () => resolve(),
      });
    });
    const emitTypes = events.emit.mock.calls.map((c: any[]) => c[2]?.type);
    expect(emitTypes).toContain('stream.terminal');
  });

  it('forwards per-turn model ids in the runtime request body', async () => {
    let capturedBody: any = null;
    (global as any).fetch = jest.fn().mockImplementation(async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        body: null,
      };
    });
    const { service, ownerId } = makeService();
    await new Promise<void>((resolve) => {
      service
        .startTurn({
          streamId,
          userId: ownerId.toString(),
          content: 'go',
          triggerKind: 'owner_message',
          managerModelIdOverride: 'gpt-4o-mini',
          workerModelIdOverride: 'claude-3-5-sonnet-20240620',
        })
        .subscribe({ complete: () => resolve(), error: () => resolve() });
    });
    expect(capturedBody.manager_model_id).toBe('gpt-4o-mini');
    expect(capturedBody.worker_model_id).toBe('claude-3-5-sonnet-20240620');
  });

  it('falls back to the stream field when no per-turn override is supplied', async () => {
    let capturedBody: any = null;
    (global as any).fetch = jest.fn().mockImplementation(async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        body: null,
      };
    });
    const localStreamObjectId = new Types.ObjectId();
    const streamWithModels = {
      _id: localStreamObjectId,
      ownerUserId: new Types.ObjectId(),
      status: 'planning',
      currentPlanVersion: 0,
      managerModelId: 'stream-manager',
      workerModelId: 'stream-worker',
      budget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
    };
    const { service, streamModel } = makeService({
      stream: streamWithModels,
    });
    streamModel.findById = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(streamWithModels),
    });
    const localStreamId = localStreamObjectId.toString();
    await new Promise<void>((resolve) => {
      service
        .startTurn({
          streamId: localStreamId,
          userId: streamWithModels.ownerUserId.toString(),
          content: 'go',
          triggerKind: 'owner_message',
        })
        .subscribe({ complete: () => resolve(), error: () => resolve() });
    });
    expect(capturedBody.manager_model_id).toBe('stream-manager');
    expect(capturedBody.worker_model_id).toBe('stream-worker');
  });

  it('rejects the turn with ERR_3430 when no model resolves from any layer', async () => {
    const { service, ownerId, events } = makeService({ defaultModel: null });
    const frames: any[] = [];
    await new Promise<void>((resolve) => {
      service
        .startTurn({
          streamId,
          userId: ownerId.toString(),
          content: 'go',
          triggerKind: 'owner_message',
        })
        .subscribe({
          next: (e) => frames.push(e.frame),
          complete: () => resolve(),
        });
    });
    // The turn failure is surfaced as a `planning.error` SSE frame
    // (runTurn catches the BadRequestException and forwards it as
    // a frame). The owner sees the message on the SSE channel.
    const errorFrame = frames.find((f) => f.type === 'planning.error');
    expect(errorFrame).toBeDefined();
    expect(errorFrame.payload.error).toMatch(/no model/i);
    const streamTerminal = events.emit.mock.calls
      .map((c: any[]) => c[2]?.type)
      .find((t: string) => t === 'stream.terminal');
    expect(streamTerminal).toBeDefined();
  });
});
