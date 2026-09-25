import { BadRequestException, NotFoundException } from '@modules/exceptions';
import { DEFAULT_ADMIN_PLAYBOOK_SETTINGS } from '@modules/system/interfaces/playbook-settings.interface';
import { PlaybookFlowDesignOperationService } from './playbook-flow-design-operation.service';

const FLOW_ID = '64f000000000000000000001';
const OWNER_ID = '64f000000000000000000002';
const MESSAGE_ID = '64f000000000000000000003';
const OPERATION_ID = '64f000000000000000000004';

const operationRecord = (overrides: Record<string, unknown> = {}) => ({
  id: OPERATION_ID,
  flowId: FLOW_ID,
  ownerId: OWNER_ID,
  query: 'add a review step',
  status: 'queued',
  idempotencyKey: null,
  startedAt: null,
  completedAt: null,
  error: null,
  snapshotBefore: null,
  resultPreview: null,
  appliedMessageId: null,
  lockVersion: 0,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  ...overrides,
});

function createService(overrides: { operations?: Record<string, jest.Mock>; asyncDesignEnabled?: boolean } = {}) {
  const operations = {
    enqueue: jest.fn().mockResolvedValue(operationRecord()),
    findById: jest.fn().mockResolvedValue(null),
    findForOwner: jest.fn().mockResolvedValue(null),
    cancelQueued: jest.fn().mockResolvedValue(null),
    countActive: jest.fn().mockResolvedValue(0),
    claimNext: jest.fn().mockResolvedValue(null),
    markApplying: jest.fn().mockResolvedValue(true),
    finish: jest.fn().mockResolvedValue(true),
    ...overrides.operations,
  };
  const systemService = {
    getPlaybookSettings: jest.fn().mockResolvedValue({
      playbookExecution: { ...DEFAULT_ADMIN_PLAYBOOK_SETTINGS.playbookExecution, asyncDesignEnabled: overrides.asyncDesignEnabled ?? true },
    }),
  };
  const flowService = {
    findById: jest.fn().mockResolvedValue({
      id: FLOW_ID,
      ownerId: OWNER_ID,
      nodes: [],
      controlEdges: [],
      dataBindings: [],
    }),
  };
  const designService = {
    designFlow: jest.fn().mockResolvedValue({ flow: { id: FLOW_ID }, message: { id: MESSAGE_ID } }),
  };

  const service = new PlaybookFlowDesignOperationService(
    operations as any,
    systemService as any,
    flowService as any,
    designService as any,
  );

  return { service, operations, flowService, designService, systemService };
}

