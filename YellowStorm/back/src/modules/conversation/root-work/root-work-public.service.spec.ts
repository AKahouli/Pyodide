import { RootWorkPublicService } from './root-work-public.service';
import { newStopRequestId } from './root-work.types';

describe('Creator-owned Root work controls', () => {
  function fixture(enabled = true) {
    const conversation = { createdBy: 'owner', rootAgentId: 'root', rootWorkEpoch: 4 };
    const conversations = { getConversationDocument: jest.fn().mockResolvedValue(conversation) };
    const work = { stopRootWork: jest.fn().mockResolvedValue({ barrierEpoch: 5, applied: true, markedCount: 1 }) };
    const jobs = { publicSnapshot: jest.fn().mockResolvedValue({ epoch: 4, watermark: '10', rootAgentId: 'root', jobs: [
      { executionId: 'job', parentExecutionId: 'parent', status: 'running', role: 'library_worker',
        createdAt: 'created', deadline: 'deadline', nativeState: { requestProfile: { private: true }, pendingInputs: [] } },
    ] }) };
    const events = { replay: jest.fn().mockResolvedValue([]) };
    const results = { authorizeBackgroundExecution: jest.fn().mockResolvedValue({}) };
    const stream = { getActiveStreamSnapshot: jest.fn().mockReturnValue(null), stopStream: jest.fn().mockResolvedValue(undefined) };
    const messages = { findById: jest.fn().mockResolvedValue({ conversationId: 'conversation' }) };
    const service = new RootWorkPublicService(conversations as never, work as never, jobs as never, events as never,
      results as never, stream as never, messages as never, { get: jest.fn().mockReturnValue(enabled) } as never);
    return { service, conversation, conversations, work, jobs, events, results, stream, messages };
  }

  it('never touches unmigrated background tables while the feature is disabled', async () => {
    const h = fixture(false);
    expect(await h.service.snapshot('conversation', 'owner')).toMatchObject({ epoch: 4, watermark: '0', jobs: [] });
    expect(await h.service.replay('conversation', 'owner', 4, '0')).toEqual([]);
    expect(h.jobs.publicSnapshot).not.toHaveBeenCalled();
    expect(h.events.replay).not.toHaveBeenCalled();
  });

  it('publishes only authorized public job metadata and rejects an epoch change during hydration', async () => {
    const h = fixture();
    const snapshot = await h.service.snapshot('conversation', 'owner');
    expect(snapshot.watermark).toBe('10');
    expect(snapshot.jobs[0]).not.toHaveProperty('nativeState');
    h.results.authorizeBackgroundExecution.mockImplementationOnce(async () => { h.conversation.rootWorkEpoch = 5; return {}; });
    await expect(h.service.snapshot('conversation', 'owner')).rejects.toThrow('epoch changed');
  });

  it.each(['member', 'guest'])('denies private controls to %s before reading durable work', async (actor) => {
    const h = fixture();
    await expect(h.service.snapshot('conversation', actor)).rejects.toThrow('unavailable');
    await expect(h.service.stop('conversation', actor, { expectedEpoch: 4, stopRequestId: newStopRequestId() })).rejects.toThrow('unavailable');
    expect(h.jobs.publicSnapshot).not.toHaveBeenCalled();
    expect(h.work.stopRootWork).not.toHaveBeenCalled();
  });

  it('commits Stop after foreground completion and does not require a live stream', async () => {
    const h = fixture(); const request = { expectedEpoch: 4, stopRequestId: newStopRequestId() };
    expect(await h.service.stop('conversation', 'owner', request)).toMatchObject({ applied: true, foregroundCancellationPending: false });
    expect(h.work.stopRootWork).toHaveBeenCalledWith({ conversationId: 'conversation', actorId: 'owner', ...request });
    expect(h.stream.stopStream).not.toHaveBeenCalled();
  });

  it('binds foreground cancellation to its conversation and commits the barrier first', async () => {
    const h = fixture(); const request = { expectedEpoch: 4, stopRequestId: newStopRequestId(), foregroundMessageId: 'message' };
    h.messages.findById.mockResolvedValueOnce({ conversationId: 'other' });
    await expect(h.service.stop('conversation', 'owner', request)).rejects.toThrow('unavailable');
    expect(h.work.stopRootWork).not.toHaveBeenCalled();
    h.stream.stopStream.mockImplementationOnce(async () => {
      expect(h.work.stopRootWork).toHaveBeenCalledTimes(1);
      throw new Error('observer detached');
    });
    expect(await h.service.stop('conversation', 'owner', request)).toMatchObject({ applied: true, foregroundCancellationPending: true });
    h.work.stopRootWork.mockResolvedValueOnce({ barrierEpoch: 5, applied: false, markedCount: 0,
      foregroundMessageId: 'message' } as never);
    await h.service.stop('conversation', 'owner', request);
    expect(h.stream.stopStream).toHaveBeenCalledTimes(2);
    expect(h.stream.stopStream).toHaveBeenLastCalledWith('owner', 'conversation', 'message');
    h.work.stopRootWork.mockResolvedValueOnce({ barrierEpoch: 5, applied: false, markedCount: 0 });
    expect(await h.service.stop('conversation', 'owner', { ...request, foregroundMessageId: 'new-message' }))
      .toMatchObject({ foregroundCancellationPending: true });
    expect(h.stream.stopStream).toHaveBeenCalledTimes(2);
  });
});
