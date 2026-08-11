import { MascotToolExecutionPolicyService, type MascotActorContext } from './mascot-tool-execution-policy.service';

describe('MascotToolExecutionPolicyService', () => {
  const actor: MascotActorContext = {
    tenantId: 'default',
    userId: 'user-1',
    agentId: 'agent-1',
    conversationId: 'conversation-1',
    correlationId: 'correlation-1',
  };

  const createService = (existing: Record<string, unknown> | null = null) => {
    const query = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(existing),
    };
    const model = {
      findOne: jest.fn().mockReturnValue(query),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
      findOneAndUpdate: jest.fn().mockImplementation((_filter, update) => ({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ ...(update.$setOnInsert ?? existing), ...update.$set, _id: 'confirmation-doc-1' }),
        }),
      })),
    };
    const access = { findAccessibleFlow: jest.fn().mockResolvedValue({ name: 'Contract Review', definitionRevision: 4 }) };
    const context = { open: jest.fn().mockResolvedValue({ validation: { status: 'valid', diagnostics: [] } }) };
    const audit = { logSuccess: jest.fn(), logFailure: jest.fn() };
    const users = { findById: jest.fn().mockResolvedValue({ email: 'user@example.com' }) };
    const service = new MascotToolExecutionPolicyService(model as never, access as never, context as never, audit as never, users as never);
    return { service, model, access, context };
  };

  it('fails closed for tools outside the ten-tool policy', async () => {
    const { service, access } = createService();
    await expect(service.evaluate(actor, { toolName: 'playbook_mcp_delete_playbook_execution', arguments: {} }))
      .resolves.toEqual(expect.objectContaining({ decision: 'denied', code: 'MASCOT_TOOL_NOT_ALLOWED' }));
    expect(access.findAccessibleFlow).not.toHaveBeenCalled();
  });

  it('allows approved read tools without creating a confirmation', async () => {
    const { service, model } = createService();
    await expect(service.evaluate(actor, { toolName: 'playbook_mcp_search_playbooks', arguments: { query: 'Contract' } }))
      .resolves.toEqual({ decision: 'allowed', impact: 'read' });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('creates a fingerprinted pending action and removes model idempotency material', async () => {
    const { service, model } = createService();
    const result = await service.evaluate(actor, {
      toolName: 'playbook_mcp_start_playbook_execution',
      arguments: { playbook_id: 'playbook-1', idempotency_key: 'model-key', input_context: { contract: 'a' } },
    });
    expect(result).toEqual(expect.objectContaining({ decision: 'confirmation_required' }));
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ activeKey: expect.any(String) }),
      expect.objectContaining({ $setOnInsert: expect.objectContaining({
        canonicalArguments: { playbook_id: 'playbook-1', input_context: { contract: 'a' } },
        status: 'pending',
      }) }),
      expect.objectContaining({ upsert: true, new: true }),
    );
  });

  it('injects only the stored server idempotency key after native confirmation', async () => {
    const existing = {
      _id: 'confirmation-doc-1',
      confirmationId: 'confirmation-1',
      status: 'consuming',
      continuationCorrelationId: actor.correlationId,
      idempotencyKey: 'server-key',
      summary: { definitionRevision: 4 },
    };
    const { service } = createService(existing);
    const dto = { toolName: 'playbook_mcp_start_playbook_execution', arguments: { playbook_id: 'playbook-1' } };
    await expect(service.evaluate(actor, dto)).resolves.toEqual(expect.objectContaining({ decision: 'allowed', idempotencyKey: 'server-key' }));
    expect(dto.arguments).toEqual({ playbook_id: 'playbook-1', idempotency_key: 'server-key' });
  });

  it('does not consume a confirmed action after its confirmation window expires', async () => {
    const existing = {
      confirmationId: 'confirmation-1',
      userId: actor.userId,
      status: 'confirmed',
      expiresAt: new Date(Date.now() - 1000),
    };
    const { service, model } = createService(existing);
    model.findOneAndUpdate.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    }));

    await expect(service.confirm(actor.userId, 'confirmation-1')).rejects.toMatchObject({ status: 409 });
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: { $gt: expect.any(Date) } }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'consuming' }) }),
      { new: true },
    );
  });

  it('allows only one concurrent confirmation consumer', async () => {
    let state = {
      confirmationId: 'confirmation-1',
      userId: actor.userId,
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    } as Record<string, unknown>;
    const model = {
      findOneAndUpdate: jest.fn().mockImplementation((_filter, update) => ({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockImplementation(async () => {
            if (state.status !== 'pending') return null;
            state = { ...state, ...update.$set, canonicalArguments: {}, summary: {} };
            return state;
          }),
        }),
      })),
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ exec: jest.fn().mockImplementation(async () => state) }),
      }),
    };
    const service = new MascotToolExecutionPolicyService(
      model as never,
      {} as never,
      {} as never,
      { logSuccess: jest.fn(), logFailure: jest.fn() } as never,
      { findById: jest.fn().mockResolvedValue({ email: 'user@example.com' }) } as never,
    );

    const results = await Promise.allSettled([
      service.confirm(actor.userId, 'confirmation-1'),
      service.confirm(actor.userId, 'confirmation-1'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(state.status).toBe('consuming');
  });

  it('replays the stored continuation result without consuming again', async () => {
    const storedResult = { conversationId: 'conversation-1', answer: 'Execution started', toolResults: [] };
    const existing = {
      confirmationId: 'confirmation-1',
      userId: actor.userId,
      status: 'executed',
      continuationResult: storedResult,
    };
    const { service, model } = createService(existing);
    model.findOneAndUpdate.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    }));

    await expect(service.confirm(actor.userId, 'confirmation-1'))
      .resolves.toEqual({ kind: 'replayed', result: storedResult });
  });

  it('completes only the correlation-bound confirmation that reached executing', async () => {
    const { service, model } = createService();
    model.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

    await expect(service.complete(actor.userId, 'confirmation-1', actor.correlationId, { answer: 'No tool call' }))
      .rejects.toMatchObject({ status: 409 });
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      {
        confirmationId: 'confirmation-1',
        userId: actor.userId,
        continuationCorrelationId: actor.correlationId,
        status: 'executing',
      },
      expect.any(Object),
      { new: true },
    );
  });

  it('atomically reuses one pending action for concurrent duplicate evaluations', async () => {
    let reserved: Record<string, unknown> | null = null;
    const emptyQuery = { select: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(null) };
    const model = {
      findOne: jest.fn().mockReturnValue(emptyQuery),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
      findOneAndUpdate: jest.fn().mockImplementation((_filter, update) => ({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockImplementation(async () => {
            reserved ??= { ...update.$setOnInsert, _id: 'confirmation-doc-1' };
            return reserved;
          }),
        }),
      })),
    };
    const service = new MascotToolExecutionPolicyService(
      model as never,
      { findAccessibleFlow: jest.fn().mockResolvedValue({ name: 'Contract Review', definitionRevision: 4 }) } as never,
      { open: jest.fn().mockResolvedValue({ validation: { status: 'valid', diagnostics: [] } }) } as never,
      { logSuccess: jest.fn(), logFailure: jest.fn() } as never,
      { findById: jest.fn().mockResolvedValue({ email: 'user@example.com' }) } as never,
    );

    const [first, second] = await Promise.all([
      service.evaluate(actor, { toolName: 'start_playbook_execution', arguments: { playbook_id: 'playbook-1' } }),
      service.evaluate(actor, { toolName: 'start_playbook_execution', arguments: { playbook_id: 'playbook-1' } }),
    ]);
    expect((first.pendingAction as { confirmationId: string }).confirmationId)
      .toBe((second.pendingAction as { confirmationId: string }).confirmationId);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(new Set(model.findOneAndUpdate.mock.calls.map((call) => call[0].activeKey)).size).toBe(1);
  });

  it('retires an expired active key before reserving a replacement', async () => {
    const { service, model } = createService();
    const result = await service.evaluate(actor, {
      toolName: 'start_playbook_execution',
      arguments: { playbook_id: 'playbook-1' },
    });
    expect(model.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ activeKey: expect.any(String), expiresAt: { $lte: expect.any(Date) } }),
      { $set: { status: 'expired' }, $unset: { activeKey: 1 } },
    );
    expect(result).toEqual(expect.objectContaining({ decision: 'confirmation_required' }));
  });
});
