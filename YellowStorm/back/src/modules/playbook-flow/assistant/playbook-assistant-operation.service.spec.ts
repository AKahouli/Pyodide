import { newObjectId } from '@common/postgres';
import { PlaybookAssistantOperationService } from './playbook-assistant-operation.service';
import type { PlaybookAssistantOperationRecord } from '../persistence/assistant-operation.repository';

const operationRecord = (overrides: Partial<PlaybookAssistantOperationRecord> = {}): PlaybookAssistantOperationRecord => ({
  id: newObjectId(),
  operationId: 'operation-1',
  playbookId: 'flow-1',
  ownerId: 'owner-1',
  requestId: null,
  operationKind: 'construction',
  origin: 'designer',
  target: 'canonical',
  applyTarget: 'current_playbook',
  disposition: 'pending',
  status: 'queued',
  baseDefinitionRevision: 4,
  lastSequence: 0,
  events: [],
  eventBytes: 0,
  workerId: 'worker-1',
  leaseExpiresAt: new Date(Date.now() + 60_000),
  terminalAt: null,
  committedRevision: null,
  committedAt: null,
  revertedRevision: null,
  revertedAt: null,
  createdPlaybookId: null,
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const operationRepository = (overrides: Record<string, jest.Mock> = {}) => ({
  insert: jest.fn().mockResolvedValue(operationRecord()),
  find: jest.fn().mockResolvedValue(null),
  findOrphaned: jest.fn().mockResolvedValue([]),
  appendEvent: jest.fn().mockResolvedValue(true),
  failOrphaned: jest.fn().mockResolvedValue(true),
  renewLease: jest.fn().mockResolvedValue(true),
  discard: jest.fn().mockResolvedValue(true),
  claimApply: jest.fn().mockResolvedValue(true),
  releaseApply: jest.fn().mockResolvedValue(true),
  markApplied: jest.fn().mockResolvedValue(true),
  recordCreatedPlaybook: jest.fn().mockResolvedValue(true),
  markReverted: jest.fn().mockResolvedValue(true),
  ...overrides,
});

const key = (operationId = 'operation-1') => ({ operationId, playbookId: 'flow-1', ownerId: 'owner-1' });

describe('PlaybookAssistantOperationService', () => {
  it('persists monotonic events and terminal operation state', async () => {
    let sequence = 0;
    let status: PlaybookAssistantOperationRecord['status'] = 'queued';
    const operations = operationRepository({
      find: jest.fn().mockImplementation(async () => operationRecord({ lastSequence: sequence, status })),
      appendEvent: jest.fn().mockImplementation(async (_key, input) => {
        sequence += 1;
        status = input.status ?? status;
        return true;
      }),
    });
    const service = new PlaybookAssistantOperationService(operations as never);

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
    expect(operations.insert).toHaveBeenCalledWith(expect.objectContaining({
      ...key(), baseDefinitionRevision: 4, origin: 'designer', target: 'canonical', applyTarget: 'current_playbook',
      requestId: null, operationKind: 'construction', createdPlaybookId: null, workerId: expect.any(String),
      leaseExpiresAt: expect.any(Date), expiresAt: expect.any(Date),
    }));
    const [startKey, startInput] = operations.appendEvent.mock.calls[0];
    expect(startKey).toEqual(key());
    expect(startInput).toMatchObject({ expectedSequence: 0, status: 'running', terminal: false, workerId: expect.any(String) });
    expect(startInput.leaseExpiresAt).toBeInstanceOf(Date);
    const completedInput = operations.appendEvent.mock.calls[1][1];
    expect(completedInput).toMatchObject({ expectedSequence: 1, status: 'completed', terminal: true, leaseExpiresAt: null });
    expect(completedInput.event).toMatchObject({ sequence: 2, type: 'completed' });
    expect(completedInput.eventBytes).toBe(Buffer.byteLength(JSON.stringify({
      type: 'completed', constructionId: 'operation-1', playbookId: 'flow-1', model: 'model-1', finalSuggestionCount: 2,
    }), 'utf8'));
  });

  it('retries an append whose sequence moved and gives up after three attempts', async () => {
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({ status: 'running', lastSequence: 3 })),
      appendEvent: jest.fn().mockResolvedValue(false),
    });
    const service = new PlaybookAssistantOperationService(operations as never);

    await expect(service.append('flow-1', 'owner-1', 'operation-1', {
      type: 'progress', constructionId: 'operation-1', playbookId: 'flow-1', phase: 'planning', message: 'Working',
    })).rejects.toThrow('event sequence changed concurrently');
    expect(operations.appendEvent).toHaveBeenCalledTimes(3);
  });

  it('replays persisted events after a cursor and stops at the terminal sequence', async () => {
    const event = {
      type: 'completed', constructionId: 'operation-1', playbookId: 'flow-1', sequence: 2,
      createdAt: new Date().toISOString(), model: 'model-1', finalSuggestionCount: 1,
    };
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({ status: 'completed', baseDefinitionRevision: 3, lastSequence: 2, events: [event] })),
    });
    const service = new PlaybookAssistantOperationService(operations as never);

    const replayed = [];
    for await (const item of service.stream('flow-1', 'owner-1', 'operation-1', 1)) replayed.push(item);

    expect(replayed).toEqual([event]);
    expect(operations.find).toHaveBeenCalledWith(key());
  });

  it('reports a missing operation as not found', async () => {
    const service = new PlaybookAssistantOperationService(operationRepository() as never);
    await expect(service.getStatus('flow-1', 'owner-1', 'operation-1')).rejects.toThrow('Assistant operation not found');
    await expect(service.cancel('flow-1', 'owner-1', 'operation-1')).rejects.toThrow('Assistant operation not found');
  });

  it('commits only a completed canonical operation at its base revision', async () => {
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({ status: 'completed', target: 'canonical', baseDefinitionRevision: 5 })),
    });
    const flowService = {
      update: jest.fn().mockResolvedValue({ id: 'flow-1', definitionRevision: 6 }),
    };
    const service = new PlaybookAssistantOperationService(operations as never, flowService as never);

    const result = await service.commit('flow-1', 'owner-1', 'operation-1', {
      name: 'Generated',
      expectedDefinitionRevision: 5,
    });

    expect(result.definitionRevision).toBe(6);
    expect(flowService.update).toHaveBeenCalledWith('flow-1', 'owner-1', expect.objectContaining({
      expectedDefinitionRevision: 5,
      clientMutationId: 'assistant-operation-operation-1',
    }));
    expect(operations.markApplied).toHaveBeenCalledWith(key(), expect.objectContaining({ status: 'completed', committedRevision: 6 }));
  });

  it('captures the revert snapshot once before committing a canonical operation', async () => {
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({ status: 'completed', target: 'canonical', baseDefinitionRevision: 5 })),
    });
    const flowService = {
      findOneBase: jest.fn().mockResolvedValue({
        id: 'flow-1', name: 'Before', description: 'd', definitionRevision: 5,
        settings: {}, nodes: [{ id: 'n1' }], controlEdges: [], dataBindings: [], workspaces: [],
      }),
      update: jest.fn().mockResolvedValue({ id: 'flow-1', definitionRevision: 6 }),
    };
    const revisions = { captureOnce: jest.fn().mockResolvedValue(undefined) };
    const service = new PlaybookAssistantOperationService(operations as never, flowService as never, revisions as never);

    await service.commit('flow-1', 'owner-1', 'operation-1', { name: 'After', expectedDefinitionRevision: 5 });

    expect(revisions.captureOnce).toHaveBeenCalledWith(expect.objectContaining({
      ...key(),
      definitionRevision: 5,
      definition: expect.objectContaining({ name: 'Before', nodes: [{ id: 'n1' }] }),
      expiresAt: expect.any(Date),
    }));
    expect(revisions.captureOnce.mock.invocationCallOrder[0]).toBeLessThan(flowService.update.mock.invocationCallOrder[0]);
  });

  it('returns an already applied canonical operation without committing it again', async () => {
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({
        status: 'completed', target: 'canonical', disposition: 'applied', baseDefinitionRevision: 5, committedRevision: 6,
      })),
    });
    const committed = { id: 'flow-1', definitionRevision: 6 };
    const flowService = {
      findOneBase: jest.fn().mockResolvedValue(committed),
      update: jest.fn(),
    };
    const service = new PlaybookAssistantOperationService(operations as never, flowService as never);

    await expect(service.commit('flow-1', 'owner-1', 'operation-1', {
      name: 'Generated', expectedDefinitionRevision: 5,
    })).resolves.toBe(committed);

    expect(flowService.findOneBase).toHaveBeenCalledWith('flow-1', 'owner-1');
    expect(flowService.update).not.toHaveBeenCalled();
  });

  it('commits a corrected canonical draft from an explicitly marked strict-validation failure', async () => {
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({
        operationId: 'operation-blocked', status: 'failed', target: 'canonical', disposition: 'pending', baseDefinitionRevision: 5,
        events: [
          { type: 'node_delta', suggestion: { kind: 'workflow_plan', validationStatus: 'blocked', changes: [{ type: 'create_node' }] } },
          { type: 'failed', failureKind: 'strict_validation' },
        ],
      })),
    });
    const flowService = {
      update: jest.fn().mockResolvedValue({ id: 'flow-1', definitionRevision: 6 }),
    };
    const service = new PlaybookAssistantOperationService(operations as never, flowService as never);

    await expect(service.commit('flow-1', 'owner-1', 'operation-blocked', {
      name: 'Corrected draft', expectedDefinitionRevision: 5,
    })).resolves.toMatchObject({ definitionRevision: 6 });

    expect(flowService.update).toHaveBeenCalledWith('flow-1', 'owner-1', expect.objectContaining({
      name: 'Corrected draft',
      expectedDefinitionRevision: 5,
      clientMutationId: 'assistant-operation-operation-blocked',
    }));
    expect(operations.markApplied).toHaveBeenCalledWith(key('operation-blocked'), expect.objectContaining({ status: 'failed', committedRevision: 6 }));
  });

  it('rejects committing a generic failed canonical operation', async () => {
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({
        operationId: 'operation-failed', status: 'failed', target: 'canonical', disposition: 'pending', baseDefinitionRevision: 5,
        events: [{ type: 'failed', recoverable: true }],
      })),
    });
    const flowService = { update: jest.fn() };
    const service = new PlaybookAssistantOperationService(operations as never, flowService as never);

    await expect(service.commit('flow-1', 'owner-1', 'operation-failed', {
      name: 'Unsafe draft', expectedDefinitionRevision: 5,
    })).rejects.toThrow('not ready to commit');
    expect(flowService.update).not.toHaveBeenCalled();
  });

  it('applies or discards completed Advisor previews explicitly', async () => {
    let disposition: PlaybookAssistantOperationRecord['disposition'] = 'pending';
    const operations = operationRepository({
      find: jest.fn().mockImplementation(async () => operationRecord({
        operationId: 'advisor-1', status: 'completed', target: 'advisor_preview', disposition, baseDefinitionRevision: 5,
      })),
      markApplied: jest.fn().mockImplementation(async () => {
        disposition = 'applied';
        return true;
      }),
      discard: jest.fn().mockImplementation(async () => {
        disposition = 'discarded';
        return true;
      }),
    });
    const flowService = { update: jest.fn().mockResolvedValue({ id: 'flow-1', definitionRevision: 6 }) };
    const service = new PlaybookAssistantOperationService(operations as never, flowService as never);

    const applied = await service.applyPreview('flow-1', 'owner-1', 'advisor-1', {
      name: 'Updated', expectedDefinitionRevision: 5,
    });
    expect(applied.definitionRevision).toBe(6);
    expect(disposition).toBe('applied');

    disposition = 'pending';
    await expect(service.discardPreview('flow-1', 'owner-1', 'advisor-1')).resolves.toEqual({ discarded: true });
    expect(disposition).toBe('discarded');
    expect(operations.discard).toHaveBeenCalledWith(key('advisor-1'), expect.any(Date));

    disposition = 'applied';
    await expect(service.discardPreview('flow-1', 'owner-1', 'advisor-1')).rejects.toThrow('cannot be discarded');
  });

  it('reverts a committed operation only from its committed revision', async () => {
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({
        status: 'completed', target: 'canonical', disposition: 'applied', baseDefinitionRevision: 5, committedRevision: 6,
      })),
    });
    const flowService = { update: jest.fn().mockResolvedValue({ id: 'flow-1', definitionRevision: 7 }) };
    const revisions = {
      find: jest.fn().mockResolvedValue({ ...key(), definition: { name: 'Before' } }),
    };
    const service = new PlaybookAssistantOperationService(operations as never, flowService as never, revisions as never);

    const result = await service.revert('flow-1', 'owner-1', 'operation-1');

    expect(result.definitionRevision).toBe(7);
    expect(revisions.find).toHaveBeenCalledWith(key());
    expect(flowService.update).toHaveBeenCalledWith('flow-1', 'owner-1', expect.objectContaining({
      name: 'Before',
      expectedDefinitionRevision: 6,
      clientMutationId: 'assistant-operation-revert-operation-1',
    }), expect.any(Object));
    expect(operations.markReverted).toHaveBeenCalledWith(key(), expect.objectContaining({ revertedRevision: 7, committedRevision: 6 }));
  });

  it('reports a concurrent revert instead of recording it twice', async () => {
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({ status: 'completed', disposition: 'applied', committedRevision: 6 })),
      markReverted: jest.fn().mockResolvedValue(false),
    });
    const flowService = { update: jest.fn().mockResolvedValue({ id: 'flow-1', definitionRevision: 7 }) };
    const revisions = { find: jest.fn().mockResolvedValue({ ...key(), definition: { name: 'Before' } }) };
    const service = new PlaybookAssistantOperationService(operations as never, flowService as never, revisions as never);

    await expect(service.revert('flow-1', 'owner-1', 'operation-1')).rejects.toThrow('reverted concurrently');
  });

  it('refuses a revert whose snapshot is gone', async () => {
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({ status: 'completed', disposition: 'applied', committedRevision: 6 })),
    });
    const flowService = { update: jest.fn() };
    const revisions = { find: jest.fn().mockResolvedValue(null) };
    const service = new PlaybookAssistantOperationService(operations as never, flowService as never, revisions as never);

    await expect(service.revert('flow-1', 'owner-1', 'operation-1')).rejects.toThrow('revision snapshot not found');
    expect(flowService.update).not.toHaveBeenCalled();
  });

  it('creates exactly one Playbook for concurrent generate-new Apply calls', async () => {
    const operation = operationRecord({
      operationId: 'advisor-new', status: 'completed', target: 'advisor_preview', applyTarget: 'new_playbook',
      disposition: 'pending', baseDefinitionRevision: 5,
    });
    const operations = operationRepository({
      find: jest.fn().mockImplementation(async () => ({ ...operation })),
      claimApply: jest.fn().mockImplementation(async () => {
        const claimed = operation.disposition === 'pending';
        if (claimed) operation.disposition = 'applying';
        return claimed;
      }),
      recordCreatedPlaybook: jest.fn().mockImplementation(async (_key, input) => {
        if (operation.disposition !== 'applying') return false;
        Object.assign(operation, { disposition: 'applied', createdPlaybookId: input.createdPlaybookId, committedRevision: input.committedRevision });
        return true;
      }),
    });
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
    const service = new PlaybookAssistantOperationService(operations as never, flowService as never);

    const payload = {
      name: 'Generated', expectedDefinitionRevision: 5, nodes: [], controlEdges: [], dataBindings: [],
    };
    const [first, second] = await Promise.all([
      service.applyPreview('flow-1', 'owner-1', 'advisor-new', payload),
      service.applyPreview('flow-1', 'owner-1', 'advisor-new', payload),
    ]);
    const retry = await service.applyPreview('flow-1', 'owner-1', 'advisor-new', payload);

    expect(first.id).toBe('flow-2');
    expect(second.id).toBe('flow-2');
    expect(retry.id).toBe('flow-2');
    expect(flowService.create).toHaveBeenCalledTimes(1);
    expect(flowService.create).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({ name: 'Generated', nodes: [] }),
      { assistantOperationId: 'advisor-new' },
    );
    expect(flowService.update).not.toHaveBeenCalled();
    expect(operations.recordCreatedPlaybook).toHaveBeenCalledWith(
      key('advisor-new'),
      expect.objectContaining({ createdPlaybookId: 'flow-2', committedRevision: 1 }),
    );
  });

  it.each([
    ['stale source', 6, null],
    ['create failure', 5, new Error('create failed')],
  ])('releases a generate-new claim after %s', async (_label, sourceRevision, createError) => {
    const operation = operationRecord({
      operationId: 'advisor-retry', status: 'completed', target: 'advisor_preview', applyTarget: 'new_playbook',
      disposition: 'pending', baseDefinitionRevision: 5,
    });
    const operations = operationRepository({
      find: jest.fn().mockImplementation(async () => ({ ...operation })),
      claimApply: jest.fn().mockImplementation(async () => {
        operation.disposition = 'applying';
        return true;
      }),
      releaseApply: jest.fn().mockImplementation(async () => {
        operation.disposition = 'pending';
        return true;
      }),
    });
    const flowService = {
      findOneBase: jest.fn().mockResolvedValue({
        id: 'flow-1', name: 'Source', definitionRevision: sourceRevision,
        settings: {}, nodes: [], controlEdges: [], dataBindings: [], workspaces: [],
      }),
      create: createError ? jest.fn().mockRejectedValue(createError) : jest.fn(),
      findByAssistantOperationId: jest.fn().mockResolvedValue(null),
    };
    const service = new PlaybookAssistantOperationService(operations as never, flowService as never);

    await expect(service.applyPreview('flow-1', 'owner-1', 'advisor-retry', {
      name: 'Generated', expectedDefinitionRevision: 5, nodes: [], controlEdges: [], dataBindings: [],
    })).rejects.toThrow();
    expect(operation.disposition).toBe('pending');
    expect(operations.releaseApply).toHaveBeenCalledWith(key('advisor-retry'), expect.any(Date));
  });

  it('returns the recorded result when a successful revert is retried', async () => {
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({ disposition: 'reverted', committedRevision: 6, revertedRevision: 7 })),
    });
    const flowService = { update: jest.fn() };
    const service = new PlaybookAssistantOperationService(operations as never, flowService as never);

    await expect(service.revert('flow-1', 'owner-1', 'operation-1')).resolves.toEqual({
      reverted: true, playbookId: 'flow-1', definitionRevision: 7, createdPlaybookId: null,
    });
    expect(flowService.update).not.toHaveBeenCalled();
  });

  it('rejects a revert snapshot that would be too large to keep', async () => {
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({
        operationId: 'operation-large', status: 'completed', target: 'canonical', applyTarget: 'current_playbook',
        disposition: 'pending', baseDefinitionRevision: 5,
      })),
    });
    const flowService = {
      findOneBase: jest.fn().mockResolvedValue({
        id: 'flow-1', name: 'Large', description: 'x'.repeat(13 * 1024 * 1024), definitionRevision: 5,
        settings: {}, nodes: [], controlEdges: [], dataBindings: [], workspaces: [],
      }),
      update: jest.fn(),
    };
    const revisions = { captureOnce: jest.fn() };
    const service = new PlaybookAssistantOperationService(operations as never, flowService as never, revisions as never);

    await expect(service.commit('flow-1', 'owner-1', 'operation-large', {
      name: 'Large', expectedDefinitionRevision: 5,
    })).rejects.toThrow('too large');
    expect(revisions.captureOnce).not.toHaveBeenCalled();
    expect(flowService.update).not.toHaveBeenCalled();
  });

  it('fails orphaned queued or running operations during startup recovery', async () => {
    const operations = operationRepository({
      findOrphaned: jest.fn().mockResolvedValue([{ ...key(), lastSequence: 1 }]),
    });
    const service = new PlaybookAssistantOperationService(operations as never);

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(operations.findOrphaned).toHaveBeenCalledWith(expect.any(Date));
    const cutoff = operations.findOrphaned.mock.calls[0][0];
    expect(operations.failOrphaned).toHaveBeenCalledWith(key(), expect.objectContaining({
      expectedSequence: 1,
      cutoff,
      expiresAt: expect.any(Date),
      event: expect.objectContaining({ type: 'failed', message: 'Construction worker lease expired', recoverable: true, sequence: 2 }),
    }));
  });

  it('renews only the lease of the current worker, for the configured durations', async () => {
    const operations = operationRepository();
    const service = new PlaybookAssistantOperationService(operations as never);

    await expect(service.renewWorkerLease('flow-1', 'owner-1', 'operation-1')).resolves.toBe(true);
    await service.create({ operationId: 'operation-1', playbookId: 'flow-1', ownerId: 'owner-1', baseDefinitionRevision: 0 });
    const workerId = operations.insert.mock.calls[0][0].workerId;
    expect(operations.renewLease).toHaveBeenCalledWith(key(), workerId, 300_000, 24 * 60 * 60 * 1000);
  });

  it('reports a lost worker lease without recreating it', async () => {
    const operations = operationRepository({ renewLease: jest.fn().mockResolvedValue(false) });
    const service = new PlaybookAssistantOperationService(operations as never);

    await expect(service.renewWorkerLease('flow-1', 'owner-1', 'operation-1')).resolves.toBe(false);
  });

  it('rejects completion after cancellation has won the terminal transition', async () => {
    let status: PlaybookAssistantOperationRecord['status'] = 'running';
    let sequence = 1;
    const operations = operationRepository({
      find: jest.fn().mockImplementation(async () => operationRecord({ status, lastSequence: sequence })),
      appendEvent: jest.fn().mockImplementation(async (_key, input) => {
        sequence += 1;
        status = input.status;
        return true;
      }),
    });
    const service = new PlaybookAssistantOperationService(operations as never);

    await service.append('flow-1', 'owner-1', 'operation-1', {
      type: 'cancelled', constructionId: 'operation-1', playbookId: 'flow-1', reason: 'Stopped',
    });
    // A cancellation is not bound to the worker lease.
    expect(operations.appendEvent.mock.calls[0][1].workerId).toBeUndefined();

    await expect(service.append('flow-1', 'owner-1', 'operation-1', {
      type: 'completed', constructionId: 'operation-1', playbookId: 'flow-1', model: 'model-1', finalSuggestionCount: 1,
    })).rejects.toThrow('already terminal');
  });

  it('terminates safely instead of exceeding the operation event budget', async () => {
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({ status: 'running', lastSequence: 1, eventBytes: 0 })),
    });
    const service = new PlaybookAssistantOperationService(operations as never);

    const persisted = await service.append('flow-1', 'owner-1', 'operation-1', {
      type: 'progress', constructionId: 'operation-1', playbookId: 'flow-1', phase: 'planning',
      message: 'x'.repeat(1024 * 1024 + 1),
    });

    expect(persisted).toMatchObject({
      type: 'failed',
      message: 'Construction event storage limit exceeded',
      recoverable: false,
    });
    expect(operations.appendEvent.mock.calls[0][1]).toMatchObject({ status: 'failed', terminal: true, leaseExpiresAt: null });
  });

  it('terminates when the event would push the operation past its total budget', async () => {
    const operations = operationRepository({
      find: jest.fn().mockResolvedValue(operationRecord({ status: 'running', lastSequence: 1, eventBytes: 8 * 1024 * 1024 - 10 })),
    });
    const service = new PlaybookAssistantOperationService(operations as never);

    const persisted = await service.append('flow-1', 'owner-1', 'operation-1', {
      type: 'progress', constructionId: 'operation-1', playbookId: 'flow-1', phase: 'planning', message: 'Working on it',
    });

    expect(persisted).toMatchObject({ type: 'failed', message: 'Construction event storage limit exceeded' });
  });
});
