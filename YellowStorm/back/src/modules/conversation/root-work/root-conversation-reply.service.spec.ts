import { RootConversationReplyService } from './root-conversation-reply.service';

describe('Root conversation reply cancellation', () => {
  const targetId = 'a'.repeat(24);
  const selfId = 'b'.repeat(24);
  function fixture() {
    const state = { actorId: 'owner', origin: { assistantMessageId: selfId },
      scope: { executionId: 'caller', immutableSnapshotRef: 'digest' }, rootContext: { root_agent_id: 'root',
        ongoing_requests: [{ question_message_id: 'museum', assistant_message_ids: [targetId] }] } };
    const parent = { id: 'caller', role: 'root', depth: 0, status: 'running', conversationId: 'chat', rootAgentId: 'root',
      conversationEpoch: 3, resultPayload: { nativeState: state } };
    const conversation = { createdBy: 'owner', rootAgentId: 'root', rootWorkEpoch: 3, isGroup: false, isArchived: false };
    const target = { id: targetId, conversationId: 'chat', conversationType: 'ai', questionMessageId: 'museum', isComplete: false, isStreaming: true };
    const work = { getExecution: jest.fn().mockResolvedValue(parent) };
    const conversations = { getConversationDocument: jest.fn().mockResolvedValue(conversation) };
    const resolver = { resolveForActor: jest.fn().mockResolvedValue({ rootSnapshotDigest: 'digest' }) };
    const messages = { findById: jest.fn().mockResolvedValue(target) };
    const stream = { stopStream: jest.fn().mockResolvedValue(undefined) };
    const service = new RootConversationReplyService(work as never, conversations as never, resolver as never, messages as never, stream as never);
    return { service, state, parent, conversation, target, resolver, stream };
  }
  it('targets only the snapshot reply and acknowledges intent, not confirmed termination', async () => {
    const h = fixture();
    expect(await h.service.cancel('caller', targetId)).toEqual({ messageId: targetId, status: 'cancellation_requested' });
    expect(h.stream.stopStream).toHaveBeenCalledTimes(1);
    expect(h.stream.stopStream).toHaveBeenCalledWith('owner', 'chat', targetId);
    expect(h.conversation.rootWorkEpoch).toBe(3);
  });
  it.each(['role', 'depth', 'status', 'actor', 'epoch', 'root', 'archived', 'group', 'snapshot', 'foreign', 'user', 'question', 'digest', 'scope'])('rejects invalid %s before stopping', async (field) => {
    const h = fixture();
    if (field === 'role') h.parent.role = 'temporary_worker';
    if (field === 'depth') h.parent.depth = 1;
    if (field === 'status') h.parent.status = 'completed';
    if (field === 'actor') h.conversation.createdBy = 'other';
    if (field === 'epoch') h.conversation.rootWorkEpoch++;
    if (field === 'root') h.conversation.rootAgentId = 'other';
    if (field === 'archived') h.conversation.isArchived = true;
    if (field === 'group') h.conversation.isGroup = true;
    if (field === 'snapshot') h.state.rootContext.ongoing_requests = [];
    if (field === 'foreign') h.target.conversationId = 'foreign';
    if (field === 'user') h.target.conversationType = 'user';
    if (field === 'question') h.target.questionMessageId = 'different';
    if (field === 'digest') h.resolver.resolveForActor.mockResolvedValue({ rootSnapshotDigest: 'changed' });
    if (field === 'scope') h.state.scope.executionId = 'other';
    await expect(h.service.cancel('caller', targetId)).rejects.toThrow('not currently authorized');
    expect(h.stream.stopStream).not.toHaveBeenCalled();
  });
  it.each([selfId, 'c'.repeat(24), 'invalid'])('rejects self/guessed/malformed target %s', async (id) => {
    const h = fixture();
    await expect(h.service.cancel('caller', id)).rejects.toThrow();
    expect(h.stream.stopStream).not.toHaveBeenCalled();
  });
  it('does not mutate a terminal reply or turn a stop failure into success', async () => {
    const h = fixture(); h.target.isComplete = true; h.target.isStreaming = false;
    expect((await h.service.cancel('caller', targetId)).status).toBe('already_terminal');
    expect(h.stream.stopStream).not.toHaveBeenCalled();
    h.target.isComplete = false; h.target.isStreaming = true;
    h.stream.stopStream.mockRejectedValue(new Error('stop failed'));
    await expect(h.service.cancel('caller', targetId)).rejects.toThrow('stop failed');
  });
});
