import { Types } from 'mongoose';
import { ConversationBranchService } from './conversation-branch.service';

const objectId = () => new Types.ObjectId().toString();

function buildService(overrides: Record<string, unknown> = {}) {
  const branchStore = {
    findByRequest: jest.fn(),
    createPending: jest.fn(),
    claimSeed: jest.fn(),
    finalizeSeed: jest.fn(),
    ownsSeed: jest.fn(),
    markCleanup: jest.fn(),
    deleteCleanup: jest.fn(),
    claimStale: jest.fn().mockResolvedValue([]),
    ...(overrides.branchStore as object),
  };
  const conversationStore = {
    findById: jest.fn(),
    ...(overrides.conversationStore as object),
  };
  const messageStore = {
    listByConversation: jest.fn(),
    ...(overrides.messageStore as object),
  };
  const conversationService = {
    findById: jest.fn(),
    ...(overrides.conversationService as object),
  };
  const streamService = {
    seedConversationSession: jest.fn(),
    deleteConversationSession: jest.fn(),
    ...(overrides.streamService as object),
  };
  const logger = { setContext: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const service = new ConversationBranchService(
    branchStore as never,
    conversationStore as never,
    messageStore as never,
    conversationService as never,
    streamService as never,
    logger as never,
  );
  return { service, branchStore, conversationStore, messageStore, conversationService, streamService };
}

describe('ConversationBranchService path selection', () => {
  const { service } = buildService();

  it('uses the selected regenerated response and omits its sibling', () => {
    const questionId = objectId();
    const firstAnswerId = objectId();
    const selectedAnswerId = objectId();
    const messages = [
      { id: questionId, conversationType: 'user', content: 'question' },
      { id: firstAnswerId, conversationType: 'ai', questionMessageId: questionId, isComplete: true, isStreaming: false },
      { id: selectedAnswerId, conversationType: 'ai', questionMessageId: questionId, isComplete: true, isStreaming: false },
    ];

    const path = (service as any).derivePath(messages, {
      requestId: crypto.randomUUID(),
      targetMessageId: selectedAnswerId,
      activeBranches: { [questionId]: selectedAnswerId },
    });

    expect(path.map((message: { id: string }) => message.id)).toEqual([
      questionId,
      selectedAnswerId,
    ]);
  });

  it('rejects an answer selected for a different question', () => {
    const firstQuestionId = objectId();
    const secondQuestionId = objectId();
    const answerId = objectId();
    const messages = [
      { id: firstQuestionId, conversationType: 'user' },
      { id: secondQuestionId, conversationType: 'user' },
      { id: answerId, conversationType: 'ai', questionMessageId: secondQuestionId, isComplete: true, isStreaming: false },
    ];

    expect(() => (service as any).derivePath(messages, {
      requestId: crypto.randomUUID(),
      targetMessageId: answerId,
      activeBranches: { [firstQuestionId]: answerId },
    })).toThrow('Invalid selected AI response');
  });

  it('normalizes only user and assistant text for ADK history', () => {
    const history = (service as any).toHistory([
      { conversationType: 'user', content: '  hello  ' },
      {
        conversationType: 'ai',
        components: [
          { type: 'toolActivity', data: { name: 'search' } },
          { type: 'text', data: { content: ' answer ' } },
        ],
      },
    ]);
    expect(history).toEqual([
      { role: 'CONVERSATION_HISTORY_ROLE_USER', text: 'hello' },
      { role: 'CONVERSATION_HISTORY_ROLE_ASSISTANT', text: 'answer' },
    ]);
  });
});

describe('ConversationBranchService initialization lease', () => {
  function setup(seedFails = false) {
    const sourceId = objectId();
    const userId = objectId();
    const questionId = objectId();
    const answerId = objectId();
    const destinationId = objectId();
    const source = {
      id: sourceId,
      createdBy: userId,
      runtimeMode: 'standard',
      isGroup: false,
      title: 'Source',
      members: [],
    };
    const messages = [
      { id: questionId, conversationType: 'user', content: 'question' },
      {
        id: answerId,
        conversationType: 'ai',
        questionMessageId: questionId,
        isComplete: true,
        isStreaming: false,
        components: [{ type: 'text', data: { content: 'answer' } }],
      },
    ];
    const dto = {
      requestId: 'request-1',
      targetMessageId: answerId,
      activeBranches: { [questionId]: answerId },
    };
    const response = { id: destinationId };
    const setupResult = buildService({
      conversationStore: { findById: jest.fn().mockResolvedValue(source) },
      messageStore: { listByConversation: jest.fn().mockResolvedValue(messages) },
      conversationService: { findById: jest.fn().mockResolvedValue(response) },
      streamService: {
        seedConversationSession: jest.fn().mockImplementation(async () => {
          if (seedFails) throw new Error('seed failed');
        }),
        deleteConversationSession: jest.fn().mockResolvedValue(undefined),
      },
    });
    const fingerprint = (setupResult.service as any).requestFingerprint(dto);
    const destination = {
      id: destinationId,
      createdBy: userId,
      initializationStatus: 'pending',
      sourceConversationId: sourceId,
      sourceTargetMessageId: answerId,
      requestId: dto.requestId,
      requestFingerprint: fingerprint,
    };
    setupResult.branchStore.findByRequest.mockResolvedValue(destination);
    setupResult.branchStore.claimSeed
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    setupResult.branchStore.finalizeSeed.mockResolvedValue(true);
    setupResult.branchStore.ownsSeed.mockResolvedValue(true);
    setupResult.branchStore.markCleanup.mockResolvedValue(true);
    (setupResult.service as any).waitForBranch = jest.fn().mockResolvedValue(response);
    return { ...setupResult, sourceId, userId, dto };
  }

  it('seeds once when the same request runs concurrently', async () => {
    const { service, streamService, sourceId, userId, dto } = setup();
    const results = await Promise.all([
      service.createBranch(sourceId, userId, dto),
      service.createBranch(sourceId, userId, dto),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(streamService.seedConversationSession).toHaveBeenCalledTimes(1);
  });

  it('allows only the initialization owner to compensate a failed seed', async () => {
    const { service, branchStore, streamService, sourceId, userId, dto } = setup(true);
    const results = await Promise.allSettled([
      service.createBranch(sourceId, userId, dto),
      service.createBranch(sourceId, userId, dto),
    ]);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(streamService.deleteConversationSession).toHaveBeenCalledTimes(1);
    expect(branchStore.deleteCleanup).toHaveBeenCalledTimes(1);
  });

  it('returns an idempotent ready branch without reading source messages', async () => {
    const sourceId = objectId();
    const userId = objectId();
    const targetId = objectId();
    const destinationId = objectId();
    const dto = { requestId: 'request-1', targetMessageId: targetId, activeBranches: {} };
    const setupResult = buildService({
      conversationStore: {
        findById: jest.fn().mockResolvedValue({
          id: sourceId,
          createdBy: userId,
          runtimeMode: 'standard',
          isGroup: false,
          members: [],
        }),
      },
      conversationService: { findById: jest.fn().mockResolvedValue({ id: destinationId }) },
    });
    setupResult.branchStore.findByRequest.mockResolvedValue({
      id: destinationId,
      createdBy: userId,
      initializationStatus: 'ready',
      sourceConversationId: sourceId,
      sourceTargetMessageId: targetId,
      requestId: dto.requestId,
      requestFingerprint: (setupResult.service as any).requestFingerprint(dto),
    });
    await expect(setupResult.service.createBranch(sourceId, userId, dto)).resolves.toEqual({
      id: destinationId,
    });
    expect(setupResult.messageStore.listByConversation).not.toHaveBeenCalled();
  });
});

describe('ConversationBranchService stale cleanup', () => {
  it('deletes only branches atomically claimed by the store', async () => {
    const branch = {
      id: objectId(),
      createdBy: objectId(),
      requestId: 'request-1',
      initializationStatus: 'cleanup_pending',
      sourceConversationId: objectId(),
      sourceTargetMessageId: objectId(),
      requestFingerprint: 'fingerprint',
    };
    const { service, branchStore, streamService } = buildService({
      branchStore: { claimStale: jest.fn().mockResolvedValue([branch]) },
      streamService: { deleteConversationSession: jest.fn().mockResolvedValue(undefined) },
    });
    await service.cleanupStaleBranches();
    expect(streamService.deleteConversationSession).toHaveBeenCalledWith(
      branch.createdBy,
      branch.id,
      branch.requestId,
    );
    expect(branchStore.deleteCleanup).toHaveBeenCalledWith(branch.id);
  });
});
