import { WorkyMessageController } from './worky-message.controller';

describe('WorkyMessageController', () => {
  let controller: WorkyMessageController;
  let planning: { appendOwnerMessage: jest.Mock; listMessages: jest.Mock };
  let streamService: { ensureKickoffContext: jest.Mock };
  let orchestrator: { runTask: jest.Mock };
  let models: { getDefaultModel: jest.Mock; getModelIdentifier: jest.Mock };
  let connectorService: { findBySlug: jest.Mock; findByIdsForGrpc: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    planning = {
      appendOwnerMessage: jest.fn(),
      listMessages: jest.fn(),
    };
    streamService = {
      ensureKickoffContext: jest.fn(),
    };
    orchestrator = {
      runTask: jest.fn().mockResolvedValue({ sessionId: 'sess-xyz', accepted: true, runId: 'r' }),
    };
    models = {
      getDefaultModel: jest.fn().mockResolvedValue({ id: 'default-model', litellmModel: 'openai/gpt-4o-mini' }),
      getModelIdentifier: jest.fn((m: { litellmModel?: string; id?: string } | null) => m?.litellmModel || m?.id || ''),
    };
    connectorService = {
      findBySlug: jest.fn().mockImplementation((slug: string) => {
        if (slug === 'code-interpreter') return Promise.resolve({ id: 'c1' });
        if (slug === 'linkup') return Promise.resolve({ id: 'c2' });
        return Promise.resolve(null);
      }),
      findByIdsForGrpc: jest
        .fn()
        .mockResolvedValue([{ connector_id: 'c1' }, { connector_id: 'c2' }]),
    };
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    controller = new WorkyMessageController(
      planning as any,
      streamService as any,
      orchestrator as any,
      models as any,
      connectorService as any,
      logger as any,
    );
  });

  it('appends the owner message and kicks off the manager over gRPC', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
    streamService.ensureKickoffContext.mockResolvedValue({ aiSessionId: 'sess-xyz', managerModelId: null });
    const user = { _id: { toString: () => 'user-1' } } as any;

    const res = await controller.sendMessage(user, 'stream-1', { content: 'hi' } as any);

    expect(planning.appendOwnerMessage).toHaveBeenCalledWith('user-1', 'stream-1', { content: 'hi' });
    expect(streamService.ensureKickoffContext).toHaveBeenCalledWith('stream-1', 'user-1');
    expect(orchestrator.runTask).toHaveBeenCalledWith(
      'user-1',
      'sess-xyz',
      'hi',
      expect.objectContaining({ idempotencyKey: 'm1' }),
    );
    expect(res).toEqual({ id: 'm1', content: 'hi', createdAt: 'now', turnStarted: true });
  });

  it('resolves code-interpreter & linkup connectors by slug and sends them on RunTask', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
    streamService.ensureKickoffContext.mockResolvedValue({ aiSessionId: 'sess-xyz', managerModelId: null });
    const user = { _id: { toString: () => 'user-1' } } as any;

    await controller.sendMessage(user, 'stream-1', { content: 'hi' } as any);

    expect(connectorService.findBySlug).toHaveBeenCalledWith('code-interpreter');
    expect(connectorService.findBySlug).toHaveBeenCalledWith('linkup');
    expect(connectorService.findByIdsForGrpc).toHaveBeenCalledWith(['c1', 'c2'], 'user-1');
    expect(orchestrator.runTask).toHaveBeenCalledWith(
      'user-1',
      'sess-xyz',
      'hi',
      expect.objectContaining({
        connectors: [{ connector_id: 'c1' }, { connector_id: 'c2' }],
      }),
    );
  });

  it('sends no connectors and still kicks off when connector resolution fails', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
    streamService.ensureKickoffContext.mockResolvedValue({ aiSessionId: 'sess-xyz', managerModelId: null });
    connectorService.findBySlug.mockRejectedValue(new Error('connector svc down'));
    const user = { _id: { toString: () => 'user-1' } } as any;

    await controller.sendMessage(user, 'stream-1', { content: 'hi' } as any);

    expect(logger.warn).toHaveBeenCalled();
    expect(orchestrator.runTask).toHaveBeenCalledWith(
      'user-1',
      'sess-xyz',
      'hi',
      expect.objectContaining({ connectors: [] }),
    );
  });

  it('forwards the stream persistent managerModelId when set', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
    streamService.ensureKickoffContext.mockResolvedValue({
      aiSessionId: 'sess-xyz',
      managerModelId: 'anthropic/claude-3-5-sonnet',
    });
    const user = { _id: { toString: () => 'user-1' } } as any;

    await controller.sendMessage(user, 'stream-1', { content: 'hi' } as any);

    expect(orchestrator.runTask).toHaveBeenCalledWith(
      'user-1',
      'sess-xyz',
      'hi',
      expect.objectContaining({ model: 'anthropic/claude-3-5-sonnet', idempotencyKey: 'm1' }),
    );
    expect(models.getDefaultModel).not.toHaveBeenCalled();
  });

  it('prefers the per-turn managerModelId override over the stream field', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
    streamService.ensureKickoffContext.mockResolvedValue({
      aiSessionId: 'sess-xyz',
      managerModelId: 'anthropic/claude-3-5-sonnet',
    });
    const user = { _id: { toString: () => 'user-1' } } as any;

    await controller.sendMessage(
      user,
      'stream-1',
      { content: 'hi', managerModelId: ' openai/gpt-4o ' } as any,
    );

    expect(orchestrator.runTask).toHaveBeenCalledWith(
      'user-1',
      'sess-xyz',
      'hi',
      expect.objectContaining({ model: 'openai/gpt-4o', idempotencyKey: 'm1' }),
    );
  });

  it('falls back to the admin default model when neither override nor stream field is set', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
    streamService.ensureKickoffContext.mockResolvedValue({ aiSessionId: 'sess-xyz', managerModelId: null });
    const user = { _id: { toString: () => 'user-1' } } as any;

    await controller.sendMessage(user, 'stream-1', { content: 'hi' } as any);

    expect(models.getDefaultModel).toHaveBeenCalledTimes(1);
    expect(orchestrator.runTask).toHaveBeenCalledWith(
      'user-1',
      'sess-xyz',
      'hi',
      expect.objectContaining({ model: 'openai/gpt-4o-mini', idempotencyKey: 'm1' }),
    );
  });
});
