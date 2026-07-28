import { CorrectiveReplayFailure, CorrectiveReplayRunnerService } from './corrective-replay-runner.service';

describe('CorrectiveReplayRunnerService', () => {
  it('uses an isolated seeded session, collects privately, filters internals, and cleans up', async () => {
    const streamService = {
      seedConversationSession: jest.fn().mockResolvedValue(undefined),
      deleteConversationSession: jest.fn().mockResolvedValue(undefined),
      buildAgentExecutionRequest: jest.fn().mockResolvedValue({ rpc: 'RunSingleAgent', payload: {} }),
      executePrivateAgentRequest: jest.fn().mockReturnValue({
        started: Promise.resolve(),
        result: Promise.resolve({
          components: [
            { id: 'text-1', type: 'text', data: { content: 'Corrected answer' } },
            { id: 'reasoning-1', type: 'reasoning', data: { content: 'Private' } },
            { id: 'task-1', type: 'task', data: { title: 'Smart Agent', items: ['Raw replay context'], status: 'completed' } },
            { id: 'thought-1', type: 'chainOfThought', data: { steps: ['Reviewing the request', '<corrective_replay_context>private</corrective_replay_context>'] } },
            { id: 'tool-1', type: 'toolInfo', data: { title: 'search_documents', status: 'completed', params: '{"token":"private"}', resultJson: '{"private":true}', startedAt: '2026-07-28T08:00:00Z' } },
            { id: 'citation-1', type: 'citation', data: { content: 'Evidence' } },
          ],
          usage: { inputTokens: 12, outputTokens: 8, model: 'model', durationMs: 25 },
        }),
      }),
    };
    const usageService = { recordUsage: jest.fn().mockResolvedValue(undefined) };
    const service = new CorrectiveReplayRunnerService(
      streamService as never,
      { findAllByConversation: jest.fn().mockResolvedValue([]) } as never,
      { build: jest.fn().mockReturnValue({ userQuery: 'Question?', correctionContext: {
        originalAnswer: 'Original', findings: [], attemptNumber: 1, instructions: 'Retry',
      } }) } as never,
      usageService as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
    );

    const result = await service.run({
      userId: 'user-1', conversationId: 'conversation-1', messageId: 'message-1',
      questionMessageId: 'question-1', request: {
        content: 'Question?', attachedFileIds: [], webSearchEnabled: false,
        deepSearchEnabled: false, agentIds: [], skillIds: [],
      },
      originalComponents: [{ id: 'original', type: 'text', data: { content: 'Original' } }],
      evaluation: { status: 'completed' }, attemptNumber: 1, timeoutMs: 1_000,
    });

    const seededSession = streamService.seedConversationSession.mock.calls[0][1] as string;
    expect(seededSession).toMatch(/^correction:conversation-1:message-1:1:/);
    expect(streamService.buildAgentExecutionRequest).toHaveBeenCalledWith(
      'user-1', 'conversation-1', expect.any(Object), undefined, expect.any(Object), expect.any(Object), seededSession,
    );
    expect(streamService.deleteConversationSession).toHaveBeenCalledWith('user-1', seededSession, expect.any(String));
    expect(result.components.map((component) => component.type)).toEqual(['text', 'task', 'chainOfThought', 'toolInfo', 'citation']);
    expect(result.components.find((component) => component.type === 'chainOfThought')?.data).toEqual({ steps: ['Reviewing the request'] });
    expect(result.components.find((component) => component.type === 'toolInfo')?.data).toEqual({ title: 'search_documents', status: 'completed', startedAt: '2026-07-28T08:00:00Z' });
    expect(result.evidenceComponents.map((component) => component.type)).toEqual(['text', 'reasoning', 'task', 'chainOfThought', 'toolInfo', 'citation']);
    expect(usageService.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ feature: 'response_correction_replay' }),
    }));
  });

  it('classifies empty-history seed failure before replay starts', async () => {
    const streamService = {
      seedConversationSession: jest.fn().mockRejectedValue(new Error('unavailable')),
      deleteConversationSession: jest.fn(),
      buildAgentExecutionRequest: jest.fn(),
      executePrivateAgentRequest: jest.fn(),
    };
    const service = new CorrectiveReplayRunnerService(
      streamService as never,
      { findAllByConversation: jest.fn().mockResolvedValue([]) } as never,
      { build: jest.fn().mockReturnValue({ userQuery: 'Question?', correctionContext: {} }) } as never,
      { recordUsage: jest.fn() } as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
    );
    const run = service.run({
      userId: 'user-1', conversationId: 'conversation-1', messageId: 'message-1', questionMessageId: 'question-1',
      request: { content: 'Question?', attachedFileIds: [], webSearchEnabled: false, deepSearchEnabled: false, agentIds: [], skillIds: [] },
      originalComponents: [], evaluation: { status: 'completed' }, attemptNumber: 1, timeoutMs: 1_000,
    });
    await expect(run).rejects.toMatchObject<Partial<CorrectiveReplayFailure>>({
      code: 'corrective_replay_session_seed_failed', replayStarted: false,
    });
    expect(streamService.executePrivateAgentRequest).not.toHaveBeenCalled();
    expect(streamService.deleteConversationSession).not.toHaveBeenCalled();
  });

  it('classifies a synchronous transport availability failure before replay starts and cleans the seed', async () => {
    const streamService = {
      seedConversationSession: jest.fn().mockResolvedValue(undefined),
      deleteConversationSession: jest.fn().mockResolvedValue(undefined),
      buildAgentExecutionRequest: jest.fn().mockResolvedValue({ rpc: 'RunSingleAgent', payload: {} }),
      executePrivateAgentRequest: jest.fn(() => { throw new Error('unavailable'); }),
    };
    const service = new CorrectiveReplayRunnerService(
      streamService as never,
      { findAllByConversation: jest.fn().mockResolvedValue([]) } as never,
      { build: jest.fn().mockReturnValue({ userQuery: 'Question?', correctionContext: {} }) } as never,
      { recordUsage: jest.fn() } as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
    );
    const run = service.run({
      userId: 'user-1', conversationId: 'conversation-1', messageId: 'message-1', questionMessageId: 'question-1',
      request: { content: 'Question?', attachedFileIds: [], webSearchEnabled: false, deepSearchEnabled: false, agentIds: [], skillIds: [] },
      originalComponents: [], evaluation: { status: 'completed' }, attemptNumber: 1, timeoutMs: 1_000,
    });
    await expect(run).rejects.toMatchObject({ code: 'corrective_replay_grpc_unavailable', replayStarted: false });
    expect(streamService.deleteConversationSession).toHaveBeenCalled();
  });

  it('classifies asynchronous transport rejection before acknowledgement as pre-start', async () => {
    const transportError = new Error('handshake failed');
    const streamService = {
      seedConversationSession: jest.fn().mockResolvedValue(undefined),
      deleteConversationSession: jest.fn().mockResolvedValue(undefined),
      buildAgentExecutionRequest: jest.fn().mockResolvedValue({ rpc: 'RunSingleAgent', payload: {} }),
      executePrivateAgentRequest: jest.fn().mockReturnValue({
        started: Promise.reject(transportError), result: Promise.reject(transportError),
      }),
    };
    const service = new CorrectiveReplayRunnerService(
      streamService as never,
      { findAllByConversation: jest.fn().mockResolvedValue([]) } as never,
      { build: jest.fn().mockReturnValue({ userQuery: 'Question?', correctionContext: {} }) } as never,
      { recordUsage: jest.fn() } as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
    );
    const run = service.run({
      userId: 'user-1', conversationId: 'conversation-1', messageId: 'message-1', questionMessageId: 'question-1',
      request: { content: 'Question?', attachedFileIds: [], webSearchEnabled: false, deepSearchEnabled: false, agentIds: [], skillIds: [] },
      originalComponents: [], evaluation: { status: 'completed' }, attemptNumber: 1, timeoutMs: 1_000,
    });
    await expect(run).rejects.toMatchObject({ replayStarted: false });
    expect(streamService.deleteConversationSession).toHaveBeenCalled();
  });

  it('retries idempotent shadow-session cleanup without invalidating the result', async () => {
    const streamService = {
      seedConversationSession: jest.fn().mockResolvedValue(undefined),
      deleteConversationSession: jest.fn()
        .mockRejectedValueOnce(new Error('temporary'))
        .mockRejectedValueOnce(new Error('temporary'))
        .mockResolvedValueOnce(undefined),
      buildAgentExecutionRequest: jest.fn().mockResolvedValue({ rpc: 'RunSingleAgent', payload: {} }),
      executePrivateAgentRequest: jest.fn().mockReturnValue({
        started: Promise.resolve(),
        result: Promise.resolve({ components: [{ id: 'text', type: 'text', data: { content: 'Answer' } }], usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 } }),
      }),
    };
    const service = new CorrectiveReplayRunnerService(
      streamService as never,
      { findAllByConversation: jest.fn().mockResolvedValue([]) } as never,
      { build: jest.fn().mockReturnValue({ userQuery: 'Question?', correctionContext: {} }) } as never,
      { recordUsage: jest.fn().mockResolvedValue(undefined) } as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
    );
    await expect(service.run({
      userId: 'user-1', conversationId: 'conversation-1', messageId: 'message-1', questionMessageId: 'question-1',
      request: { content: 'Question?', attachedFileIds: [], webSearchEnabled: false, deepSearchEnabled: false, agentIds: [], skillIds: [] },
      originalComponents: [], evaluation: { status: 'completed' }, attemptNumber: 1, timeoutMs: 1_000,
    })).resolves.toEqual(expect.objectContaining({ promptVersion: 'corrective-replay-v2' }));
    expect(streamService.deleteConversationSession).toHaveBeenCalledTimes(3);
  });
});
