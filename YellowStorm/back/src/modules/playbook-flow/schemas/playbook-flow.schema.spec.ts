import { FlowSchema } from './playbook-flow.schema';
import { PlaybookFlowService } from '../services/playbook-flow.service';

describe('FlowSchema assistant operation idempotency', () => {
  it('does not default ordinary Flows to an indexed null operation id', () => {
    expect(FlowSchema.path('assistantOperationId').options.default).toBeUndefined();
  });

  it('uniquely indexes only string operation ids', () => {
    const operationIndex = FlowSchema.indexes().find(([fields]) => fields.assistantOperationId === 1);

    expect(operationIndex).toEqual([
      { assistantOperationId: 1 },
      expect.objectContaining({
        name: 'assistantOperationId_unique_string',
        unique: true,
        partialFilterExpression: { assistantOperationId: { $type: 'string' } },
      }),
    ]);
  });

  it('migrates null values and replaces the legacy sparse index', async () => {
    const updateExec = jest.fn().mockResolvedValue({ modifiedCount: 2 });
    const flowModel = {
      updateMany: jest.fn().mockReturnValue({ exec: updateExec }),
      collection: {
        indexes: jest.fn().mockResolvedValue([{ name: 'assistantOperationId_1', sparse: true }]),
        dropIndex: jest.fn().mockResolvedValue(undefined),
        createIndex: jest.fn().mockResolvedValue('assistantOperationId_unique_string'),
      },
    };
    const service = new PlaybookFlowService(
      flowModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.onModuleInit();

    expect(flowModel.updateMany).toHaveBeenCalledWith(
      { assistantOperationId: { $type: 'null' } },
      { $unset: { assistantOperationId: 1 } },
    );
    expect(flowModel.collection.dropIndex).toHaveBeenCalledWith('assistantOperationId_1');
    expect(flowModel.collection.createIndex).toHaveBeenCalledWith(
      { assistantOperationId: 1 },
      expect.objectContaining({
        name: 'assistantOperationId_unique_string',
        unique: true,
        partialFilterExpression: { assistantOperationId: { $type: 'string' } },
      }),
    );
  });
});
