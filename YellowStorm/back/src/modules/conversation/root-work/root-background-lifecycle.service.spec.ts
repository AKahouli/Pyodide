import { RootBackgroundLifecycleService } from './root-background-lifecycle.service';

describe('Owned background lifecycle acknowledgement', () => {
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