describe('PlaybookFlowDesignOperationService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('enqueues a durable design operation with a flow snapshot', async () => {
    jest.useFakeTimers();
    const { service, operations } = createService();

    const result = await service.enqueue(OWNER_ID, FLOW_ID, ' add a review step ', 'idem-1');

    expect(operations.enqueue).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      flowId: FLOW_ID,
      query: 'add a review step',
      idempotencyKey: 'idem-1',
      snapshotBefore: expect.objectContaining({ nodes: [], controlEdges: [], dataBindings: [] }),
    });
    expect(result).toEqual({
      id: OPERATION_ID,
      flowId: FLOW_ID,
      ownerId: OWNER_ID,
      query: 'add a review step',
      status: 'queued',
      error: null,
      startedAt: null,
      completedAt: null,
      resultPreview: null,
      appliedMessageId: null,
      lockVersion: 0,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      updatedAt: new Date('2026-09-01T00:00:00Z'),
    });
  });

  it('rejects empty design operation queries', async () => {
    const { service } = createService();
    await expect(service.enqueue(OWNER_ID, FLOW_ID, '   '))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects enqueue when async design is disabled', async () => {
    const { service } = createService({ asyncDesignEnabled: false });

    await expect(service.enqueue(OWNER_ID, FLOW_ID, 'design this'))
      .rejects.toMatchObject({ message: 'Asynchronous design operations are disabled' });
  });

  it('hides a flow the caller does not own', async () => {
    const { service, operations } = createService();

    await expect(service.enqueue('64f000000000000000000009', FLOW_ID, 'design this')).rejects.toBeInstanceOf(NotFoundException);
    expect(operations.enqueue).not.toHaveBeenCalled();
  });

  it('reports a flow deleted while the operation was being queued as not found', async () => {
    jest.useFakeTimers();
    const fkViolation = Object.assign(new Error('insert violates foreign key constraint'), { code: '23503' });
    const { service } = createService({ operations: { enqueue: jest.fn().mockRejectedValue(fkViolation) } });

    await expect(service.enqueue(OWNER_ID, FLOW_ID, 'design this')).rejects.toThrow('Playbook flow not found');
  });

  it('cancels only queued operations', async () => {
    const { service, operations } = createService({
      operations: { cancelQueued: jest.fn().mockResolvedValue(operationRecord({ status: 'cancelled', completedAt: new Date() })) },
    });

    const result = await service.cancel(OWNER_ID, FLOW_ID, OPERATION_ID);

    expect(operations.cancelQueued).toHaveBeenCalledWith(OPERATION_ID, OWNER_ID, FLOW_ID);
    expect(result).toEqual(expect.objectContaining({ status: 'cancelled' }));

    operations.cancelQueued.mockResolvedValue(null);
    await expect(service.cancel(OWNER_ID, FLOW_ID, OPERATION_ID)).rejects.toThrow('Only queued design operations can be cancelled');
  });

  it('maps an operation lookup of the owner', async () => {
    const { service, operations } = createService({
      operations: {
        findForOwner: jest.fn().mockResolvedValue(operationRecord({
          id: '64f000000000000000000010', query: 'status check', status: 'completed', lockVersion: 1,
          resultPreview: { flowId: FLOW_ID }, appliedMessageId: MESSAGE_ID,
        })),
      },
    });

    const result = await service.findOne(OWNER_ID, FLOW_ID, '64f000000000000000000010');

    expect(operations.findForOwner).toHaveBeenCalledWith('64f000000000000000000010', OWNER_ID, FLOW_ID);
    expect(result).toEqual(expect.objectContaining({
      id: '64f000000000000000000010',
      status: 'completed',
      lockVersion: 1,
      resultPreview: { flowId: FLOW_ID },
      appliedMessageId: MESSAGE_ID,
    }));

    operations.findForOwner.mockResolvedValue(null);
    await expect(service.findOne(OWNER_ID, FLOW_ID, 'nope')).rejects.toThrow('Design operation not found');
  });

  it('drains a claimed operation through design and records the applied message', async () => {
    const claimed = operationRecord({ status: 'running', lockVersion: 1 });
    const { service, operations, designService, systemService } = createService({
      operations: {
        claimNext: jest.fn().mockResolvedValueOnce(claimed).mockResolvedValue(null),
        findById: jest.fn().mockResolvedValue(claimed),
      },
    });

    await (service as unknown as { drain: () => Promise<void> }).drain();
    await new Promise((resolve) => setImmediate(resolve));

    const { maxConcurrentUserDesignOperations } = (await systemService.getPlaybookSettings()).playbookExecution;
    expect(operations.claimNext).toHaveBeenCalledWith(maxConcurrentUserDesignOperations);
    expect(operations.markApplying).toHaveBeenCalledWith(OPERATION_ID, 1);
    expect(designService.designFlow).toHaveBeenCalledWith(OWNER_ID, FLOW_ID, 'add a review step');
    expect(operations.finish).toHaveBeenCalledWith(OPERATION_ID, 1, {
      status: 'completed',
      resultPreview: { flowId: FLOW_ID },
      appliedMessageId: MESSAGE_ID,
    });
  });

  it('records the failure of a design run', async () => {
    const claimed = operationRecord({ status: 'running', lockVersion: 2 });
    const { service, operations, designService } = createService({ operations: { findById: jest.fn().mockResolvedValue(claimed) } });
    designService.designFlow.mockRejectedValue(new Error('gRPC unavailable'));

    await (service as unknown as { runOperation: (id: string) => Promise<void> }).runOperation(OPERATION_ID);

    expect(operations.finish).toHaveBeenCalledWith(OPERATION_ID, 2, { status: 'failed', error: 'gRPC unavailable' });
  });

  it('does not run an operation that is no longer running', async () => {
    const { service, operations, designService } = createService({
      operations: { findById: jest.fn().mockResolvedValue(operationRecord({ status: 'cancelled' })) },
    });

    await (service as unknown as { runOperation: (id: string) => Promise<void> }).runOperation(OPERATION_ID);

    expect(operations.markApplying).not.toHaveBeenCalled();
    expect(designService.designFlow).not.toHaveBeenCalled();
  });

  it('stops claiming once the global capacity is used', async () => {
    const { service, operations, systemService } = createService();
    const { maxConcurrentGlobalDesignOperations } = (await systemService.getPlaybookSettings()).playbookExecution;
    operations.countActive.mockResolvedValue(maxConcurrentGlobalDesignOperations);

    await (service as unknown as { drain: () => Promise<void> }).drain();

    expect(operations.claimNext).not.toHaveBeenCalled();
  });
});
