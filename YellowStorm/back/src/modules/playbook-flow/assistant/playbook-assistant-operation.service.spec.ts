import { PlaybookAssistantOperationService } from './playbook-assistant-operation.service';

function leanExec<T>(value: T) {
  return { lean: () => ({ exec: async () => value }) };
}

describe('PlaybookAssistantOperationService', () => {
  it('persists monotonic events and terminal operation state', async () => {
    let sequence = 0;
    let status = 'queued';
    const operationModel = {
      create: jest.fn().mockResolvedValue({}),
      findOne: jest.fn().mockImplementation(() => leanExec({ lastSequence: sequence, status })),
      findOneAndUpdate: jest.fn().mockImplementation((_filter, update) => {
        sequence += update.$inc.lastSequence;
        status = update.$set.status ?? status;
        return leanExec({ lastSequence: sequence, status });
      }),
    };
    const service = new PlaybookAssistantOperationService(operationModel as any);

    await service.create({ operationId: 'operation-1', playbookId: 'flow-1', ownerId: 'owner-1', baseDefinitionRevision: 4 });
    const started = await service.append('flow-1', 'owner-1', 'operation-1', {
      type: 'started',
      constructionId: 'operation-1',
      playbookId: 'flow-1',
      model: 'model-1',
      baseDefinitionRevision: 4,
    });
    const completed = await service.append('flow-1', 'owner-1', 'operation-1', {
      type: 'completed',
      constructionId: 'operation-1',
      playbookId: 'flow-1',
      model: 'model-1',
      finalSuggestionCount: 2,
    });

    expect(started.sequence).toBe(1);
    expect(completed.sequence).toBe(2);
    expect(operationModel.findOneAndUpdate.mock.calls[1][1].$set).toMatchObject({ status: 'completed' });
    expect(operationModel.findOneAndUpdate.mock.calls[1][1].$set.terminalAt).toBeInstanceOf(Date);
    expect(operationModel.findOneAndUpdate.mock.calls[1][1].$push.events).toMatchObject({ sequence: 2, type: 'completed' });
  });

  it('replays persisted events after a cursor and stops at the terminal sequence', async () => {
    const operationModel = {
      findOne: jest.fn().mockImplementation(() => leanExec({
        operationId: 'operation-1',
        playbookId: 'flow-1',
        ownerId: 'owner-1',
        status: 'completed',
        baseDefinitionRevision: 3,
        lastSequence: 2,
        events: [event],
      })),
    };
    const event = {
      type: 'completed', constructionId: 'operation-1', playbookId: 'flow-1', sequence: 2,
      createdAt: new Date().toISOString(), model: 'model-1', finalSuggestionCount: 1,
    };
    const service = new PlaybookAssistantOperationService(operationModel as any);

    const replayed = [];
    for await (const item of service.stream('flow-1', 'owner-1', 'operation-1', 1)) replayed.push(item);

    expect(replayed).toEqual([event]);
  });

  it('commits only a completed canonical operation at its base revision', async () => {
    const updateExec = jest.fn().mockResolvedValue({});
    const operationModel = {
      findOne: jest.fn().mockImplementation(() => leanExec({
        operationId: 'operation-1', playbookId: 'flow-1', ownerId: 'owner-1',
        status: 'completed', target: 'canonical', baseDefinitionRevision: 5,
      })),
      updateOne: jest.fn().mockReturnValue({ exec: updateExec }),
    };
    const flowService = {
      update: jest.fn().mockResolvedValue({ id: 'flow-1', definitionRevision: 6 }),
    };
    const service = new PlaybookAssistantOperationService(operationModel as any, flowService as any);

    const result = await service.commit('flow-1', 'owner-1', 'operation-1', {
      name: 'Generated',
      expectedDefinitionRevision: 5,
    });

    expect(result.definitionRevision).toBe(6);
    expect(flowService.update).toHaveBeenCalledWith('flow-1', 'owner-1', expect.objectContaining({
      expectedDefinitionRevision: 5,
      clientMutationId: 'assistant-operation-operation-1',
    }));
    expect(operationModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'operation-1', status: 'completed' }),
      expect.objectContaining({ $set: expect.objectContaining({ committedRevision: 6 }) }),
    );
    expect(updateExec).toHaveBeenCalled();
  });

  it('commits a corrected canonical draft from an explicitly marked strict-validation failure', async () => {
    const updateExec = jest.fn().mockResolvedValue({});
    const operationModel = {
      findOne: jest.fn().mockImplementation(() => leanExec({
        operationId: 'operation-blocked', playbookId: 'flow-1', ownerId: 'owner-1',
        status: 'failed', target: 'canonical', disposition: 'pending', baseDefinitionRevision: 5,
        events: [
          { type: 'node_delta', suggestion: { kind: 'workflow_plan', validationStatus: 'blocked', changes: [{ type: 'create_node' }] } },
          { type: 'failed', failureKind: 'strict_validation' },
        ],
      })),
      updateOne: jest.fn().mockReturnValue({ exec: updateExec }),
    };
    const flowService = {
      update: jest.fn().mockResolvedValue({ id: 'flow-1', definitionRevision: 6 }),
    };
    const service = new PlaybookAssistantOperationService(operationModel as any, flowService as any);

    await expect(service.commit('flow-1', 'owner-1', 'operation-blocked', {
      name: 'Corrected draft', expectedDefinitionRevision: 5,
    })).resolves.toMatchObject({ definitionRevision: 6 });

    expect(flowService.update).toHaveBeenCalledWith('flow-1', 'owner-1', expect.objectContaining({
      name: 'Corrected draft',
      expectedDefinitionRevision: 5,
      clientMutationId: 'assistant-operation-operation-blocked',
    }));
    expect(operationModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'operation-blocked', status: 'failed' }),
      expect.objectContaining({ $set: expect.objectContaining({ disposition: 'applied', committedRevision: 6 }) }),
    );
  });

  it('rejects committing a generic failed canonical operation', async () => {
    const operationModel = {
      findOne: jest.fn().mockImplementation(() => leanExec({
        operationId: 'operation-failed', playbookId: 'flow-1', ownerId: 'owner-1',
        status: 'failed', target: 'canonical', disposition: 'pending', baseDefinitionRevision: 5,
        events: [{ type: 'failed', recoverable: true }],
      })),
    };
    const flowService = { update: jest.fn() };
    const service = new PlaybookAssistantOperationService(operationModel as any, flowService as any);

    await expect(service.commit('flow-1', 'owner-1', 'operation-failed', {
      name: 'Unsafe draft', expectedDefinitionRevision: 5,
    })).rejects.toThrow('not ready to commit');
    expect(flowService.update).not.toHaveBeenCalled();
  });

  it('applies or discards completed Advisor previews explicitly', async () => {
    let disposition = 'pending';
    const operationModel = {
      findOne: jest.fn().mockImplementation(() => leanExec({
        operationId: 'advisor-1', playbookId: 'flow-1', ownerId: 'owner-1',
        status: 'completed', target: 'advisor_preview', disposition, baseDefinitionRevision: 5,
      })),
      updateOne: jest.fn().mockImplementation((_filter, update) => {
        disposition = update.$set.disposition ?? disposition;
        return { exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
      }),
    };
    const flowService = { update: jest.fn().mockResolvedValue({ id: 'flow-1', definitionRevision: 6 }) };
    const service = new PlaybookAssistantOperationService(operationModel as any, flowService as any);

    const applied = await service.applyPreview('flow-1', 'owner-1', 'advisor-1', {
      name: 'Updated', expectedDefinitionRevision: 5,
    });
    expect(applied.definitionRevision).toBe(6);
    expect(disposition).toBe('applied');

    disposition = 'pending';
    await expect(service.discardPreview('flow-1', 'owner-1', 'advisor-1')).resolves.toEqual({ discarded: true });
    expect(disposition).toBe('discarded');
  });

  it('reverts a committed operation only from its committed revision', async () => {
    const operationModel = {
      findOne: jest.fn().mockImplementation(() => leanExec({
        operationId: 'operation-1', playbookId: 'flow-1', ownerId: 'owner-1',
        status: 'completed', target: 'canonical', disposition: 'applied', baseDefinitionRevision: 5, committedRevision: 6,
      })),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
    };
    const flowService = { update: jest.fn().mockResolvedValue({ id: 'flow-1', definitionRevision: 7 }) };
    const revisionModel = {
      findOne: jest.fn().mockImplementation(() => leanExec({
        operationId: 'operation-1', playbookId: 'flow-1', ownerId: 'owner-1', definition: { name: 'Before' },
      })),
    };
    const service = new PlaybookAssistantOperationService(operationModel as any, flowService as any, revisionModel as any);

    const result = await service.revert('flow-1', 'owner-1', 'operation-1');

    expect(result.definitionRevision).toBe(7);
    expect(flowService.update).toHaveBeenCalledWith('flow-1', 'owner-1', expect.objectContaining({
      name: 'Before',
      expectedDefinitionRevision: 6,
      clientMutationId: 'assistant-operation-revert-operation-1',
    }), expect.any(Object));
  });

  it('creates exactly one Playbook for concurrent generate-new Apply calls', async () => {
    const operation = {
      operationId: 'advisor-new', playbookId: 'flow-1', ownerId: 'owner-1', status: 'completed',
      target: 'advisor_preview', applyTarget: 'new_playbook', disposition: 'pending', baseDefinitionRevision: 5,
      createdPlaybookId: null as string | null,
    };
    const operationModel = {
      findOne: jest.fn().mockImplementation(() => leanExec({ ...operation })),
      findOneAndUpdate: jest.fn().mockImplementation(() => {
        const claimed = operation.disposition === 'pending';
        if (claimed) operation.disposition = 'applying';
        return leanExec(claimed ? { ...operation } : null);
      }),
      updateOne: jest.fn().mockImplementation((_filter, update) => ({
        exec: jest.fn().mockImplementation(async () => {
          Object.assign(operation, update.$set);
          return { modifiedCount: 1 };
        }),
      })),
    };
    const flowService = {
      findOneBase: jest.fn().mockImplementation(async (id) => id === 'flow-2'
        ? { id: 'flow-2', name: 'Generated', definitionRevision: 1 }
        : {
          id: 'flow-1', name: 'Source', description: '', definitionRevision: 5,
          settings: {}, nodes: [], controlEdges: [], dataBindings: [], workspaces: [],
        }),
      create: jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { id: 'flow-2', name: 'Generated', definitionRevision: 1 };
      }),
      findByAssistantOperationId: jest.fn().mockImplementation(async () => operation.createdPlaybookId
        ? { id: operation.createdPlaybookId, name: 'Generated', definitionRevision: 1 }
        : null),
      update: jest.fn(),
    };
    const service = new PlaybookAssistantOperationService(operationModel as any, flowService as any);

    const payload = {
      name: 'Generated', expectedDefinitionRevision: 5, nodes: [], controlEdges: [], dataBindings: [],
    };
    const [first, second] = await Promise.all([
      service.applyPreview('flow-1', 'owner-1', 'advisor-new', payload),
      service.applyPreview('flow-1', 'owner-1', 'advisor-new', payload),
    ]);

    expect(first.id).toBe('flow-2');
    expect(second.id).toBe('flow-2');
    expect(flowService.create).toHaveBeenCalledTimes(1);
    expect(flowService.create).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({ name: 'Generated', nodes: [] }),
      { assistantOperationId: 'advisor-new' },
    );
    expect(flowService.update).not.toHaveBeenCalled();
    expect(operationModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'advisor-new' }),
      expect.objectContaining({ $set: expect.objectContaining({ createdPlaybookId: 'flow-2', disposition: 'applied' }) }),
    );
  });

  it.each([
    ['stale source', 6, null],
    ['create failure', 5, new Error('create failed')],
  ])('releases a generate-new claim after %s', async (_label, sourceRevision, createError) => {
    const operation = {
      operationId: 'advisor-retry', playbookId: 'flow-1', ownerId: 'owner-1', status: 'completed',
      target: 'advisor_preview', applyTarget: 'new_playbook', disposition: 'pending', baseDefinitionRevision: 5,
    };
    const operationModel = {
      findOne: jest.fn().mockImplementation(() => leanExec({ ...operation })),
      findOneAndUpdate: jest.fn().mockImplementation(() => {
        operation.disposition = 'applying';
        return leanExec({ ...operation });
      }),
      updateOne: jest.fn().mockImplementation((_filter, update) => ({
        exec: jest.fn().mockImplementation(async () => {
          Object.assign(operation, update.$set);
          return { modifiedCount: 1 };
        }),
      })),
    };
    const flowService = {
      findOneBase: jest.fn().mockResolvedValue({
        id: 'flow-1', name: 'Source', definitionRevision: sourceRevision,
        settings: {}, nodes: [], controlEdges: [], dataBindings: [], workspaces: [],
      }),
      create: createError ? jest.fn().mockRejectedValue(createError) : jest.fn(),
      findByAssistantOperationId: jest.fn().mockResolvedValue(null),
    };
    const service = new PlaybookAssistantOperationService(operationModel as any, flowService as any);

    await expect(service.applyPreview('flow-1', 'owner-1', 'advisor-retry', {
      name: 'Generated', expectedDefinitionRevision: 5, nodes: [], controlEdges: [], dataBindings: [],
    })).rejects.toThrow();
    expect(operation.disposition).toBe('pending');
  });

  it('returns the recorded result when a successful revert is retried', async () => {
    const operationModel = {
      findOne: jest.fn().mockImplementation(() => leanExec({
        operationId: 'operation-1', playbookId: 'flow-1', ownerId: 'owner-1',
        disposition: 'reverted', committedRevision: 6, revertedRevision: 7,
      })),
    };
    const flowService = { update: jest.fn() };
    const service = new PlaybookAssistantOperationService(operationModel as any, flowService as any);

    await expect(service.revert('flow-1', 'owner-1', 'operation-1')).resolves.toEqual({
      reverted: true, playbookId: 'flow-1', definitionRevision: 7, createdPlaybookId: null,
    });
    expect(flowService.update).not.toHaveBeenCalled();
  });

  it('rejects a snapshot that could exceed the Mongo document limit', async () => {
    const operationModel = {
      findOne: jest.fn().mockImplementation(() => leanExec({
        operationId: 'operation-large', playbookId: 'flow-1', ownerId: 'owner-1', status: 'completed',
        target: 'canonical', applyTarget: 'current_playbook', disposition: 'pending', baseDefinitionRevision: 5,
      })),
    };
    const flowService = {
      findOneBase: jest.fn().mockResolvedValue({
        id: 'flow-1', name: 'Large', description: 'x'.repeat(13 * 1024 * 1024), definitionRevision: 5,
        settings: {}, nodes: [], controlEdges: [], dataBindings: [], workspaces: [],
      }),
      update: jest.fn(),
    };
    const revisionModel = { updateOne: jest.fn() };
    const service = new PlaybookAssistantOperationService(operationModel as any, flowService as any, revisionModel as any);

    await expect(service.commit('flow-1', 'owner-1', 'operation-large', {
      name: 'Large', expectedDefinitionRevision: 5,
    })).rejects.toThrow('too large');
    expect(revisionModel.updateOne).not.toHaveBeenCalled();
    expect(flowService.update).not.toHaveBeenCalled();
  });

  it('fails orphaned queued or running operations during startup recovery', async () => {
    let status = 'running';
    let sequence = 1;
    const operation = { operationId: 'operation-1', playbookId: 'flow-1', ownerId: 'owner-1', status, lastSequence: sequence };
    const operationModel = {
      find: jest.fn().mockReturnValue(leanExec([operation])),
      findOne: jest.fn().mockImplementation(() => leanExec({ ...operation, status, lastSequence: sequence })),
      findOneAndUpdate: jest.fn().mockImplementation((_filter, update) => {
        sequence += 1;
        status = update.$set.status;
        return leanExec({ ...operation, status, lastSequence: sequence });
      }),
    };
    const service = new PlaybookAssistantOperationService(operationModel as any);

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(status).toBe('failed');
    expect(operationModel.findOneAndUpdate.mock.calls[0][1].$push.events).toMatchObject({
      type: 'failed',
      message: 'Construction worker lease expired',
    });
    expect(operationModel.findOneAndUpdate.mock.calls[0][0].$or).toEqual(expect.arrayContaining([
      expect.objectContaining({ leaseExpiresAt: expect.objectContaining({ $lte: expect.any(Date) }) }),
    ]));
  });

  it('renews only an unexpired lease owned by the current worker', async () => {
    const exec = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const operationModel = { updateOne: jest.fn().mockReturnValue({ exec }) };
    const service = new PlaybookAssistantOperationService(operationModel as any);

    await expect(service.renewWorkerLease('flow-1', 'owner-1', 'operation-1')).resolves.toBe(true);
    expect(operationModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'operation-1',
        workerId: expect.any(String),
        status: { $in: ['queued', 'running'] },
        $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] },
      }),
      [expect.objectContaining({ $set: expect.objectContaining({
        leaseExpiresAt: { $dateAdd: { startDate: '$$NOW', unit: 'millisecond', amount: 300_000 } },
      }) })],
    );
  });

  it('reports a lost worker lease without recreating it', async () => {
    const operationModel = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }),
    };
    const service = new PlaybookAssistantOperationService(operationModel as any);

    await expect(service.renewWorkerLease('flow-1', 'owner-1', 'operation-1')).resolves.toBe(false);
  });

  it('rejects completion after cancellation has won the terminal transition', async () => {
    let status = 'running';
    let sequence = 1;
    const operationModel = {
      findOne: jest.fn().mockImplementation(() => leanExec({ status, lastSequence: sequence })),
      findOneAndUpdate: jest.fn().mockImplementation((_filter, update) => {
        sequence += 1;
        status = update.$set.status;
        return leanExec({ status, lastSequence: sequence });
      }),
    };
    const service = new PlaybookAssistantOperationService(operationModel as any);

    await service.append('flow-1', 'owner-1', 'operation-1', {
      type: 'cancelled', constructionId: 'operation-1', playbookId: 'flow-1', reason: 'Stopped',
    });

    await expect(service.append('flow-1', 'owner-1', 'operation-1', {
      type: 'completed', constructionId: 'operation-1', playbookId: 'flow-1', model: 'model-1', finalSuggestionCount: 1,
    })).rejects.toThrow('already terminal');
  });

  it('terminates safely instead of exceeding the operation event budget', async () => {
    const operationModel = {
      findOne: jest.fn().mockImplementation(() => leanExec({ status: 'running', lastSequence: 1, eventBytes: 0 })),
      findOneAndUpdate: jest.fn().mockImplementation((_filter, update) => leanExec({
        status: update.$set.status,
        lastSequence: 2,
      })),
    };
    const service = new PlaybookAssistantOperationService(operationModel as any);

    const persisted = await service.append('flow-1', 'owner-1', 'operation-1', {
      type: 'progress', constructionId: 'operation-1', playbookId: 'flow-1', phase: 'planning',
      message: 'x'.repeat(1024 * 1024 + 1),
    });

    expect(persisted).toMatchObject({
      type: 'failed',
      message: 'Construction event storage limit exceeded',
      recoverable: false,
    });
    expect(operationModel.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({ status: 'failed', leaseExpiresAt: null });
  });
});
