import { WorkyTurnKickoffService } from './worky-turn-kickoff.service';

describe('WorkyTurnKickoffService', () => {
  const streams = {
    ensureKickoffContext: jest.fn().mockResolvedValue({ aiSessionId: 'session-1' }),
  };
  const orchestrator = {
    runTask: jest.fn().mockResolvedValue({ sessionId: 'session-1', accepted: true, runId: 'run-1' }),
  };
  const turnContext = {
    resolveWorkyAgentsStrict: jest.fn().mockResolvedValue([{ id: 'agent-1' }]),
    resolveConnectorsStrict: jest.fn().mockResolvedValue([{ id: 'connector-1' }]),
  };
  const planning = { failTurn: jest.fn() };
  const users = {
    findById: jest.fn().mockResolvedValue({
      email: 'owner@example.com',
      profile: { firstName: 'Ada', lastName: 'Lovelace', role: 'Founder' },
    }),
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
  };

  const createService = () =>
    new WorkyTurnKickoffService(
      streams as never,
      orchestrator as never,
      turnContext as never,
      planning as never,
      users as never,
      logger as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator.runTask.mockResolvedValue({
      sessionId: 'session-1',
      accepted: true,
      runId: 'run-1',
    });
  });

  it('starts a gRPC turn with the resolved Worky context', async () => {
    const service = createService();

    await expect(
      service.kickoff({
        streamId: 'stream-1',
        userId: 'user-1',
        content: 'Continue the plan',
        turnId: 'turn-1',
      }),
    ).resolves.toBe('turn-1');

    expect(orchestrator.runTask).toHaveBeenCalledWith(
      'user-1',
      'session-1',
      'Continue the plan',
      {
        agents: [{ id: 'agent-1' }],
        connectors: [{ id: 'connector-1' }],
        turnId: 'turn-1',
        userName: 'Ada Lovelace',
        userEmail: 'owner@example.com',
        userRole: 'Founder',
      },
    );
  });

  it('uses a supplied requester without loading it again', async () => {
    const service = createService();
    const prepared = await service.prepare({
      streamId: 'stream-1',
      userId: 'user-1',
      content: 'Continue the plan',
      requester: {
        email: 'current@example.com',
        profile: { firstName: 'Current', lastName: 'User', role: 'Owner' },
      } as never,
    });

    expect(users.findById).not.toHaveBeenCalled();
    expect(prepared.requester).toEqual({
      userName: 'Current User',
      userEmail: 'current@example.com',
      userRole: 'Owner',
    });
  });

  it('emits a terminal failure when asynchronous kickoff fails', async () => {
    orchestrator.runTask.mockRejectedValueOnce(new Error('unavailable'));
    const service = createService();

    await service.kickoff({
      streamId: 'stream-1',
      userId: 'user-1',
      content: 'Continue the plan',
      turnId: 'turn-2',
    });
    await Promise.resolve();

    expect(planning.failTurn).toHaveBeenCalledWith('user-1', 'stream-1', 'turn-2');
  });

  it.each([
    ['agent', 'resolveWorkyAgentsStrict'],
    ['connector', 'resolveConnectorsStrict'],
  ])('fails preparation when %s resolution fails', async (_kind, method) => {
    turnContext[method as keyof typeof turnContext].mockRejectedValueOnce(new Error('lookup failed'));
    const service = createService();

    await expect(service.prepare({
      streamId: 'stream-1',
      userId: 'user-1',
      content: 'Continue the plan',
    })).rejects.toThrow('lookup failed');

    expect(orchestrator.runTask).not.toHaveBeenCalled();
  });
});
