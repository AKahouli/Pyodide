import { ConversationAgentRequestBuilder } from './conversation-agent-request.builder';

describe('ConversationAgentRequestBuilder', () => {
  const request = {
    content: 'Question', attachedFileIds: ['file-1'], webSearchEnabled: true,
    deepSearchEnabled: true, modelId: 'model-1', agentIds: ['agent-1'], skillIds: ['skill-1'],
    connectorRepo: { connectorId: 'connector-1', connectorName: 'GitHub', repoId: 'repo-1', repoName: 'repo' },
  };

  it('preserves the execution payload and routes a single resolved agent', () => {
    const result = new ConversationAgentRequestBuilder().build({
      userId: 'user-1', conversationId: 'shadow-1', request,
      workspaceContexts: [{ workspace_id: 'workspace-1' }], agents: [{ id: 'agent-1' }],
      attachedFiles: [{ type: 'document' }], previousAttachedFiles: [{ _id: 'old-file' }], skills: [{ id: 'skill-1' }],
      correctionReplayContext: { originalAnswer: 'Old', findings: [], attemptNumber: 1, instructions: 'Retry' },
    });
    expect(result.rpc).toBe('RunSingleAgent');
    expect(result.payload).toEqual(expect.objectContaining({
      conversation_id: 'shadow-1', query: 'Question', deep_search_enabled: true,
      agent: { id: 'agent-1' }, skills: [{ id: 'skill-1' }],
      correction_replay_context: expect.objectContaining({ original_answer: 'Old', attempt_number: 1 }),
    }));
  });

  it('routes multiple resolved agents through the team RPC', () => {
    const result = new ConversationAgentRequestBuilder().build({
      userId: 'user-1', conversationId: 'shadow-1', request,
      workspaceContexts: [], agents: [{ id: 'worker' }, { id: 'manager' }],
      attachedFiles: [], previousAttachedFiles: [], skills: [],
    });
    expect(result).toEqual(expect.objectContaining({ rpc: 'RunAgentTeam' }));
    expect(result.payload).toEqual(expect.objectContaining({ agent_mode: 'manual' }));
  });
});
