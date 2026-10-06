import { RootBackgroundLifecycleService } from './root-background-lifecycle.service';

describe('Owned background lifecycle acknowledgement', () => {
  const request = { owner: 'owner', fence: 2, nativeOwner: 'native-process', requestDigest: 'digest' };

  it('ingests synthesis events through sealed follow-up authority instead of leaf hydration', async () => {
    const job = { conversationId: 'conversation', actorId: 'actor', requestDigest: 'digest' };
    const jobs = { getOwnedHydration: jest.fn().mockRejectedValue(new Error('leaf-only hydration rejects followup')) };
    const work = { getExecution: jest.fn().mockResolvedValue({ role: 'followup' }) };
    const followups = { authorizeOwned: jest.fn().mockResolvedValue({ job, root: {}, execution: {}, state: {},
      grant: { executionId: 'followup', owner: request.owner, fence: request.fence, nativeOwner: request.nativeOwner } }) };
    const results = { authorizeBackgroundExecution: jest.fn().mockResolvedValue({}) };
    const events = { append: jest.fn().mockResolvedValue([{ eventId: 'event', sequence: '1' }]) };
    const service = new RootBackgroundLifecycleService(jobs as never, events as never, {} as never,
      {} as never, results as never, work as never, {} as never, followups as never);
    await expect(service.ingest('followup', { ...request, events: [] })).resolves.toEqual({ events: [{ eventId: 'event', sequence: '1' }] });
    expect(followups.authorizeOwned).toHaveBeenCalledWith('followup', expect.objectContaining(request));
    expect(jobs.getOwnedHydration).not.toHaveBeenCalled();
  });
  function fanoutFixture(role = 'library_worker') {
    const jobs = { getOwnedFanoutItem: jest.fn().mockResolvedValue({ role, job: { requestDigest: 'digest' } }) };
    const resolved = { scope: { version: 1, role, executionId: 'item', parentExecutionId: 'root',
      depth: 1, conversationEpoch: 1, attempt: 1, immutableSnapshotRef: 'snapshot',
      nativeSessionId: 'background_coordinator', nativeInvocationId: 'invocation', expectedFence: 2 },
      definition: { name: 'selected' } };
    const definitions = { resolveFanoutItem: jest.fn().mockResolvedValue(resolved) };
    const temporary = { resolveFanoutItem: jest.fn().mockResolvedValue(resolved) };
    const service = new RootBackgroundLifecycleService(jobs as any, {} as any, definitions as any,
      temporary as any, {} as any, {} as any, {} as any);
    return { jobs, definitions, temporary, service };
  }

  it.each(['library_worker', 'temporary_worker'])('hydrates an owned %s using its original producer identity', async (role) => {
    const fixture = fanoutFixture(role);
    const result = await fixture.service.itemDefinition('coordinator', 'item', request);
    const resolver = role === 'temporary_worker' ? fixture.temporary : fixture.definitions;
    expect(resolver.resolveFanoutItem).toHaveBeenCalledWith({ executionId: 'coordinator', producerExecutionId: 'item',
      owner: 'owner', fence: 2, nativeOwner: 'native-process' }, 'item');
    expect(result.kind).toBe('worker');
    expect(result.executionScope.execution_id).toBe('item');
    expect(fixture.jobs.getOwnedFanoutItem).toHaveBeenCalledTimes(2);
  });

  it('rejects missing native ownership before reading a manifest', async () => {
    const fixture = fanoutFixture();
    await expect(fixture.service.itemDefinition('coordinator', 'item', { ...request, nativeOwner: undefined })).rejects.toThrow();
    expect(fixture.jobs.getOwnedFanoutItem).not.toHaveBeenCalled();
  });

  it('rejects changed coordinator digest before profile hydration', async () => {
    const fixture = fanoutFixture();
    await expect(fixture.service.itemDefinition('coordinator', 'item', { ...request, requestDigest: 'changed' })).rejects.toThrow();
    expect(fixture.definitions.resolveFanoutItem).not.toHaveBeenCalled();
  });

  it('does not publish a hydrated definition after ownership is lost', async () => {
    const fixture = fanoutFixture();
    fixture.jobs.getOwnedFanoutItem.mockResolvedValueOnce({ role: 'library_worker', job: { requestDigest: 'digest' } })
      .mockRejectedValueOnce(new Error('Lease lost'));
    await expect(fixture.service.itemDefinition('coordinator', 'item', request)).rejects.toThrow('Lease lost');
    expect(fixture.definitions.resolveFanoutItem).toHaveBeenCalledTimes(1);
  });

  it('hydrates a coordinator without resolving a worker or returning a profile', async () => {
    const scope = { executionId: 'coordinator', role: 'fanout_driver', depth: 0, parentExecutionId: 'root' };
    const owned = { job: { requestDigest: 'digest', conversationId: 'conversation', actorId: 'actor', fence: 2,
      deadline: new Date(10000), nativeInvocationId: 'invocation', inputResponseDigest: null },
      coordinator: { resultPayload: { nativeState: { scope } } },
      parent: { resultPayload: { nativeState: { rootContext: { catalog: [] } } } }, manifest: { manifestId: 'manifest' } };
    const jobs = { getOwnedFanout: jest.fn().mockResolvedValue(owned) };
    const definitions = { resolveOwned: jest.fn() };
    const results = { authorizeBackgroundExecution: jest.fn().mockResolvedValue({}) };
    const work = { getExecution: jest.fn().mockResolvedValue({ role: 'fanout_driver' }) };
    const service = new RootBackgroundLifecycleService(jobs as any, {} as any, definitions as any, {} as any,
      results as any, work as any, {} as any);
    const response = await service.definition('coordinator', request);
    expect(response).toMatchObject({ kind: 'fanout_driver', manifest: { manifestId: 'manifest' },
      executionScope: { execution_id: 'coordinator', parent_execution_id: 'root', depth: 0, expected_fence: '2', resume_intent: 'resume' } });
    expect(response).not.toHaveProperty('definition');
    expect(definitions.resolveOwned).not.toHaveBeenCalled();
    expect(jobs.getOwnedFanout).toHaveBeenCalledTimes(2);
    results.authorizeBackgroundExecution.mockRejectedValueOnce(new Error('revoked'));
    await expect(service.definition('coordinator', request)).rejects.toThrow('revoked');
  });

  it('requires terminal producer coverage and forbids worker evidence in coordinator completion', async () => {
    const child = { role: 'fanout_driver', parentExecutionId: 'root', rootAgentId: 'agent' };
    const producer = { terminalAt: null as Date | null, parentExecutionId: 'root',
      resultPayload: { nativeState: { backgroundFanoutItem: { coordinatorExecutionId: 'coordinator' } } } };
    const job = { conversationId: 'conversation', actorId: 'actor', parentExecutionId: 'root',
      nativeInvocationId: 'invocation', requestDigest: 'digest' };
    const jobs = { getJob: jest.fn().mockResolvedValue(job), getOwnedFanout: jest.fn().mockResolvedValue({ job,
      parent: { id: 'root' }, coordinator: { ...child, resultPayload: { nativeState: { pendingInputs: [] } } },
      manifest: { items: [{ executionId: 'item' }] } }) };
    const work = { getExecution: jest.fn().mockImplementation(async (id) => id === 'item' ? producer : child),
      completeExecution: jest.fn().mockResolvedValue({ status: 'completed' }) };
    const service = new RootBackgroundLifecycleService(jobs as any, {} as any, {} as any, {} as any,
      { authorizeBackgroundExecution: jest.fn() } as any, work as any, {} as any);
    const completion = { ...request, status: 'completed' as const, fullText: '{}' };
    await expect(service.settle('coordinator', completion)).rejects.toThrow('coverage');
    expect(work.completeExecution).not.toHaveBeenCalled();
    producer.terminalAt = new Date();
    expect(await service.settle('coordinator', completion)).toMatchObject({ status: 'completed' });
    await expect(service.settle('coordinator', { ...completion, evidence: [{}] as never })).rejects.toThrow('evidence');
  });

  it('returns committed WAIT status rather than the older running result payload', async () => {
    const job = { requestDigest: 'digest', conversationId: 'conversation', actorId: 'actor',
      parentExecutionId: 'parent', nativeInvocationId: 'native' };
    const child = { parentExecutionId: 'parent', status: 'running' };
    const jobs = { getJob: jest.fn().mockResolvedValue(job), getOwnedHydration: jest.fn().mockResolvedValue({
      job, child, state: { pendingInputs: [{ callId: 'confirmation' }] } }) };
    const definitions = { settle: jest.fn().mockResolvedValue({ status: 'running' }) };
    const results = { authorizeBackgroundExecution: jest.fn().mockResolvedValue(child) };
    const work = { getExecution: jest.fn().mockResolvedValueOnce(child).mockResolvedValueOnce(child)
      .mockResolvedValueOnce({ ...child, status: 'waiting' }) };
    const service = new RootBackgroundLifecycleService(jobs as any, {} as any, definitions as any,
      {} as any, results as any, work as any, {} as any);
    const request = { owner: 'owner', fence: 1, nativeOwner: 'native-process', requestDigest: 'digest', status: 'waiting' as const };
    expect(await service.settle('child', request)).toEqual({ executionId: 'child', status: 'waiting', resultRef: 'child' });
    expect(definitions.settle).toHaveBeenCalledWith('parent', 'child', expect.any(Object),
      { executionId: 'child', owner: 'owner', fence: 1, nativeOwner: 'native-process' });
  });
});
