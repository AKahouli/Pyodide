import { createHash } from 'crypto';
import { PlaybookAssistantRequestService } from './playbook-assistant-request.service';

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

const requestRepository = (overrides: Record<string, jest.Mock> = {}) => ({
  insert: jest.fn().mockImplementation(async (input: Record<string, unknown>) => ({ id: 'row-1', ...input })),
  findByRequestId: jest.fn().mockResolvedValue(null),
  findFirstByRequestIds: jest.fn().mockResolvedValue(null),
  conversationExists: jest.fn().mockResolvedValue(true),
  findAwaitingContinuation: jest.fn().mockResolvedValue(null),
  findContinuation: jest.fn().mockResolvedValue(null),
  rebindCorrelation: jest.fn().mockResolvedValue(true),
  claimAssessment: jest.fn().mockResolvedValue(1),
  saveAssessment: jest.fn().mockResolvedValue(null),
  claimContinuation: jest.fn().mockResolvedValue(true),
  restoreContinuation: jest.fn().mockResolvedValue(undefined),
  claimMutation: jest.fn().mockResolvedValue(true),
  complete: jest.fn().mockResolvedValue(undefined),
  bindGeneratedPlaybook: jest.fn().mockResolvedValue(undefined),
  resetMutation: jest.fn().mockResolvedValue(true),
  releaseMutation: jest.fn().mockResolvedValue(undefined),
  markFailed: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

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

  it('creates a processing request bound to a fresh correlation and context', async () => {
    const requests = requestRepository();
    const service = new PlaybookAssistantRequestService(requests as never);

    const result = await service.claimTurn({ ...baseInput, text: '  Add scoring  ' });

    expect(result.replay).toBe(false);
    expect(requests.insert).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-1',
      operationKind: 'existing_construction',
      playbookId: 'playbook-1',
      expectedDefinitionRevision: 7,
      originalText: 'Add scoring',
      messageHash: fingerprint(),
      correlationId: expect.stringMatching(/^playbook-assistant:/),
      contextId: expect.any(String),
      selectedTaskId: null,
      executionId: null,
      attachmentIds: ['attachment-1'],
      expiresAt: expect.any(Date),
    }));
    expect(requests.conversationExists).not.toHaveBeenCalled();
  });

  it('continues only a conversation the owner already has on the Playbook', async () => {
    const requests = requestRepository({ conversationExists: jest.fn().mockResolvedValue(false) });
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.claimTurn({ ...baseInput, conversationId: 'conversation-1' })).rejects.toThrow('Assistant conversation not found');
    expect(requests.conversationExists).toHaveBeenCalledWith('user-1', 'conversation-1', 'playbook-1');
    expect(requests.insert).not.toHaveBeenCalled();
  });

  it('replays only when every semantically relevant request input matches', async () => {
    const existing = {
      ...baseInput,
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
      contextId: 'context-1',
      messageHash: fingerprint(),
      status: 'completed',
    };
    const requests = requestRepository({
      insert: jest.fn().mockResolvedValue(null),
      findByRequestId: jest.fn().mockResolvedValue(existing),
    });
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.claimTurn(baseInput)).resolves.toEqual({ request: existing, replay: true });
    expect(requests.findByRequestId).toHaveBeenCalledWith('request-1');
  });

  it('refuses to replay a request that is still in progress', async () => {
    const requests = requestRepository({
      insert: jest.fn().mockResolvedValue(null),
      findByRequestId: jest.fn().mockResolvedValue({ ...baseInput, messageHash: fingerprint(), status: 'processing' }),
    });
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.claimTurn(baseInput)).rejects.toThrow('Assistant request is already in progress');
  });

  it.each([
    ['attachments', { attachmentIds: ['attachment-2'] }],
    ['selected task', { selectedTaskId: 'task-2' }],
    ['execution', { executionId: 'execution-2' }],
    ['agent', { agentId: 'agent-2' }],
    ['operation kind', { operationKind: 'inspect' as const }],
    ['page context', { context: { route: '/playbooks/other' } }],
  ])('rejects request-id reuse with changed %s', async (_label, changedInput) => {
    const requests = requestRepository({
      insert: jest.fn().mockResolvedValue(null),
      findByRequestId: jest.fn().mockResolvedValue({ ...baseInput, messageHash: fingerprint(), status: 'completed' }),
    });
    const service = new PlaybookAssistantRequestService(requests as never);

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
    const requests = requestRepository({ findContinuation: jest.fn().mockResolvedValue(existing) });
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.getContinuationForUser(
      'continuation-1',
      'user-1',
      'playbook-1',
      'conversation-1',
    )).resolves.toBe(existing);
    expect(requests.findContinuation).toHaveBeenCalledWith('continuation-1', 'user-1', 'playbook-1', 'conversation-1');
  });

  it('rejects a browser continuation that is no longer awaiting clarification', async () => {
    const requests = requestRepository({
      findContinuation: jest.fn().mockResolvedValue({ status: 'ready', expiresAt: new Date(Date.now() + 60_000) }),
    });
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.getContinuationForUser('continuation-1', 'user-1', 'playbook-1', 'conversation-1'))
      .rejects.toThrow('clarification not found or expired');
  });

  it('checks the actor binding of a bound request', async () => {
    const actor = { ownerId: 'user-1', agentId: 'agent-1', conversationId: 'conversation-1', correlationId: 'correlation-1' };
    const request = { requestId: 'request-1', ...actor, expiresAt: new Date(Date.now() + 60_000) };
    const requests = requestRepository({ findByRequestId: jest.fn().mockResolvedValue(request) });
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.getBound('request-1', actor)).resolves.toBe(request);
    expect(requests.findByRequestId).toHaveBeenCalledWith('request-1', 'user-1');
    await expect(service.getBound('request-1', { ...actor, correlationId: 'other' })).rejects.toThrow('actor binding does not match');

    requests.findByRequestId.mockResolvedValue(null);
    await expect(service.getBound('request-1', actor)).rejects.toThrow('not found or expired');
  });

  it('creates one server-bound generation request for a platform conversation turn', async () => {
    const requests = requestRepository();
    const service = new PlaybookAssistantRequestService(requests as never);
    const actor = {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    };

    await expect(service.claimGenerationForTurn({
      actor,
      text: 'Build lead generation',
      requestedName: 'Lead pipeline',
    })).resolves.toEqual(expect.objectContaining({ requestId: expect.stringMatching(/^platform-generation:/) }));
    expect(requests.insert).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^platform-generation:/),
      ...actor,
      operationKind: 'generation',
      originalText: 'Build lead generation',
      requestedName: 'Lead pipeline',
      handoffContext: null,
      handoffProvenance: null,
      workspaceDefaultIds: [],
    }));
    const [currentId, legacyId] = requests.findFirstByRequestIds.mock.calls[0][0];
    expect(currentId).toBe(requests.insert.mock.calls[0][0].requestId);
    expect(legacyId).toMatch(/^platform-generation:/);
    expect(legacyId).not.toBe(currentId);
  });

  it('carries the conversation handoff into the generation request', async () => {
    const requests = requestRepository();
    const service = new PlaybookAssistantRequestService(requests as never);
    const handoff = {
      handoffId: 'handoff-1', handoffVersion: 1 as const, sourceConversationId: 'conversation-0', targetMessageId: 'message-1',
      displayedAnswerVersion: 'v1', canonicalPathFingerprint: 'path', contextFingerprint: 'ctx',
      context: { summary: 'x' } as never, workspaceDefaultIds: ['64f000000000000000000001'], acceptedAt: '2026-09-01T00:00:00.000Z',
    };

    await service.claimGenerationForTurn({
      actor: { ownerId: 'user-1', agentId: 'agent-1', conversationId: 'conversation-1', correlationId: 'ai-message-1' },
      text: 'Build it',
      handoff,
    });

    expect(requests.insert).toHaveBeenCalledWith(expect.objectContaining({
      handoffContext: { summary: 'x' },
      handoffProvenance: {
        handoffId: 'handoff-1', handoffVersion: 1, sourceConversationId: 'conversation-0', targetMessageId: 'message-1',
        displayedAnswerVersion: 'v1', canonicalPathFingerprint: 'path', contextFingerprint: 'ctx', acceptedAt: '2026-09-01T00:00:00.000Z',
      },
      workspaceDefaultIds: ['64f000000000000000000001'],
    }));
  });

  it('reuses a matching generation request after a duplicate-key race', async () => {
    const existing = {
      requestId: 'existing-request', ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1', expiresAt: new Date(Date.now() + 60_000),
    };
    const requests = requestRepository({
      insert: jest.fn().mockResolvedValue(null),
      findFirstByRequestIds: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing),
    });
    const service = new PlaybookAssistantRequestService(requests as never);
    const actor = {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    };
    const firstFingerprint = (service as any).createRequestFingerprint({ ...actor, operationKind: 'generation', text: 'Build lead generation' });
    Object.assign(existing, { messageHash: firstFingerprint });

    await expect(service.claimGenerationForTurn({ actor, text: 'Build lead generation' })).resolves.toBe(existing);
  });

  it('rejects a generation turn identity reused with different content', async () => {
    const actor = { ownerId: 'user-1', agentId: 'agent-1', conversationId: 'conversation-1', correlationId: 'ai-message-1' };
    const requests = requestRepository({
      findFirstByRequestIds: jest.fn().mockResolvedValue({ ...actor, messageHash: 'other', expiresAt: new Date(Date.now() + 60_000) }),
    });
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.claimGenerationForTurn({ actor, text: 'Build lead generation' }))
      .rejects.toThrow('Assistant request identity was reused with different content');
    expect(requests.insert).not.toHaveBeenCalled();
  });

  it('creates one server-bound modification request for a platform conversation turn', async () => {
    const requests = requestRepository();
    const service = new PlaybookAssistantRequestService(requests as never);
    const actor = {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    };

    await expect(service.claimCurrentTurnModification({
      actor,
      playbookId: 'playbook-1',
      expectedDefinitionRevision: 7,
      text: 'Add a scoring export task',
    })).resolves.toEqual(expect.objectContaining({ requestId: expect.stringMatching(/^platform-modification:/) }));
    expect(requests.insert).toHaveBeenCalledWith(expect.objectContaining({
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
    const requests = requestRepository({
      insert: jest.fn().mockResolvedValue(null),
      findFirstByRequestIds: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing),
    });
    const service = new PlaybookAssistantRequestService(requests as never);
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
    const legacyRequestId = `platform-generation:${createHash('sha256')
      .update(JSON.stringify(canonicalize(legacyActor)))
      .digest('hex')}`;
    const existing = {
      requestId: legacyRequestId,
      ...actor,
      messageHash: (service as any).createRequestFingerprint({
        ...legacyActor,
        operationKind: 'generation',
        text: 'Build lead generation',
      }),
      expiresAt: new Date(Date.now() + 60_000),
    };
    const requests = requestRepository({ findFirstByRequestIds: jest.fn().mockResolvedValue(existing) });
    const compatibleService = new PlaybookAssistantRequestService(requests as never);

    await expect(compatibleService.claimGenerationForTurn({ actor, text: 'Build lead generation' }))
      .resolves.toBe(existing);
    expect(requests.findFirstByRequestIds.mock.calls[0][0]).toContain(legacyRequestId);
    expect(requests.insert).not.toHaveBeenCalled();
  });

  it('rebinds a clarification correlation only inside the same trusted conversation', async () => {
    const requests = requestRepository();
    const service = new PlaybookAssistantRequestService(requests as never);
    const actor = {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-2',
    };

    await expect(service.rebindCorrelationForContinuation({
      continuationId: 'continuation-1',
      playbookId: 'playbook-1',
      actor,
    })).resolves.toBeUndefined();
    expect(requests.rebindCorrelation).toHaveBeenCalledWith(
      {
        continuationId: 'continuation-1',
        playbookId: 'playbook-1',
        ownerId: 'user-1',
        agentId: 'agent-1',
        conversationId: 'conversation-1',
      },
      'ai-message-2',
    );
  });

  it('fails closed when no clarification matches the trusted conversation for a correlation rebind', async () => {
    const requests = requestRepository({ rebindCorrelation: jest.fn().mockResolvedValue(false) });
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.rebindCorrelationForContinuation({
      continuationId: 'continuation-1',
      playbookId: 'playbook-1',
      actor: {
        ownerId: 'user-1', agentId: 'agent-1',
        conversationId: 'conversation-1', correlationId: 'ai-message-2',
      },
    })).rejects.toThrow('clarification not found or expired');
  });

  it('loads a clarification by continuation, then checks its actor binding', async () => {
    const actor = { ownerId: 'user-1', agentId: 'agent-1', conversationId: 'conversation-1', correlationId: 'correlation-1' };
    const request = { requestId: 'request-1', ...actor, expiresAt: new Date(Date.now() + 60_000) };
    const requests = requestRepository({
      findAwaitingContinuation: jest.fn().mockResolvedValue(request),
      findByRequestId: jest.fn().mockResolvedValue(request),
    });
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.getByContinuation('continuation-1', actor)).resolves.toBe(request);
    expect(requests.findAwaitingContinuation).toHaveBeenCalledWith('continuation-1', 'user-1');

    requests.findAwaitingContinuation.mockResolvedValue(null);
    await expect(service.getByContinuation('continuation-1', actor)).rejects.toThrow('clarification not found or expired');
  });

  it('releases only the matching mutation claim without clearing Playbook bindings', async () => {
    const requests = requestRepository();
    const service = new PlaybookAssistantRequestService(requests as never);

    await service.releaseMutation('request-1', 'operation-1');

    expect(requests.releaseMutation).toHaveBeenCalledWith('request-1', 'operation-1');
    expect(requests.resetMutation).not.toHaveBeenCalled();
  });

  it('claims a mutation once and hands the winner operation to later callers', async () => {
    const requests = requestRepository({
      claimMutation: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(false),
      findByRequestId: jest.fn()
        .mockResolvedValueOnce({ mutationOperationId: 'operation-1' })
        .mockResolvedValueOnce({ mutationOperationId: null }),
    });
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.claimMutation('request-1', 'operation-1')).resolves.toBe('operation-1');
    await expect(service.claimMutation('request-1', 'operation-2')).resolves.toBe('operation-1');
    await expect(service.claimMutation('request-1', 'operation-3')).rejects.toThrow('not ready for construction');
  });

  it('allows only one caller to claim an active clarification continuation', async () => {
    const requests = requestRepository({ claimContinuation: jest.fn().mockResolvedValue(false) });
    const service = new PlaybookAssistantRequestService(requests as never);

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
    expect(requests.claimContinuation).toHaveBeenCalledWith(
      {
        requestId: 'request-1',
        continuationId: 'continuation-1',
        ownerId: 'user-1',
        agentId: 'agent-1',
        conversationId: 'conversation-1',
        correlationId: 'correlation-1',
      },
      { answers: [{ questionId: 'region', choice: 'France' }], assessment: { status: 'ready_to_construct' } },
    );
  });

  it('starts an assessment attempt only while the request is processing', async () => {
    const requests = requestRepository({ claimAssessment: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(null) });
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.claimAssessment('request-1')).resolves.toBe(3);
    await expect(service.claimAssessment('request-1')).rejects.toThrow('not available for processing');
  });

  it('opens a continuation when the assessment needs clarification', async () => {
    const saved = { requestId: 'request-1', status: 'awaiting_clarification' };
    const requests = requestRepository({ saveAssessment: jest.fn().mockResolvedValue(saved) });
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.saveAssessment('request-1', 2, { status: 'needs_clarification', questions: [] })).resolves.toBe(saved);
    expect(requests.saveAssessment).toHaveBeenCalledWith('request-1', 2, {
      assessment: { status: 'needs_clarification', questions: [] },
      continuationId: expect.any(String),
      status: 'awaiting_clarification',
      expiresAt: expect.any(Date),
    });

    await service.saveAssessment('request-1', 3, { status: 'ready_to_construct' });
    expect(requests.saveAssessment).toHaveBeenLastCalledWith('request-1', 3, expect.objectContaining({ continuationId: null, status: 'ready' }));
  });

  it('rejects a stale assessment attempt instead of overwriting newer clarification state', async () => {
    const requests = requestRepository({ saveAssessment: jest.fn().mockResolvedValue(null) });
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.saveAssessment('request-1', 2, {
      status: 'needs_clarification',
      questions: [],
    })).rejects.toThrow('assessment attempt is stale');
    expect(requests.saveAssessment).toHaveBeenCalledWith('request-1', 2, expect.any(Object));
  });

  it('keeps an assessed generation ready after resetting a safely removed failed draft', async () => {
    const requests = requestRepository();
    const service = new PlaybookAssistantRequestService(requests as never);

    await expect(service.resetMutation('request-1', 'operation-1')).resolves.toBe(true);
    expect(requests.resetMutation).toHaveBeenCalledWith('request-1', 'operation-1');
  });

  it('delegates the terminal writes to the request row', async () => {
    const requests = requestRepository();
    const service = new PlaybookAssistantRequestService(requests as never);

    await service.complete('request-1', 'Done', 'operation-1', { kind: 'answer' });
    await service.bindGeneratedPlaybook('request-1', 'playbook-2', 1);
    await service.restoreContinuation('request-1', 'continuation-1');
    await service.fail('request-1');

    expect(requests.complete).toHaveBeenCalledWith('request-1', 'Done', 'operation-1', { kind: 'answer' });
    expect(requests.bindGeneratedPlaybook).toHaveBeenCalledWith('request-1', 'playbook-2', 1);
    expect(requests.restoreContinuation).toHaveBeenCalledWith('request-1', 'continuation-1');
    expect(requests.markFailed).toHaveBeenCalledWith('request-1');
  });
});
