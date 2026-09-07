import { createHash, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { ConversationPlaybookHandoffRecord } from '../persistence/conversation-playbook-handoff-store';
import { ConversationPlaybookHandoffService } from './conversation-playbook-handoff.service';

function handoffRecord(
  overrides: Partial<ConversationPlaybookHandoffRecord> = {},
): ConversationPlaybookHandoffRecord {
  return {
    id: new Types.ObjectId().toString(),
    contractVersion: 1,
    handoffId: randomUUID(),
    ownerId: new Types.ObjectId().toString(),
    sourceConversationId: new Types.ObjectId().toString(),
    targetMessageId: new Types.ObjectId().toString(),
    displayedAnswerVersion: 'original',
    creationRequestId: randomUUID(),
    creationRequestFingerprint: 'request-fingerprint',
    clientBranchSelectionFingerprint: 'branch-selection',
    canonicalPathFingerprint: 'canonical',
    contextFingerprint: 'context',
    canonicalSelectedAnswerIds: [],
    platformConversationId: new Types.ObjectId().toString(),
    context: {
      contextVersion: 1,
      executionSummaries: [],
      planSteps: [],
      actions: [],
      agents: [],
      skills: [],
      references: [],
      projection: {
        generatedAt: new Date().toISOString(),
        sourceMessageCount: 0,
        includedMessageCount: 0,
        omissions: {},
      },
    },
    candidateBindings: {
      workspaceIds: [],
      documentIds: [],
      connectorIds: [],
      agentIds: [],
      skillIds: [],
    },
    defaultWorkspaceIds: [],
    status: 'prepared',
    preparedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

describe('ConversationPlaybookHandoffService', () => {
  it('prepares an idempotent dedicated Platform Copilot conversation', async () => {
    const ownerId = new Types.ObjectId().toString();
    const sourceConversationId = new Types.ObjectId().toString();
    const questionId = new Types.ObjectId().toString();
    const targetMessageId = new Types.ObjectId().toString();
    const platformConversationId = new Types.ObjectId().toString();
    const creationRequestId = randomUUID();
    const activeBranches = { [questionId]: targetMessageId };
    const fingerprintInput = {
      contractVersion: 1,
      targetMessageId,
      displayedAnswerVersion: 'original',
      activeBranches: Object.entries(activeBranches),
    };
    const branchSelectionFingerprint = createHash('sha256')
      .update(JSON.stringify(fingerprintInput))
      .digest('hex');
    const context = {
      contextVersion: 1,
      executionSummaries: [],
      planSteps: [],
      actions: [],
      agents: [],
      skills: [],
      references: [],
      projection: {
        generatedAt: new Date().toISOString(),
        sourceMessageCount: 2,
        includedMessageCount: 2,
        omissions: {},
      },
    };
    const store = {
      findByCreationRequest: jest.fn().mockResolvedValue(null),
      createPrepared: jest.fn(async (value: Record<string, unknown>) => ({
        record: handoffRecord({
          ...(value as unknown as ConversationPlaybookHandoffRecord),
          status: 'prepared',
        }),
        created: true,
      })),
    };
    const path = [
      { id: questionId, conversationType: 'user', content: 'Build this' },
      {
        id: targetMessageId,
        conversationType: 'ai',
        components: [],
        questionMessageId: questionId,
      },
    ];
    const branchService = {
      resolveCanonicalPath: jest.fn().mockResolvedValue({
        source: { workspaces: [new Types.ObjectId()] },
        messages: path,
        path,
        selectedAnswerIds: [targetMessageId],
        fingerprint: 'canonical-fingerprint',
      }),
    };
    const projector = {
      resolveDisplayedAnswer: jest.fn().mockReturnValue({ version: 'original', components: [] }),
      project: jest.fn().mockReturnValue({
        context,
        preview: {
          executionSummaries: [],
          planSteps: [],
          actions: [],
          resources: [],
          omissions: {},
        },
      }),
    };
    const conversationService = {
      create: jest.fn().mockResolvedValue({ id: platformConversationId }),
    };
    const service = new ConversationPlaybookHandoffService(
      store as never,
      branchService as never,
      projector as never,
      conversationService as never,
    );

    const result = await service.prepare(sourceConversationId, ownerId, {
      contractVersion: 1,
      targetMessageId,
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
    expect(store.createPrepared).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        ownerId,
        platformConversationId,
        defaultWorkspaceIds: [expect.any(String)],
        expiresAt: expect.any(Date),
      }),
    );
  });

  it('rejects binding an expired handoff', async () => {
    const ownerId = new Types.ObjectId().toString();
    const platformConversationId = new Types.ObjectId().toString();
    const store = {
      tryBindPrepared: jest.fn().mockResolvedValue(null),
      findOwned: jest.fn().mockResolvedValue(
        handoffRecord({
          ownerId,
          platformConversationId,
          expiresAt: new Date(Date.now() - 1_000),
        }),
      ),
    };
    const service = new ConversationPlaybookHandoffService(
      store as never,
      {} as never,
      {} as never,
      {} as never,
    );

    try {
      await service.bind({
        handoffId: randomUUID(),
        ownerId,
        platformConversationId,
        turnRequestId: 'turn-1',
        prompt: 'Create it',
      });
      throw new Error('Expected binding to fail');
    } catch (error) {
      expect((error as { getStatus: () => number }).getStatus()).toBe(410);
    }
  });

  it('consumes only the exact bound owner, conversation, turn, and user message', async () => {
    const ownerId = new Types.ObjectId().toString();
    const platformConversationId = new Types.ObjectId().toString();
    const userMessageId = new Types.ObjectId().toString();
    const handoffId = randomUUID();
    const consumedAt = new Date();
    const handoff = handoffRecord({
      handoffId,
      status: 'bound',
      ownerId,
      platformConversationId,
      boundTurnRequestId: 'turn-1',
      boundUserMessageId: userMessageId,
      consumedAt,
    });
    const store = {
      findForConsumption: jest.fn().mockResolvedValue(handoff),
      markConsumedIfBound: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ConversationPlaybookHandoffService(
      store as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.consume({
        handoffId,
        ownerId,
        platformConversationId,
        turnRequestId: 'turn-1',
        userMessageId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ handoffId, acceptedAt: consumedAt.toISOString() }),
    );
    expect(store.findForConsumption).toHaveBeenCalledWith({
      handoffId,
      ownerId,
      platformConversationId,
      turnRequestId: 'turn-1',
      userMessageId,
    });
    expect(store.markConsumedIfBound).toHaveBeenCalledWith(handoff.id, expect.any(Date));
  });

  it('replays a consumed handoff without another state transition', async () => {
    const consumedAt = new Date(Date.now() - 5_000);
    const handoff = handoffRecord({
      status: 'consumed',
      boundTurnRequestId: 'turn-1',
      boundUserMessageId: 'message-1',
      consumedAt,
    });
    const store = {
      findForConsumption: jest.fn().mockResolvedValue(handoff),
      markConsumedIfBound: jest.fn(),
    };
    const service = new ConversationPlaybookHandoffService(
      store as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.consume({
        handoffId: handoff.handoffId,
        ownerId: handoff.ownerId,
        platformConversationId: handoff.platformConversationId,
        turnRequestId: 'turn-1',
        userMessageId: 'message-1',
      }),
    ).resolves.toEqual(expect.objectContaining({ acceptedAt: consumedAt.toISOString() }));
    expect(store.markConsumedIfBound).not.toHaveBeenCalled();
  });

  it('delegates user-message attachment to the bound-only store operation', async () => {
    const store = { attachUserMessageIfBound: jest.fn().mockResolvedValue(undefined) };
    const service = new ConversationPlaybookHandoffService(
      store as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.attachUserMessage('handoff-1', 'owner-1', 'message-1');
    expect(store.attachUserMessageIfBound).toHaveBeenCalledWith(
      'handoff-1',
      'owner-1',
      'message-1',
    );
  });
});
