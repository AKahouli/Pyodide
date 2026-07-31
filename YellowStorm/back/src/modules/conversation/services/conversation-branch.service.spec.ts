import { Types } from 'mongoose';
import { ConversationBranchService } from './conversation-branch.service';

describe('ConversationBranchService path selection', () => {
  const service = new ConversationBranchService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { setContext: jest.fn() } as never,
  );

  const id = () => new Types.ObjectId();

  it('uses the selected regenerated response and omits its sibling', () => {
    const questionId = id();
    const firstAnswerId = id();
    const selectedAnswerId = id();
    const messages = [
      { _id: questionId, conversationType: 'user', content: 'question' },
      { _id: firstAnswerId, conversationType: 'ai', questionMessageId: questionId, isComplete: true, isStreaming: false },
      { _id: selectedAnswerId, conversationType: 'ai', questionMessageId: questionId, isComplete: true, isStreaming: false },
    ];

    const path = (service as any).derivePath(messages, {
      requestId: crypto.randomUUID(),
      targetMessageId: selectedAnswerId.toString(),
      activeBranches: { [questionId.toString()]: selectedAnswerId.toString() },
    });

    expect(path.map((message: any) => message._id.toString())).toEqual([
      questionId.toString(),
      selectedAnswerId.toString(),
    ]);
  });

  it('rejects an answer selected for a different question', () => {
    const firstQuestionId = id();
    const secondQuestionId = id();
    const answerId = id();
    const messages = [
      { _id: firstQuestionId, conversationType: 'user' },
      { _id: secondQuestionId, conversationType: 'user' },
      { _id: answerId, conversationType: 'ai', questionMessageId: secondQuestionId, isComplete: true, isStreaming: false },
    ];

    expect(() => (service as any).derivePath(messages, {
      requestId: crypto.randomUUID(),
      targetMessageId: answerId.toString(),
      activeBranches: { [firstQuestionId.toString()]: answerId.toString() },
    })).toThrow('Invalid selected AI response');
  });

  it('normalizes only user and assistant text for ADK history', () => {
    const history = (service as any).toHistory([
      { conversationType: 'user', content: '  hello  ' },
      {
        conversationType: 'ai',
        components: [
          { type: 'toolInfo', data: { name: 'search' } },
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
    const sourceId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const questionId = new Types.ObjectId();
    const answerId = new Types.ObjectId();
    const destinationId = new Types.ObjectId();
    const source = { _id: sourceId, createdBy: userId, runtimeMode: 'standard' };
    const messages = [
      { _id: questionId, conversationType: 'user', content: 'question' },
      {
        _id: answerId,
        conversationType: 'ai',
        questionMessageId: questionId,
        isComplete: true,
        isStreaming: false,
        components: [{ type: 'text', data: { content: 'answer' } }],
      },
    ];
    const destination = {
      _id: destinationId,
      initializationStatus: 'pending',
      branchProvenance: {
        sourceConversationId: sourceId,
        sourceTargetMessageId: answerId,
        requestId: 'request-1',
        requestFingerprint: '',
        selectedAnswerIds: [answerId],
      },
    };
    const query = (value: unknown) => ({ lean: () => ({ exec: async () => value }), exec: async () => value });
    const conversationModel = {
      findOne: jest.fn((filter: Record<string, unknown>) => query('_id' in filter ? source : destination)),
      findOneAndUpdate: jest.fn()
        .mockReturnValueOnce({ exec: async () => ({ ...destination, initializationStatus: 'seeding' }) })
        .mockReturnValueOnce({ exec: async () => null }),
      updateOne: jest.fn(() => ({ exec: async () => ({ modifiedCount: 1 }) })),
      exists: jest.fn(async () => ({ _id: destinationId })),
    };
    const messageModel = {
      find: jest.fn(() => ({ sort: () => ({ lean: () => ({ exec: async () => messages }) }) })),
    };
    let finishSeed!: () => void;
    const seedFinished = new Promise<void>((resolve) => { finishSeed = resolve; });
    const streamService = {
      seedConversationSession: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        finishSeed();
        if (seedFails) throw new Error('seed failed');
      }),
      deleteConversationSession: jest.fn(async () => undefined),
    };
    const response = { id: destinationId.toString() };
    const service = new ConversationBranchService(
      conversationModel as never,
      messageModel as never,
      { findById: jest.fn(async () => response) } as never,
      streamService as never,
      { setContext: jest.fn(), error: jest.fn(), warn: jest.fn() } as never,
    );
    (service as any).waitForBranch = jest.fn(async () => {
      await seedFinished;
      if (seedFails) throw new Error('seed failed');
      return response;
    });
    (service as any).deletePendingClone = jest.fn(async () => undefined);
    const dto = {
      requestId: 'request-1',
      targetMessageId: answerId.toString(),
      activeBranches: { [questionId.toString()]: answerId.toString() },
    };
    destination.branchProvenance.requestFingerprint = (service as any).requestFingerprint(dto);
    return { service, streamService, conversationModel, sourceId, userId, dto };
  }

  it('seeds once when the same request runs concurrently', async () => {
    const { service, streamService, sourceId, userId, dto } = setup();

    const results = await Promise.all([
      service.createBranch(sourceId.toString(), userId.toString(), dto),
      service.createBranch(sourceId.toString(), userId.toString(), dto),
    ]);

    expect(results[0].id).toBe(results[1].id);
    expect(streamService.seedConversationSession).toHaveBeenCalledTimes(1);
    expect(streamService.deleteConversationSession).not.toHaveBeenCalled();
  });

  it('allows only the initialization owner to compensate a failed concurrent seed', async () => {
    const { service, streamService, sourceId, userId, dto } = setup(true);

    const results = await Promise.allSettled([
      service.createBranch(sourceId.toString(), userId.toString(), dto),
      service.createBranch(sourceId.toString(), userId.toString(), dto),
    ]);

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(streamService.seedConversationSession).toHaveBeenCalledTimes(1);
    expect(streamService.deleteConversationSession).toHaveBeenCalledTimes(1);
  });

  it('returns the original ready branch when source answers changed after the request', async () => {
    const sourceId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const targetId = new Types.ObjectId();
    const destinationId = new Types.ObjectId();
    const dto = {
      requestId: 'request-1',
      targetMessageId: targetId.toString(),
      activeBranches: {},
    };
    const conversationModel = { findOne: jest.fn() };
    const messageModel = { find: jest.fn() };
    const response = { id: destinationId.toString() };
    const conversationService = { findById: jest.fn(async () => response) };
    const service = new ConversationBranchService(
      conversationModel as never,
      messageModel as never,
      conversationService as never,
      {} as never,
      { setContext: jest.fn() } as never,
    );
    const source = { _id: sourceId, createdBy: userId, runtimeMode: 'standard' };
    const destination = {
      _id: destinationId,
      initializationStatus: 'ready',
      branchProvenance: {
        sourceConversationId: sourceId,
        sourceTargetMessageId: targetId,
        requestId: dto.requestId,
        requestFingerprint: (service as any).requestFingerprint(dto),
        selectedAnswerIds: [targetId],
      },
    };
    conversationModel.findOne
      .mockReturnValueOnce({ lean: () => ({ exec: async () => source }) })
      .mockReturnValueOnce({ exec: async () => destination });

    await expect(service.createBranch(sourceId.toString(), userId.toString(), dto))
      .resolves.toEqual(response);
    expect(messageModel.find).not.toHaveBeenCalled();
  });
});

describe('ConversationBranchService standalone Mongo writes', () => {
  it('creates a pending clone without requiring a Mongo transaction', async () => {
    const sourceId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const questionId = new Types.ObjectId();
    const sourceTitle = 'S'.repeat(200);
    const conversationModel = {
      create: jest.fn(async (document) => document),
      deleteOne: jest.fn(() => ({ exec: async () => ({ deletedCount: 1 }) })),
    };
    const messageModel = {
      insertMany: jest.fn(async (documents) => documents),
      deleteMany: jest.fn(() => ({ exec: async () => ({ deletedCount: 0 }) })),
    };
    const service = new ConversationBranchService(
      conversationModel as never,
      messageModel as never,
      {} as never,
      {} as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
    );

    await (service as any).createPendingClone(
      { _id: sourceId, title: sourceTitle },
      [{ _id: questionId, conversationType: 'user', content: 'question' }],
      [],
      'fingerprint',
      userId.toString(),
      { requestId: 'request-1', targetMessageId: questionId.toString(), activeBranches: {} },
    );

    expect(conversationModel.create).toHaveBeenCalledWith(expect.objectContaining({
      title: `${'S'.repeat(191)} · Branch`,
      initializationStatus: 'pending',
    }));
    expect(messageModel.insertMany).toHaveBeenCalledWith(expect.any(Array));
  });

  it('removes partial standalone writes when message insertion fails', async () => {
    const sourceId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const questionId = new Types.ObjectId();
    const conversationModel = {
      create: jest.fn(async (document) => document),
      deleteOne: jest.fn(() => ({ exec: async () => ({ deletedCount: 1 }) })),
    };
    const messageModel = {
      insertMany: jest.fn(async () => { throw new Error('insert failed'); }),
      deleteMany: jest.fn(() => ({ exec: async () => ({ deletedCount: 1 }) })),
    };
    const service = new ConversationBranchService(
      conversationModel as never,
      messageModel as never,
      {} as never,
      {} as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
    );

    await expect((service as any).createPendingClone(
      { _id: sourceId, title: 'Source' },
      [{ _id: questionId, conversationType: 'user', content: 'question' }],
      [],
      'fingerprint',
      userId.toString(),
      { requestId: 'request-1', targetMessageId: questionId.toString(), activeBranches: {} },
    )).rejects.toThrow('insert failed');
    expect(messageModel.deleteMany).toHaveBeenCalled();
    expect(conversationModel.deleteOne).toHaveBeenCalled();
  });
});

describe('ConversationBranchService stale cleanup claim', () => {
  it('does not delete ADK state when a branch became active after the stale scan', async () => {
    const destinationId = new Types.ObjectId();
    const conversationModel = {
      find: jest.fn(() => ({
        select: () => ({ lean: () => ({ exec: async () => [{ _id: destinationId }] }) }),
      })),
      findOneAndUpdate: jest.fn(() => ({
        select: () => ({ lean: () => ({ exec: async () => null }) }),
      })),
    };
    const streamService = { deleteConversationSession: jest.fn() };
    const service = new ConversationBranchService(
      conversationModel as never,
      {} as never,
      {} as never,
      streamService as never,
      { setContext: jest.fn(), warn: jest.fn() } as never,
    );

    await service.cleanupStaleBranches();

    expect(conversationModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: destinationId,
        updatedAt: expect.any(Object),
      }),
      expect.any(Object),
      { new: true },
    );
    expect(streamService.deleteConversationSession).not.toHaveBeenCalled();
  });
});
