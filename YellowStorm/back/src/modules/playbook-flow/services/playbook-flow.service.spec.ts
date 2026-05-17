import { PlaybookFlowService } from './playbook-flow.service';

describe('PlaybookFlowService', () => {
  it('persists control-edge port ids on create', async () => {
    const savedFlow = {
      toJSON: jest.fn().mockReturnValue({
        id: 'flow-1',
        ownerId: 'owner-1',
        schemaVersion: 1,
        name: 'Flow',
        description: 'Description',
        settings: { recursionLimit: 25, maxParallelism: 5 },
        nodes: [],
        controlEdges: [{
          id: 'edge-1',
          kind: 'sequential',
          source: 'task-1',
          target: 'task-2',
          sourceOutputPortId: 'out-2',
          targetInputPortId: 'in-3',
        }],
        dataBindings: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    const flowModel = jest.fn().mockImplementation((doc) => ({
      ...doc,
      save: jest.fn().mockResolvedValue(savedFlow),
    }));

    const validatorService = { validate: jest.fn() };
    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
    );

    const result = await service.create('owner-1', {
      name: 'Flow',
      nodes: [],
      controlEdges: [{
        id: 'edge-1',
        kind: 'sequential',
        source: 'task-1',
        target: 'task-2',
        sourceOutputPortId: 'out-2',
        targetInputPortId: 'in-3',
      }],
      dataBindings: [],
    } as any);

    expect(flowModel).toHaveBeenCalledWith(expect.objectContaining({
      controlEdges: [{
        id: 'edge-1',
        kind: 'sequential',
        source: 'task-1',
        target: 'task-2',
        sourceOutputPortId: 'out-2',
        targetInputPortId: 'in-3',
      }],
    }));
    expect(validatorService.validate).toHaveBeenCalledWith([], [{
      id: 'edge-1',
      kind: 'sequential',
      source: 'task-1',
      target: 'task-2',
      sourceOutputPortId: 'out-2',
      targetInputPortId: 'in-3',
    }], []);
    expect(result.controlEdges[0]).toMatchObject({
      sourceOutputPortId: 'out-2',
      targetInputPortId: 'in-3',
    });
  });

  it('preserves control-edge port ids on update', async () => {
    const existing = {
      ownerId: 'owner-1',
      name: 'Flow',
      description: 'Description',
      triggerConfig: undefined,
      settings: { recursionLimit: 25, maxParallelism: 5 },
      nodes: [{ id: 'task-1' }, { id: 'task-2' }],
      controlEdges: [],
      dataBindings: [],
      save: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: '507f1f77bcf86cd799439011',
          ownerId: 'owner-1',
          schemaVersion: 1,
          name: 'Flow',
          description: 'Description',
          settings: { recursionLimit: 25, maxParallelism: 5 },
          nodes: [{ id: 'task-1' }, { id: 'task-2' }],
          controlEdges: [{
            id: 'edge-1',
            kind: 'sequential',
            source: 'task-1',
            target: 'task-2',
            sourceOutputPortId: 'out-2',
            targetInputPortId: 'in-3',
          }],
          dataBindings: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      }),
    };
    const flowModel = {
      findById: jest.fn().mockResolvedValue(existing),
    };

    const validatorService = { validate: jest.fn() };
    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
    );

    const result = await service.update('507f1f77bcf86cd799439011', 'owner-1', {
      controlEdges: [{
        id: 'edge-1',
        kind: 'sequential',
        source: 'task-1',
        target: 'task-2',
        sourceOutputPortId: 'out-2',
        targetInputPortId: 'in-3',
      }],
    } as any);

    expect(existing.controlEdges[0]).toMatchObject({
      sourceOutputPortId: 'out-2',
      targetInputPortId: 'in-3',
    });
    expect(validatorService.validate).toHaveBeenCalledWith(
      [{ id: 'task-1' }, { id: 'task-2' }],
      [{
        id: 'edge-1',
        kind: 'sequential',
        source: 'task-1',
        target: 'task-2',
        sourceOutputPortId: 'out-2',
        targetInputPortId: 'in-3',
      }],
      [],
    );
    expect(result.controlEdges[0]).toMatchObject({
      sourceOutputPortId: 'out-2',
      targetInputPortId: 'in-3',
    });
  });

  it('rejects invalid merged graph state on update before saving', async () => {
    const validationError = new Error('invalid binding');
    const existing = {
      ownerId: 'owner-1',
      name: 'Flow',
      description: 'Description',
      triggerConfig: undefined,
      settings: { recursionLimit: 25, maxParallelism: 5 },
      nodes: [{ id: 'task-1' }],
      controlEdges: [],
      dataBindings: [],
      save: jest.fn(),
    };
    const flowModel = {
      findById: jest.fn().mockResolvedValue(existing),
    };
    const validatorService = {
      validate: jest.fn().mockImplementation(() => {
        throw validationError;
      }),
    };

    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
    );

    await expect(service.update('507f1f77bcf86cd799439011', 'owner-1', {
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'task-1',
        targetPort: 'prompt',
        sourceKind: 'node-output',
      }],
    } as any)).rejects.toThrow(validationError);

    expect(existing.save).not.toHaveBeenCalled();
  });

  it('validates updateNodesAndEdges before saving AI-generated changes', async () => {
    const existing = {
      nodes: [{ id: 'task-1' }],
      controlEdges: [],
      dataBindings: [],
      save: jest.fn().mockResolvedValue({
        toJSON: () => ({ id: 'flow-1', nodes: [{ id: 'task-1' }], controlEdges: [], dataBindings: [] }),
      }),
    };
    const flowModel = {
      findById: jest.fn().mockResolvedValue(existing),
    };
    const validatorService = { validate: jest.fn() };

    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
    );

    await service.updateNodesAndEdges('flow-1', {
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'task-1',
        targetPort: 'prompt',
        sourceKind: 'constant',
        constantValue: { text: 'hi' },
      }],
    });

    expect(validatorService.validate).toHaveBeenCalledWith(
      [{ id: 'task-1' }],
      [],
      [{
        id: 'binding-1',
        targetNode: 'task-1',
        targetPort: 'prompt',
        sourceKind: 'constant',
        constantValue: { text: 'hi' },
      }],
    );
  });
});
