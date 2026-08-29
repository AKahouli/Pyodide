import { createHash, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { ConversationPlaybookHandoffService } from './conversation-playbook-handoff.service';

const query = (value: unknown) => ({ lean: () => ({ exec: async () => value }) });

describe('ConversationPlaybookHandoffService', () => {
  it('prepares an idempotent dedicated Platform Copilot conversation', async () => {
    const ownerId = new Types.ObjectId().toString();
    const sourceConversationId = new Types.ObjectId().toString();
    const questionId = new Types.ObjectId();
    const targetMessageId = new Types.ObjectId();
    const platformConversationId = new Types.ObjectId().toString();
    const creationRequestId = randomUUID();
    const activeBranches = { [questionId.toString()]: targetMessageId.toString() };
    const fingerprintInput = {
      contractVersion: 1,
      targetMessageId: targetMessageId.toString(),
      displayedAnswerVersion: 'original',
      activeBranches: Object.entries(activeBranches),
    };
    const branchSelectionFingerprint = createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex');
    const context = {
      contextVersion: 1, executionSummaries: [], planSteps: [], actions: [], agents: [], skills: [], references: [],
      projection: { generatedAt: new Date().toISOString(), sourceMessageCount: 2, includedMessageCount: 2, omissions: {} },
    };
    const model = {
      findOne: jest.fn().mockReturnValue(query(null)),
      create: jest.fn(async (value: Record<string, unknown>) => ({ toObject: () => value })),
    };
    const path = [
      { _id: questionId, conversationType: 'user', content: 'Build this' },
      { _id: targetMessageId, conversationType: 'ai', components: [], questionMessageId: questionId },
    ];
    const branchService = {
      resolveCanonicalPath: jest.fn().mockResolvedValue({
        source: { workspaces: [new Types.ObjectId()] },
        messages: path,
        path,
        selectedAnswerIds: [targetMessageId.toString()],
        fingerprint: 'canonical-fingerprint',
      }),
    };
    const projector = {
      resolveDisplayedAnswer: jest.fn().mockReturnValue({ version: 'original', components: [] }),
      project: jest.fn().mockReturnValue({ context, preview: { executionSummaries: [], planSteps: [], actions: [], resources: [], omissions: {} } }),
    };
    const conversationService = { create: jest.fn().mockResolvedValue({ id: platformConversationId }) };
    const service = new ConversationPlaybookHandoffService(model as never, branchService as never, projector as never, conversationService as never);

    const result = await service.prepare(sourceConversationId, ownerId, {
      contractVersion: 1,
      targetMessageId: targetMessageId.toString(),
      displayedAnswerVersion: 'original',
      activeBranches,
      branchSelectionFingerprint,
      creationRequestId,
    });

    expect(result).toEqual(expect.objectContaining({ status: 'prepared', platformConversationId }));
    expect(conversationService.create).toHaveBeenCalledWith(ownerId, {
      runtimePurpose: 'platform_copilot',
      creationRequestId: `playbook-handoff:${creationRequestId}`,
    });
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: expect.any(Types.ObjectId),
      platformConversationId: expect.any(Types.ObjectId),
      defaultWorkspaceIds: [expect.any(String)],
      expiresAt: expect.any(Date),
    }));
  });

  it('rejects binding an expired handoff', async () => {
    const ownerId = new Types.ObjectId();
    const platformConversationId = new Types.ObjectId();
    const model = {
      findOneAndUpdate: jest.fn().mockReturnValue(query(null)),
      findOne: jest.fn().mockReturnValue(query({
        ownerId,
        platformConversationId,
        expiresAt: new Date(Date.now() - 1_000),
      })),
    };
    const service = new ConversationPlaybookHandoffService(model as never, {} as never, {} as never, {} as never);

    try {
      await service.bind({
        handoffId: randomUUID(), ownerId: ownerId.toString(), platformConversationId: platformConversationId.toString(),
        turnRequestId: 'turn-1', prompt: 'Create it',
      });
      throw new Error('Expected binding to fail');
    } catch (error) {
      expect((error as { getStatus: () => number }).getStatus()).toBe(410);
    }
  });

  it('consumes only the exact bound owner, conversation, turn, and user message', async () => {
    const ownerId = new Types.ObjectId();
    const platformConversationId = new Types.ObjectId();
    const userMessageId = new Types.ObjectId();
    const handoffId = randomUUID();
    const consumedAt = new Date();
    const handoff = {
      _id: new Types.ObjectId(),
      handoffId,
      status: 'bound',
      sourceConversationId: new Types.ObjectId(),
      targetMessageId: new Types.ObjectId(),
      displayedAnswerVersion: 'original',
      canonicalPathFingerprint: 'canonical',
      contextFingerprint: 'context',
      context: { contextVersion: 1 },
      defaultWorkspaceIds: [],
      consumedAt,
    };
    const model = {
      findOne: jest.fn().mockReturnValue(query(handoff)),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
    };
    const service = new ConversationPlaybookHandoffService(model as never, {} as never, {} as never, {} as never);

    await expect(service.consume({
      handoffId,
      ownerId: ownerId.toString(),
      platformConversationId: platformConversationId.toString(),
      turnRequestId: 'turn-1',
      userMessageId: userMessageId.toString(),
    })).resolves.toEqual(expect.objectContaining({ handoffId, acceptedAt: consumedAt.toISOString() }));
    expect(model.findOne).toHaveBeenCalledWith({
      handoffId,
      ownerId: expect.any(Types.ObjectId),
      platformConversationId: expect.any(Types.ObjectId),
      boundTurnRequestId: 'turn-1',
      boundUserMessageId: expect.any(Types.ObjectId),
      status: { $in: ['bound', 'consumed'] },
    });
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: handoff._id, status: 'bound' },
      { $set: { status: 'consumed', consumedAt: expect.any(Date) } },
    );
  });
});
