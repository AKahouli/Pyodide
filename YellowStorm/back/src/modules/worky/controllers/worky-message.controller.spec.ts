import { WorkyMessageController } from './worky-message.controller';

const AGENTS = [{ id: 'planner-1', agent_type: 'worky planner' }, { id: 'executor-1', agent_type: 'worky executer' }];

describe('WorkyMessageController', () => {
  let controller: WorkyMessageController;
  let planning: { appendOwnerMessage: jest.Mock; listMessages: jest.Mock };
  let streamService: { ensureKickoffContext: jest.Mock; findByIdInternal: jest.Mock };
  let orchestrator: { runTask: jest.Mock; stopSession: jest.Mock; pauseSession: jest.Mock };
  let turnContext: { resolveWorkyAgents: jest.Mock; resolveConnectors: jest.Mock };
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
    // The mechanics of agent/connector resolution (agent-type slug lookup,
    // default-agent resolution, gRPC agent build, error swallowing) now live in
    // WorkyTurnContextService and are covered by its own spec. Here we only
    // verify the controller calls it for this user and forwards its result to
    // RunTask.
    turnContext = {
      resolveWorkyAgents: jest.fn().mockResolvedValue(AGENTS),
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
    streamService.ensureKickoffContext.mockResolvedValue({ aiSessionId: 'sess-xyz' });
    const user = { _id: { toString: () => 'user-1' } } as any;

    const res = await controller.sendMessage(user, 'stream-1', { content: 'hi' } as any);

    expect(planning.appendOwnerMessage).toHaveBeenCalledWith('user-1', 'stream-1', { content: 'hi' });
    expect(streamService.ensureKickoffContext).toHaveBeenCalledWith('stream-1', 'user-1');
    expect(orchestrator.runTask).toHaveBeenCalledWith('user-1', 'sess-xyz', 'hi', expect.any(Object));
    expect(res).toEqual({ id: 'm1', content: 'hi', createdAt: 'now', turnStarted: true });
  });

  it('resolves connectors and the two worky agents for this user and forwards them to RunTask', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
    streamService.ensureKickoffContext.mockResolvedValue({ aiSessionId: 'sess-xyz' });
    const user = { _id: { toString: () => 'user-1' } } as any;

    await controller.sendMessage(user, 'stream-1', { content: 'hi' } as any);

    expect(turnContext.resolveWorkyAgents).toHaveBeenCalledWith('user-1');
    expect(turnContext.resolveConnectors).toHaveBeenCalledWith('user-1');
    expect(orchestrator.runTask).toHaveBeenCalledWith(
      'user-1',
      'sess-xyz',
      'hi',
      expect.objectContaining({
        agents: AGENTS,
        connectors: [{ connector_id: 'c1' }, { connector_id: 'c2' }],
      }),
    );
  });

  it('resolves the same way for resumeTurn as it does for a fresh message', async () => {
    streamService.findByIdInternal.mockResolvedValue({ aiSessionId: 'sess-xyz' });
    const user = { _id: { toString: () => 'user-1' } } as any;

    const res = await controller.resumeTurn(user, 'stream-1');

    expect(turnContext.resolveWorkyAgents).toHaveBeenCalledWith('user-1');
    expect(turnContext.resolveConnectors).toHaveBeenCalledWith('user-1');
    expect(orchestrator.runTask).toHaveBeenCalledWith(
      'user-1',
      'sess-xyz',
      '',
      expect.objectContaining({
        agents: AGENTS,
        connectors: [{ connector_id: 'c1' }, { connector_id: 'c2' }],
      }),
    );
    expect(res).toEqual({ resumed: true });
  });
});
