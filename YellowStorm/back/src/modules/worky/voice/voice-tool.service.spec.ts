import { Types } from 'mongoose';
import { VoiceToolService } from './voice-tool.service';

describe('VoiceToolService', () => {
  const planning = { appendOwnerMessage: jest.fn() };
  const streamSvc = { ensureKickoffContext: jest.fn(), findById: jest.fn() };
  const orchestrator = { runTask: jest.fn(), getSession: jest.fn() };
  const turnContext = { resolveWorkyAgents: jest.fn(), resolveConnectors: jest.fn() };
  const tasks = { projectForBoard: jest.fn(), findByIdInternal: jest.fn(), getResultContent: jest.fn() };
  const svc = new VoiceToolService(
    planning as any,
    streamSvc as any,
    orchestrator as any,
    turnContext as any,
    tasks as any,
  );

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

  describe('listTasks', () => {
    it('flattens the board lanes into compact summaries', async () => {
      streamSvc.findById.mockResolvedValue({ id: 's1' });
      tasks.projectForBoard.mockResolvedValue({
        running: [{ id: 't1', title: 'A', lane: 'running', executionState: 'running', blockerReason: null }],
        blocked: [{ id: 't2', title: 'B', lane: 'blocked', executionState: 'waiting_for_event', blockerReason: 'clarification:x' }],
        done: [],
      });

      const { tasks: out } = await svc.listTasks('u1', 's1');

      expect(out).toHaveLength(2);
      expect(out[0]).toEqual({ id: 't1', title: 'A', lane: 'running', executionState: 'running', blocked: false });
      expect(out[1].blocked).toBe(true);
    });

    it('asserts stream ownership before reading', async () => {
      streamSvc.findById.mockRejectedValue(new Error('forbidden'));
      await expect(svc.listTasks('u1', 's1')).rejects.toThrow('forbidden');
      expect(streamSvc.findById).toHaveBeenCalledWith('u1', 's1');
      expect(tasks.projectForBoard).not.toHaveBeenCalled();
    });
  });

  describe('getTaskDetails', () => {
    const streamId = new Types.ObjectId().toString();
    const baseTask = () => ({
      streamId: new Types.ObjectId(streamId),
      title: 'Research widget',
      description: 'Look into widgets',
      lane: 'done',
      executionState: 'done',
      result: 'Found three widgets.',
      blockedReason: null,
      acceptanceCriteria: ['cite sources'],
      assigneeKey: 'Researcher',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-01T00:05:00.000Z'),
      durationMs: 300000,
      budget: { estimateUsd: 1, actualUsd: 2, tokensEstimate: 0, tokensActual: 0 },
    });

    beforeEach(() => {
      streamSvc.findById.mockResolvedValue({ id: 's1' });
      tasks.getResultContent.mockResolvedValue({ components: [], artifacts: [] });
    });

    it('shapes a voice-friendly detail object', async () => {
      tasks.findByIdInternal.mockResolvedValue(baseTask());
      const d = await svc.getTaskDetails('u1', streamId, 'tid');
      expect(d.title).toBe('Research widget');
      expect(d.result).toBe('Found three widgets.');
      expect(d.resultTruncated).toBe(false);
      expect(d.acceptanceCriteria).toEqual(['cite sources']);
      expect(d.assigneeKey).toBe('Researcher');
      expect(d.durationMs).toBe(300000);
      expect(d.budget).toEqual({ estimateUsd: 1, actualUsd: 2 });
      expect(d.startedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('trims an oversized result and flags truncation', async () => {
      const task = baseTask();
      task.result = 'x'.repeat(5000);
      tasks.findByIdInternal.mockResolvedValue(task);
      const d = await svc.getTaskDetails('u1', streamId, 'tid');
      expect(d.result).toHaveLength(1200);
      expect(d.resultTruncated).toBe(true);
    });

    it('lists produced artifacts (capped at 10)', async () => {
      tasks.findByIdInternal.mockResolvedValue(baseTask());
      tasks.getResultContent.mockResolvedValue({
        components: [],
        artifacts: Array.from({ length: 15 }, (_, i) => ({ filename: `f${i}.pdf`, artifactKind: 'file' })),
      });
      const d = await svc.getTaskDetails('u1', streamId, 'tid');
      expect(d.artifacts).toHaveLength(10);
      expect(d.artifacts[0]).toEqual({ filename: 'f0.pdf', kind: 'file' });
    });

    it('still returns details when artifact lookup fails', async () => {
      tasks.findByIdInternal.mockResolvedValue(baseTask());
      tasks.getResultContent.mockRejectedValue(new Error('db down'));
      const d = await svc.getTaskDetails('u1', streamId, 'tid');
      expect(d.artifacts).toEqual([]);
      expect(d.title).toBe('Research widget');
    });

    it('rejects a task that belongs to a different stream', async () => {
      const task = baseTask();
      task.streamId = new Types.ObjectId();
      tasks.findByIdInternal.mockResolvedValue(task);
      await expect(svc.getTaskDetails('u1', streamId, 'tid')).rejects.toThrow();
    });

    it('rejects a missing task', async () => {
      tasks.findByIdInternal.mockResolvedValue(null);
      await expect(svc.getTaskDetails('u1', streamId, 'tid')).rejects.toThrow();
    });
  });
});
