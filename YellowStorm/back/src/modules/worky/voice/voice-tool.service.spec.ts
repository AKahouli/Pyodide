import { VoiceToolService } from './voice-tool.service';

describe('VoiceToolService', () => {
  const planning = { appendOwnerMessage: jest.fn() };
  const streamSvc = { ensureKickoffContext: jest.fn() };
  const orchestrator = { runTask: jest.fn(), getSession: jest.fn() };
  const turnContext = { resolveWorkyAgents: jest.fn(), resolveConnectors: jest.fn() };
  const svc = new VoiceToolService(planning as any, streamSvc as any, orchestrator as any, turnContext as any);

  beforeEach(() => jest.clearAllMocks());

  it('dispatch persists the utterance then runs the task with resolved context', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'do it', createdAt: 'now' });
    streamSvc.ensureKickoffContext.mockResolvedValue({ aiSessionId: 'sess-1' });
    turnContext.resolveWorkyAgents.mockResolvedValue([{ a: 1 }]);
    turnContext.resolveConnectors.mockResolvedValue([{ c: 1 }]);
    orchestrator.runTask.mockResolvedValue({ sessionId: 'sess-1', accepted: true, runId: 'run-9' });

    const res = await svc.dispatchTask('u1', 's1', 'do it');

    expect(planning.appendOwnerMessage).toHaveBeenCalledWith('u1', 's1', { content: 'do it' });
    expect(orchestrator.runTask).toHaveBeenCalledWith('u1', 'sess-1', 'do it', {
      agents: [{ a: 1 }],
      connectors: [{ c: 1 }],
    });
    expect(res).toEqual({ runId: 'run-9', sessionId: 'sess-1', accepted: true });
  });

  it('status reads the current session from the orchestrator', async () => {
    streamSvc.ensureKickoffContext.mockResolvedValue({ aiSessionId: 'sess-2' });
    orchestrator.getSession.mockResolvedValue({ sessionId: 'sess-2', title: 'T', status: 'running', plan: { steps: 3 } });

    const res = await svc.queryStatus('u1', 's2');

    expect(orchestrator.getSession).toHaveBeenCalledWith('u1', 'sess-2');
    expect(res).toEqual({ status: 'running', title: 'T', plan: { steps: 3 } });
  });
});
