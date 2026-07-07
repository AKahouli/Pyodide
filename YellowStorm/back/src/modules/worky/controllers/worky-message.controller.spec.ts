import { WorkyMessageController } from './worky-message.controller';

describe('WorkyMessageController', () => {
  let controller: WorkyMessageController;
  let planning: { appendOwnerMessage: jest.Mock; listMessages: jest.Mock };
  let streamService: { ensureKickoffContext: jest.Mock };
  let grpcClient: { worky: jest.Mock };
  let models: { getDefaultModel: jest.Mock; getModelIdentifier: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    planning = {
      appendOwnerMessage: jest.fn(),
      listMessages: jest.fn(),
    };
    streamService = {
      ensureKickoffContext: jest.fn(),
    };
    grpcClient = {
      worky: jest.fn().mockResolvedValue({ sessionId: 'sess-xyz', accepted: true }),
    };
    models = {
      getDefaultModel: jest.fn().mockResolvedValue({ id: 'default-model', litellmModel: 'openai/gpt-4o-mini' }),
      getModelIdentifier: jest.fn((m: { litellmModel?: string; id?: string } | null) => m?.litellmModel || m?.id || ''),
    };
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    controller = new WorkyMessageController(
      planning as any,
      streamService as any,
      grpcClient as any,
      models as any,
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
    expect(grpcClient.worky).toHaveBeenCalledWith('user-1', 'sess-xyz', 'hi', expect.any(Object));
    expect(res).toEqual({ id: 'm1', content: 'hi', createdAt: 'now', turnStarted: true });
  });

  it('forwards the stream persistent managerModelId when set', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
    streamService.ensureKickoffContext.mockResolvedValue({
      aiSessionId: 'sess-xyz',
      managerModelId: 'anthropic/claude-3-5-sonnet',
    });
    const user = { _id: { toString: () => 'user-1' } } as any;

    await controller.sendMessage(user, 'stream-1', { content: 'hi' } as any);

    expect(grpcClient.worky).toHaveBeenCalledWith('user-1', 'sess-xyz', 'hi', {
      model: 'anthropic/claude-3-5-sonnet',
    });
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

    expect(grpcClient.worky).toHaveBeenCalledWith('user-1', 'sess-xyz', 'hi', {
      model: 'openai/gpt-4o',
    });
  });

  it('falls back to the admin default model when neither override nor stream field is set', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
    streamService.ensureKickoffContext.mockResolvedValue({ aiSessionId: 'sess-xyz', managerModelId: null });
    const user = { _id: { toString: () => 'user-1' } } as any;

    await controller.sendMessage(user, 'stream-1', { content: 'hi' } as any);

    expect(models.getDefaultModel).toHaveBeenCalledTimes(1);
    expect(grpcClient.worky).toHaveBeenCalledWith('user-1', 'sess-xyz', 'hi', {
      model: 'openai/gpt-4o-mini',
    });
  });
});
