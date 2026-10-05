import { RootInputService } from './root-input.service';

describe('Root input read authorization', () => {
  const conversation = { createdBy: 'owner', rootAgentId: 'root', rootWorkEpoch: 4 };
  const nativeState = { actorId: 'owner', invocationId: 'private-invocation', requestProfile: { private: true },
    pendingInputs: [{ inputId: 'input', functionName: 'adk_request_confirmation' }] };
  function setup(patch = {}) {
    const work = { listWaitingRoots: jest.fn().mockResolvedValue([
      { id: 'execution', rootAgentId: 'root', resultPayload: { nativeState } },
    ]) };
    const service = new RootInputService({ getConversationDocument: jest.fn().mockResolvedValue({ ...conversation, ...patch }) } as never,
      work as never, { publicSnapshot: jest.fn().mockResolvedValue({ epoch: 4, rootAgentId: 'root', jobs: [] }) } as never,
      { authorizeBackgroundExecution: jest.fn() } as never, { get: jest.fn().mockReturnValue(false) } as never);
    return { work, service };
  }
  it('returns a purpose-built projection only for its actor and current binding/epoch', async () => {
    const { work, service } = setup();
    expect(await service.getPendingInputs('conversation', 'owner')).toEqual([
      { executionId: 'execution', epoch: 4, inputs: [{ inputId: 'input', inputVersion: 1, kind: 'confirmation' }] },
    ]);
    expect(work.listWaitingRoots).toHaveBeenCalledWith('conversation', 4);
  });
  it('projects an authorized background approval with its route discriminator and no native credentials', async () => {
    const jobs = { publicSnapshot: jest.fn().mockResolvedValue({ epoch: 4, rootAgentId: 'root', jobs: [
      { executionId: 'background', status: 'waiting', nativeState },
    ] }) };
    const results = { authorizeBackgroundExecution: jest.fn().mockResolvedValue({}) };
    const service = new RootInputService({ getConversationDocument: jest.fn().mockResolvedValue(conversation) } as never,
      { listWaitingRoots: jest.fn().mockResolvedValue([]) } as never, jobs as never, results as never,
      { get: jest.fn().mockReturnValue(true) } as never);
    expect(await service.getPendingInputs('conversation', 'owner')).toEqual([
      { executionId: 'background', epoch: 4, mode: 'background', inputs: [{ inputId: 'input', inputVersion: 1, kind: 'confirmation' }] },
    ]);
    expect(results.authorizeBackgroundExecution).toHaveBeenCalledWith('conversation', 'background', 'owner');
    results.authorizeBackgroundExecution.mockRejectedValueOnce(new Error('revoked'));
    await expect(service.getPendingInputs('conversation', 'owner')).rejects.toThrow('revoked');
  });
  it.each(['member', 'project-reader', 'guest'])('does not disclose private requests to %s', async (actor) => {
    const { work, service } = setup();
    expect(await service.getPendingInputs('conversation', actor)).toEqual([]);
    expect(work.listWaitingRoots).not.toHaveBeenCalled();
  });
  it('drops archived/group/changed-binding requests and another execution actor', async () => {
    for (const patch of [{ isArchived: true }, { isGroup: true }, { rootAgentId: 'changed' }]) {
      expect(await setup(patch).service.getPendingInputs('conversation', 'owner')).toEqual([]);
    }
    const { work, service } = setup();
    work.listWaitingRoots.mockResolvedValue([{ id: 'execution', rootAgentId: 'root',
      resultPayload: { nativeState: { ...nativeState, actorId: 'other' } } }] as never);
    expect(await service.getPendingInputs('conversation', 'owner')).toEqual([]);
  });
});
