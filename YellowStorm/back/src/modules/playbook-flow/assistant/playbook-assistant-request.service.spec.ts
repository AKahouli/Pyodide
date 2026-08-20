import { createHash } from 'crypto';
import { PlaybookAssistantRequestService } from './playbook-assistant-request.service';

const query = <T>(value: T) => ({
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
};

const fingerprint = (overrides: Record<string, unknown> = {}) => createHash('sha256').update(JSON.stringify(canonicalize({
  ownerId: 'user-1',
  agentId: 'agent-1',
  conversationId: null,
  operationKind: 'existing_construction',
  playbookId: 'playbook-1',
  expectedDefinitionRevision: 7,
  text: 'Add scoring',
  selectedTaskId: null,
  executionId: null,
  attachmentIds: ['attachment-1'],
  context: null,
  ...overrides,
}))).digest('hex');

describe('PlaybookAssistantRequestService', () => {
  const baseInput = {
    requestId: 'request-1',
    ownerId: 'user-1',
    agentId: 'agent-1',
    operationKind: 'existing_construction' as const,
    playbookId: 'playbook-1',
    expectedDefinitionRevision: 7,
    text: 'Add scoring',
    attachmentIds: ['attachment-1'],
  };

  it('replays only when every semantically relevant request input matches', async () => {
    const existing = {
      ...baseInput,
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
      contextId: 'context-1',
      messageHash: fingerprint(),
      status: 'completed',
    };
    const model = {
      create: jest.fn().mockRejectedValue({ code: 11000 }),
      findOne: jest.fn().mockReturnValue(query(existing)),
    };
    const service = new PlaybookAssistantRequestService(model as never);

    await expect(service.claimTurn(baseInput)).resolves.toEqual({ request: existing, replay: true });
  });

  it.each([
    ['attachments', { attachmentIds: ['attachment-2'] }],
    ['selected task', { selectedTaskId: 'task-2' }],
    ['execution', { executionId: 'execution-2' }],
    ['agent', { agentId: 'agent-2' }],
    ['operation kind', { operationKind: 'inspect' as const }],
    ['page context', { context: { route: '/playbooks/other' } }],
  ])('rejects request-id reuse with changed %s', async (_label, changedInput) => {
    const model = {
      create: jest.fn().mockRejectedValue({ code: 11000 }),
      findOne: jest.fn().mockReturnValue(query({
        ...baseInput,
        messageHash: fingerprint(),
        status: 'completed',
      })),
    };
    const service = new PlaybookAssistantRequestService(model as never);

    await expect(service.claimTurn({ ...baseInput, ...changedInput })).rejects.toThrow(
      'Assistant request ID was reused with different content',
    );
  });

  it('loads browser continuations through the owning conversation', async () => {
    const existing = {
      requestId: 'request-1',
      continuationId: 'continuation-1',
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      conversationId: 'conversation-1',
      status: 'awaiting_clarification',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const model = { findOne: jest.fn().mockReturnValue(query(existing)) };
    const service = new PlaybookAssistantRequestService(model as never);

    await expect(service.getContinuationForUser(
      'continuation-1',
      'user-1',
      'playbook-1',
      'conversation-1',
    )).resolves.toBe(existing);
    expect(model.findOne).toHaveBeenCalledWith({
      continuationId: 'continuation-1',
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      conversationId: 'conversation-1',
    });
  });

  it('creates one server-bound generation request for a platform conversation turn', async () => {
    const created = { toObject: jest.fn().mockReturnValue({ requestId: 'created-request' }) };
    const model = {
      create: jest.fn().mockResolvedValue(created),
      findOne: jest.fn().mockReturnValue(query(null)),
    };
    const service = new PlaybookAssistantRequestService(model as never);
    const actor = {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    };

    await expect(service.claimGenerationForTurn({ actor, text: 'Build lead generation' }))
      .resolves.toEqual({ requestId: 'created-request' });
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^platform-generation:/),
      ...actor,
      operationKind: 'generation',
      originalText: 'Build lead generation',
    }));
  });

  it('reuses a matching generation request after a duplicate-key race', async () => {
    const existing = {
      requestId: 'existing-request', ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1', expiresAt: new Date(Date.now() + 60_000),
    };
    const model = {
      create: jest.fn().mockRejectedValue({ code: 11000 }),
      findOne: jest.fn().mockReturnValue(query(existing)),
    };
    const service = new PlaybookAssistantRequestService(model as never);
    const actor = {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    };
    const firstFingerprint = (service as any).createRequestFingerprint({ ...actor, operationKind: 'generation', text: 'Build lead generation' });
    Object.assign(existing, { messageHash: firstFingerprint });

    await expect(service.claimGenerationForTurn({ actor, text: 'Build lead generation' })).resolves.toBe(existing);
  });

  it('creates one server-bound modification request for a platform conversation turn', async () => {
    const created = { toObject: jest.fn().mockReturnValue({ requestId: 'created-request' }) };
    const model = {
      create: jest.fn().mockResolvedValue(created),
      findOne: jest.fn().mockReturnValue(query(null)),
    };
    const service = new PlaybookAssistantRequestService(model as never);
    const actor = {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    };

    await expect(service.claimCurrentTurnModification({
      actor,
      playbookId: 'playbook-1',
      expectedDefinitionRevision: 7,
      text: 'Add a scoring export task',
    })).resolves.toEqual({ requestId: 'created-request' });
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^platform-modification:/),
      ...actor,
      operationKind: 'existing_construction',
      playbookId: 'playbook-1',
      expectedDefinitionRevision: 7,
      originalText: 'Add a scoring export task',
    }));
  });

  it('reuses a matching current-turn modification request after a duplicate-key race', async () => {
    const existing = {
      requestId: 'existing-request', ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1', playbookId: 'playbook-1',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const model = {
      create: jest.fn().mockRejectedValue({ code: 11000 }),
      findOne: jest.fn().mockReturnValue(query(existing)),
    };
    const service = new PlaybookAssistantRequestService(model as never);
    const actor = {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    };
    const firstFingerprint = (service as any).createRequestFingerprint({
      ...actor,
      operationKind: 'existing_construction',
      playbookId: 'playbook-1',
      expectedDefinitionRevision: 7,
      text: 'Add a scoring export task',
    });
    Object.assign(existing, { messageHash: firstFingerprint });

    await expect(service.claimCurrentTurnModification({
      actor,
      playbookId: 'playbook-1',
      expectedDefinitionRevision: 7,
      text: 'Add a scoring export task',
    })).resolves.toBe(existing);
  });

  it('reuses a generation request created with the legacy tenant-scoped idempotency key', async () => {
    const service = new PlaybookAssistantRequestService({} as never);
    const actor = {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    };
    const legacyActor = { ...actor, tenantId: 'default' };
    const existing = {
      requestId: `platform-generation:${createHash('sha256')
        .update(JSON.stringify(canonicalize(legacyActor)))
        .digest('hex')}`,
      ...actor,
      messageHash: (service as any).createRequestFingerprint({
        ...legacyActor,
        operationKind: 'generation',
        text: 'Build lead generation',
      }),
      expiresAt: new Date(Date.now() + 60_000),
    };
    const model = {
      create: jest.fn(),
      findOne: jest.fn().mockReturnValue(query(existing)),
    };
    const compatibleService = new PlaybookAssistantRequestService(model as never);

    await expect(compatibleService.claimGenerationForTurn({ actor, text: 'Build lead generation' }))
      .resolves.toBe(existing);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('rebinds a clarification correlation only inside the same trusted conversation', async () => {
    const exec = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const model = { updateOne: jest.fn().mockReturnValue({ exec }) };
    const service = new PlaybookAssistantRequestService(model as never);
    const actor = {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-2',
    };

    await expect(service.rebindCorrelationForContinuation({
      continuationId: 'continuation-1',
      playbookId: 'playbook-1',
      actor,
    })).resolves.toBeUndefined();
    expect(model.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        continuationId: 'continuation-1',
        playbookId: 'playbook-1',
        ownerId: 'user-1',
        agentId: 'agent-1',
        conversationId: 'conversation-1',
        status: 'awaiting_clarification',
      }),
      { $set: { correlationId: 'ai-message-2' } },
    );
  });

  it('fails closed when no clarification matches the trusted conversation for a correlation rebind', async () => {
    const exec = jest.fn().mockResolvedValue({ matchedCount: 0 });
    const model = { updateOne: jest.fn().mockReturnValue({ exec }) };
    const service = new PlaybookAssistantRequestService(model as never);

    await expect(service.rebindCorrelationForContinuation({
      continuationId: 'continuation-1',
      playbookId: 'playbook-1',
      actor: {
        ownerId: 'user-1', agentId: 'agent-1',
        conversationId: 'conversation-1', correlationId: 'ai-message-2',
      },
    })).rejects.toThrow('clarification not found or expired');
  });

  it('releases only the matching mutation claim without clearing Playbook bindings', async () => {
    const exec = jest.fn().mockResolvedValue(undefined);
    const model = { updateOne: jest.fn().mockReturnValue({ exec }) };
    const service = new PlaybookAssistantRequestService(model as never);

    await service.releaseMutation('request-1', 'operation-1');

    expect(model.updateOne).toHaveBeenCalledWith(
      { requestId: 'request-1', mutationOperationId: 'operation-1' },
      { $set: { mutationOperationId: null } },
    );
  });

  it('allows only one caller to claim an active clarification continuation', async () => {
    const model = {
      findOneAndUpdate: jest.fn().mockReturnValue(query(null)),
    };
    const service = new PlaybookAssistantRequestService(model as never);

    await expect(service.claimContinuation({
      requestId: 'request-1',
      continuationId: 'continuation-1',
      actor: {
        ownerId: 'user-1',
        agentId: 'agent-1',
        conversationId: 'conversation-1',
        correlationId: 'correlation-1',
      },
      answers: [{ questionId: 'region', choice: 'France' }],
      assessment: { status: 'ready_to_construct' },
    })).rejects.toThrow('already continued');
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        continuationId: 'continuation-1',
        status: 'awaiting_clarification',
        conversationId: 'conversation-1',
        correlationId: 'correlation-1',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          continuationId: null,
          status: 'ready',
          assessment: { status: 'ready_to_construct' },
        }),
      }),
      { new: true },
    );
  });

  it('rejects a stale assessment attempt instead of overwriting newer clarification state', async () => {
    const model = {
      findOneAndUpdate: jest.fn().mockReturnValue(query(null)),
    };
    const service = new PlaybookAssistantRequestService(model as never);

    await expect(service.saveAssessment('request-1', 2, {
      status: 'needs_clarification',
      questions: [],
    })).rejects.toThrow('assessment attempt is stale');
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { requestId: 'request-1', assessmentVersion: 2, status: 'processing' },
      expect.any(Object),
      { new: true },
    );
  });
});
