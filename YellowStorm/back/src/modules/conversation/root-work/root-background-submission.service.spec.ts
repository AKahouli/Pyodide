import { createHash } from 'node:crypto';
import { RootBackgroundSubmissionService } from './root-background-submission.service';

describe('ROOT background submission', () => {
  const parentId = 'a'.repeat(24), agentId = 'b'.repeat(24);
  const request = { workerKind: 'specialist' as const, agentId, nativeCallId: 'call',
    nativeCallBranch: 'start_background_task@call.delegate_to_agent@call', task: 'bounded task' };
  const childId = createHash('sha256').update(`${parentId}:${request.nativeCallBranch}`).digest('hex').slice(0, 24);
  function fixture() {
    const state = { actorId: 'actor', scope: { immutableSnapshotRef: 'root-snapshot' }, rootContext: { background_enabled: true } };
    const childState = { rootContext: { delegate_request_digest: 'digest' }, admittedRequest: { agentId,
      nativeCallId: 'call', nativeCallBranch: request.nativeCallBranch, task: request.task, expectedOutput: '', contextRefs: [] } };
    const parent = { id: parentId, rootAgentId: parentId, conversationId: 'conversation', conversationEpoch: 3,
      role: 'root', depth: 0, status: 'running', resultPayload: { nativeState: state } };
    const child = { id: childId, resultPayload: { nativeState: childState } };
    const work = { getExecution: jest.fn().mockImplementation(async (id) => id === parentId ? parent : child),
      completeExecution: jest.fn().mockResolvedValue({ status: 'failed' }) };
    const jobs = { getJob: jest.fn().mockResolvedValue(null), admit: jest.fn().mockResolvedValue({ status: 'queued' }),
      admitFanout: jest.fn().mockResolvedValue({ executionId: 'coordinator', requestDigest: 'digest', status: 'queued',
        conversationId: 'conversation', actorId: 'actor' }) };
    const driver = { ready: jest.fn().mockResolvedValue(true) };
    const resolver = { resolveForActor: jest.fn().mockResolvedValue({ rootSnapshotDigest: 'root-snapshot', policy: { background: { enabled: true } } }) };
    const registration = { executionId: childId, nativeState: childState };
    const definitions = { prepareBackground: jest.fn().mockResolvedValue({ executionId: childId, registration }) };
    const temporary = { prepareBackground: jest.fn() };
    const results = { authorizeBackgroundExecution: jest.fn().mockResolvedValue(child) };
    const fanout = { authorizeBackground: jest.fn().mockResolvedValue({ digest: 'digest' }) };
    const service = new RootBackgroundSubmissionService(work as any, jobs as any, driver as any,
      resolver as any, definitions as any, temporary as any, results as any, fanout as any);
    return { service, parent, state, jobs, work, driver, resolver, definitions, results, fanout };
  }

  it('requires versioned fan-out readiness before atomic admission and current authorization before acknowledgement', async () => {
    const h = fixture();
    const proposal = { version: 1 as const, mode: 'background' as const, nativeCallId: 'call', nativeCallBranch: 'run_fanout@call',
      target: { kind: 'library' as const, agentId }, items: [{ key: 'first', task: 'bounded' }] };
    h.driver.ready.mockResolvedValueOnce(false);
    await expect(h.service.submitFanout(parentId, proposal)).rejects.toThrow('authorized');
    expect(h.jobs.admitFanout).not.toHaveBeenCalled();
    expect(await h.service.submitFanout(parentId, proposal)).toEqual({ executionId: 'coordinator', status: 'queued', resultRef: 'coordinator' });
    expect(h.driver.ready).toHaveBeenCalledWith(true);
    expect(h.fanout.authorizeBackground).toHaveBeenCalledWith(parentId, proposal);
    expect(h.jobs.admitFanout).toHaveBeenCalledWith(parentId, proposal);
    h.results.authorizeBackgroundExecution.mockRejectedValueOnce(new Error('revoked'));
    await expect(h.service.submitFanout(parentId, proposal)).rejects.toThrow('revoked');
  });

  it('acknowledges only after durable enqueue and exposes no hydrated profile', async () => {
    const h = fixture();
    expect(await h.service.submit(parentId, request)).toEqual({ executionId: childId, status: 'queued', resultRef: childId });
    expect(h.jobs.admit).toHaveBeenCalledWith(expect.objectContaining({ executionId: childId }), 'digest');
    expect(h.definitions.prepareBackground).toHaveBeenCalledWith(parentId, { agentId, nativeCallId: request.nativeCallId,
      nativeCallBranch: request.nativeCallBranch, task: request.task });
  });

  it('replay of admitted work requires exact request and current resource authorization', async () => {
    const h = fixture();
    h.parent.status = 'completed';
    h.jobs.getJob.mockResolvedValue({ parentExecutionId: parentId, conversationEpoch: 3, status: 'running' });
    expect((await h.service.submit(parentId, request)).status).toBe('running');
    expect(h.definitions.prepareBackground).not.toHaveBeenCalled();
    expect(h.jobs.admit).not.toHaveBeenCalled();
    await expect(h.service.submit(parentId, { ...request, task: 'changed' })).rejects.toThrow('authorized');
    h.results.authorizeBackgroundExecution.mockRejectedValueOnce(new Error('source revoked'));
    await expect(h.service.submit(parentId, request)).rejects.toThrow('source revoked');
  });

  it('reads only jobs bound to this ROOT and rechecks current resource authorization', async () => {
    const h = fixture();
    h.parent.status = 'completed';
    h.jobs.getJob.mockResolvedValue({ parentExecutionId: parentId, conversationEpoch: 3, status: 'waiting' });
    expect(await h.service.status(parentId, childId)).toEqual({ executionId: childId, status: 'waiting', resultRef: childId });
    expect(h.results.authorizeBackgroundExecution).toHaveBeenCalledWith('conversation', childId, 'actor');
    h.jobs.getJob.mockResolvedValueOnce({ parentExecutionId: 'other', conversationEpoch: 3, status: 'waiting' });
    await expect(h.service.status(parentId, childId)).rejects.toThrow('authorized');
    h.results.authorizeBackgroundExecution.mockRejectedValueOnce(new Error('source revoked'));
    await expect(h.service.status(parentId, childId)).rejects.toThrow('source revoked');
  });

  it('fails closed before admission if runtime is unavailable and propagates atomic admission rejection', async () => {
    const h = fixture();
    h.driver.ready.mockResolvedValueOnce(false);
    await expect(h.service.submit(parentId, request)).rejects.toThrow('authorized');
    expect(h.definitions.prepareBackground).not.toHaveBeenCalled();
    h.jobs.admit.mockRejectedValueOnce(new Error('outstanding limit'));
    await expect(h.service.submit(parentId, request)).rejects.toThrow('outstanding limit');
    expect(h.work.completeExecution).not.toHaveBeenCalled();
  });
});
