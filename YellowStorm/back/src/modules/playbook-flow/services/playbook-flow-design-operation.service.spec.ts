import { BadRequestException } from '@modules/exceptions';
import { DEFAULT_ADMIN_PLAYBOOK_SETTINGS } from '@modules/system/interfaces/playbook-settings.interface';
import { PlaybookFlowDesignOperationService } from './playbook-flow-design-operation.service';

function createExecMock<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function createService(overrides: Partial<Record<string, any>> = {}) {
  const operationModel = {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn().mockResolvedValue(0),
    find: jest.fn(),
    findById: jest.fn(),
    updateOne: jest.fn().mockReturnValue(createExecMock({ modifiedCount: 1 })),
    ...overrides.operationModel,
  };
  const systemService = {
    getPlaybookSettings: jest.fn().mockResolvedValue({
      playbookExecution: { ...DEFAULT_ADMIN_PLAYBOOK_SETTINGS.playbookExecution, asyncDesignEnabled: true },
    }),
  };
  const flowService = {
    findById: jest.fn().mockResolvedValue({
      id: '64f000000000000000000001',
      ownerId: '64f000000000000000000002',
      nodes: [],
      controlEdges: [],
      dataBindings: [],
    }),
  };
  const designService = {
    designFlow: jest.fn().mockResolvedValue({ flow: { id: 'flow-1' }, message: { id: '64f000000000000000000003' } }),
  };

  const service = new PlaybookFlowDesignOperationService(
    operationModel as any,
    systemService as any,
    flowService as any,
    designService as any,
  );

  return { service, operationModel, flowService, designService, systemService };
}

describe('PlaybookFlowDesignOperationService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('enqueues a durable design operation with a flow snapshot', async () => {
    jest.useFakeTimers();
    const operation = {
      toObject: () => ({
        _id: '64f000000000000000000004',
        flowId: '64f000000000000000000001',
        ownerId: '64f000000000000000000002',
        query: 'add a review step',
        status: 'queued',
        lockVersion: 0,
      }),
    };
    const { service, operationModel } = createService({
      operationModel: {
        findOneAndUpdate: jest.fn().mockReturnValue(createExecMock(operation)),
      },
    });

    const result = await service.enqueue(
      '64f000000000000000000002',
      '64f000000000000000000001',
      ' add a review step ',
      'idem-1',
    );

    expect(operationModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'idem-1' }),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          query: 'add a review step',
          status: 'queued',
          snapshotBefore: expect.objectContaining({ nodes: [] }),
        }),
      }),
      { upsert: true, new: true },
    );
    expect(result).toEqual(expect.objectContaining({ id: '64f000000000000000000004', status: 'queued' }));
  });

  it('rejects empty design operation queries', async () => {
    const { service } = createService();
    await expect(service.enqueue('64f000000000000000000002', '64f000000000000000000001', '   '))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects enqueue when async design is disabled', async () => {
    const { operationModel, flowService, designService } = createService();
    const service = new PlaybookFlowDesignOperationService(
      operationModel as any,
      { getPlaybookSettings: jest.fn().mockResolvedValue({
        playbookExecution: { ...DEFAULT_ADMIN_PLAYBOOK_SETTINGS.playbookExecution, asyncDesignEnabled: false },
      }) } as any,
      flowService as any,
      designService as any,
    );

    await expect(service.enqueue('64f000000000000000000002', '64f000000000000000000001', 'design this'))
      .rejects.toMatchObject({ message: 'Asynchronous design operations are disabled' });
  });

  it('cancels only queued operations', async () => {
    const operation = {
      toObject: () => ({
        _id: '64f000000000000000000004',
        flowId: '64f000000000000000000001',
        ownerId: '64f000000000000000000002',
        query: 'add a review step',
        status: 'cancelled',
        lockVersion: 0,
      }),
    };
    const { service, operationModel } = createService({
      operationModel: {
        findOneAndUpdate: jest.fn().mockReturnValue(createExecMock(operation)),
      },
    });

    const result = await service.cancel(
      '64f000000000000000000002',
      '64f000000000000000000001',
      '64f000000000000000000004',
    );

    expect(operationModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued' }),
      { status: 'cancelled', completedAt: expect.any(Date) },
      { new: true },
    );
    expect(result).toEqual(expect.objectContaining({ status: 'cancelled' }));
  });

  it('maps lean operation lookups without requiring toObject', async () => {
    const { service, operationModel } = createService({
      operationModel: {
        findOne: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue(createExecMock({
            _id: '64f000000000000000000010',
            flowId: '64f000000000000000000001',
            ownerId: '64f000000000000000000002',
            query: 'status check',
            status: 'completed',
            lockVersion: 1,
          })),
        }),
      },
    });

    const result = await service.findOne(
      '64f000000000000000000002',
      '64f000000000000000000001',
      '64f000000000000000000010',
    );

    expect(operationModel.findOne).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      id: '64f000000000000000000010',
      status: 'completed',
      lockVersion: 1,
    }));
  });
});
