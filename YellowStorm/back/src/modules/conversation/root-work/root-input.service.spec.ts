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
      work as never);
    return { work, service };
  }
  it('returns a purpose-built projection only for its actor and current binding/epoch', async () => {
    const { work, service } = setup();
    expect(await service.getPendingInputs('conversation', 'owner')).toEqual([
      { executionId: 'execution', epoch: 4, inputs: [{ inputId: 'input', inputVersion: 1, kind: 'confirmation' }] },
    ]);
    expect(work.listWaitingRoots).toHaveBeenCalledWith('conversation', 4);
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
