import { WorkyMessageController } from './worky-message.controller';

describe('WorkyMessageController', () => {
  let controller: WorkyMessageController;
  let planning: { appendOwnerMessage: jest.Mock; listMessages: jest.Mock };
  let streamService: { ensureKickoffContext: jest.Mock; findByIdInternal: jest.Mock };
  let orchestrator: { runTask: jest.Mock; stopSession: jest.Mock; pauseSession: jest.Mock };
  let turnContext: { resolveManagerModel: jest.Mock; resolveConnectors: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };

  beforeEach(() => {
    planning = {
      appendOwnerMessage: jest.fn(),
      listMessages: jest.fn(),
    };
    streamService = {
      ensureKickoffContext: jest.fn(),
      findByIdInternal: jest.fn(),
    };
    orchestrator = {
      runTask: jest.fn().mockResolvedValue({ sessionId: 'sess-xyz', accepted: true, runId: 'r' }),
      stopSession: jest.fn(),
      pauseSession: jest.fn(),
    };
    // The mechanics of model/connector resolution (slug lookup, admin default
    // fallback, error swallowing) now live in WorkyTurnContextService and are
    // covered by its own spec. Here we only verify the controller calls it
    // with the right arguments and forwards its result to RunTask.
    turnContext = {
      resolveManagerModel: jest.fn().mockResolvedValue('openai/gpt-4o-mini'),
      resolveConnectors: jest.fn().mockResolvedValue([{ connector_id: 'c1' }, { connector_id: 'c2' }]),
    };
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    controller = new WorkyMessageController(
      planning as any,
      streamService as any,
      orchestrator as any,
      turnContext as any,
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
    expect(orchestrator.runTask).toHaveBeenCalledWith('user-1', 'sess-xyz', 'hi', expect.any(Object));
    expect(res).toEqual({ id: 'm1', content: 'hi', createdAt: 'now', turnStarted: true });
  });

  it('resolves connectors for this user and forwards them to RunTask', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
    streamService.ensureKickoffContext.mockResolvedValue({ aiSessionId: 'sess-xyz', managerModelId: null });
    const user = { _id: { toString: () => 'user-1' } } as any;

    await controller.sendMessage(user, 'stream-1', { content: 'hi' } as any);

    expect(turnContext.resolveConnectors).toHaveBeenCalledWith('user-1');
    expect(orchestrator.runTask).toHaveBeenCalledWith(
      'user-1',
      'sess-xyz',
      'hi',
      expect.objectContaining({
        connectors: [{ connector_id: 'c1' }, { connector_id: 'c2' }],
      }),
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

    expect(turnContext.resolveManagerModel).toHaveBeenCalledWith('anthropic/claude-3-5-sonnet');
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

    expect(turnContext.resolveManagerModel).toHaveBeenCalledWith('openai/gpt-4o');
  });

  it('passes null through when neither override nor stream field is set, letting the resolver fall back', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
    streamService.ensureKickoffContext.mockResolvedValue({ aiSessionId: 'sess-xyz', managerModelId: null });
    const user = { _id: { toString: () => 'user-1' } } as any;

    await controller.sendMessage(user, 'stream-1', { content: 'hi' } as any);

    expect(turnContext.resolveManagerModel).toHaveBeenCalledWith(null);
  });

  it('resolves the same way for resumeTurn as it does for a fresh message', async () => {
    streamService.findByIdInternal.mockResolvedValue({
      aiSessionId: 'sess-xyz',
      managerModelId: 'anthropic/claude-3-5-sonnet',
    });
    const user = { _id: { toString: () => 'user-1' } } as any;

    const res = await controller.resumeTurn(user, 'stream-1');

    expect(turnContext.resolveManagerModel).toHaveBeenCalledWith('anthropic/claude-3-5-sonnet');
    expect(turnContext.resolveConnectors).toHaveBeenCalledWith('user-1');
    expect(orchestrator.runTask).toHaveBeenCalledWith(
      'user-1',
      'sess-xyz',
      '',
      expect.objectContaining({ connectors: [{ connector_id: 'c1' }, { connector_id: 'c2' }] }),
    );
    expect(res).toEqual({ resumed: true });
  });
});
