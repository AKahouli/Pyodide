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
  tenantId: 'default',
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
    tenantId: 'default',
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
    ['tenant', { tenantId: 'tenant-2' }],
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
        tenantId: 'default',
        agentId: 'agent-1',
        conversationId: 'conversation-1',
        correlationId: 'correlation-1',
      },
      answers: [{ questionId: 'region', choice: 'France' }],
      text: 'region: France',
    })).rejects.toThrow('already continued');
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        continuationId: 'continuation-1',
        status: 'awaiting_clarification',
        conversationId: 'conversation-1',
        correlationId: 'correlation-1',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ continuationId: null, status: 'processing' }),
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
