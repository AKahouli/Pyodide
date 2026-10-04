import { RootBackgroundLifecycleService } from './root-background-lifecycle.service';

describe('Owned background lifecycle acknowledgement', () => {
  const request = { owner: 'owner', fence: 2, nativeOwner: 'native-process', requestDigest: 'digest' };
  function fanoutFixture(role = 'library_worker') {
    const jobs = { getOwnedFanoutItem: jest.fn().mockResolvedValue({ role, job: { requestDigest: 'digest' } }) };
    const resolved = { scope: { version: 1, role, executionId: 'item', parentExecutionId: 'root',
      depth: 1, conversationEpoch: 1, attempt: 1, immutableSnapshotRef: 'snapshot',
      nativeSessionId: 'background_coordinator', nativeInvocationId: 'invocation', expectedFence: 2 },
      definition: { name: 'selected' } };
    const definitions = { resolveFanoutItem: jest.fn().mockResolvedValue(resolved) };
    const temporary = { resolveFanoutItem: jest.fn().mockResolvedValue(resolved) };
    const service = new RootBackgroundLifecycleService(jobs as any, {} as any, definitions as any,
      temporary as any, {} as any, {} as any);
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

  it('returns committed WAIT status rather than the older running result payload', async () => {
    const job = { requestDigest: 'digest', conversationId: 'conversation', actorId: 'actor',
      parentExecutionId: 'parent', nativeInvocationId: 'native' };
    const child = { parentExecutionId: 'parent', status: 'running' };
    const jobs = { getJob: jest.fn().mockResolvedValue(job), getOwnedHydration: jest.fn().mockResolvedValue({
      job, child, state: { pendingInputs: [{ callId: 'confirmation' }] } }) };
    const definitions = { settle: jest.fn().mockResolvedValue({ status: 'running' }) };
    const results = { authorizeBackgroundExecution: jest.fn().mockResolvedValue(child) };
    const work = { getExecution: jest.fn().mockResolvedValueOnce(child).mockResolvedValueOnce({ ...child, status: 'waiting' }) };
    const service = new RootBackgroundLifecycleService(jobs as any, {} as any, definitions as any,
      {} as any, results as any, work as any);
    const request = { owner: 'owner', fence: 1, nativeOwner: 'native-process', requestDigest: 'digest', status: 'waiting' as const };
    expect(await service.settle('child', request)).toEqual({ executionId: 'child', status: 'waiting', resultRef: 'child' });
    expect(definitions.settle).toHaveBeenCalledWith('parent', 'child', expect.any(Object),
      { executionId: 'child', owner: 'owner', fence: 1, nativeOwner: 'native-process' });
  });
});
