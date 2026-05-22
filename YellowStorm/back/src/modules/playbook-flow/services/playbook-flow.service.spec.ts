import { PlaybookFlowService } from './playbook-flow.service';
import { BadRequestException, ConflictException } from '../../exceptions/exceptions/http.exceptions';

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
    (flowModel as any).exists = jest.fn().mockResolvedValue(null);

    const validatorService = { validate: jest.fn() };
    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
      {} as any,
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
      workspaces: ['workspace-1'],
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
    }], [], { allowDraftRouters: true });
    expect(result.controlEdges[0]).toMatchObject({
      sourceOutputPortId: 'out-2',
      targetInputPortId: 'in-3',
    });
  });

  it('normalizes workspaces to a single default workspace on create', async () => {
    const savedFlow = {
      toJSON: jest.fn().mockReturnValue({
        id: 'flow-1',
        ownerId: 'owner-1',
        schemaVersion: 1,
        name: 'Flow',
        description: 'Description',
        settings: { recursionLimit: 25, maxParallelism: 5 },
        nodes: [],
        controlEdges: [],
        dataBindings: [],
        workspaces: ['workspace-1'],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    const flowModel = jest.fn().mockImplementation((doc) => ({
      ...doc,
      save: jest.fn().mockResolvedValue(savedFlow),
    }));
    (flowModel as any).exists = jest.fn().mockResolvedValue(null);

    const validatorService = { validate: jest.fn() };
    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
      {} as any,
    );

    const result = await service.create('owner-1', {
      name: 'Flow',
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['workspace-1', 'workspace-2'],
    } as any);

    expect(flowModel).toHaveBeenCalledWith(expect.objectContaining({
      workspaces: ['workspace-1'],
      advisorScoringMode: 'llm',
    }));
    expect(result.workspaces).toEqual(['workspace-1']);
  });

  it('defaults advisor scoring mode to llm on create', async () => {
    const savedFlow = {
      toJSON: jest.fn().mockReturnValue({
        id: 'flow-2',
        ownerId: 'owner-1',
        schemaVersion: 1,
        name: 'Flow',
        description: 'Description',
        settings: { recursionLimit: 25, maxParallelism: 5 },
        nodes: [],
        controlEdges: [],
        dataBindings: [],
        workspaces: ['workspace-1'],
        advisorScoringMode: 'llm',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    const flowModel = jest.fn().mockImplementation((doc) => ({
      ...doc,
      save: jest.fn().mockResolvedValue(savedFlow),
    }));
    (flowModel as any).exists = jest.fn().mockResolvedValue(null);
    const validatorService = { validate: jest.fn() };
    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
      {} as any,
    );

    await service.create('owner-1', {
      name: 'Flow',
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['workspace-1'],
    } as any);

    expect(flowModel).toHaveBeenCalledWith(expect.objectContaining({ advisorScoringMode: 'llm' }));
  });

  it('rejects create when no workspace is selected', async () => {
    const flowModel = jest.fn();
    const validatorService = { validate: jest.fn() };
    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
      {} as any,
    );

    await expect(service.create('owner-1', {
      name: 'Flow',
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: [],
    } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(flowModel).not.toHaveBeenCalled();
  });

  it('rejects create when the workspace id is blank', async () => {
    const flowModel = jest.fn();
    const validatorService = { validate: jest.fn() };
    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
      {} as any,
    );

    await expect(service.create('owner-1', {
      name: 'Flow',
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['   '],
    } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(flowModel).not.toHaveBeenCalled();
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
      workspaces: ['workspace-1'],
      advisorScoringMode: 'heuristic',
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
          advisorScoringMode: 'heuristic',
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
      {} as any,
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
      advisorScoringMode: 'heuristic',
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
      { allowDraftRouters: true },
    );
    expect(result.controlEdges[0]).toMatchObject({
      sourceOutputPortId: 'out-2',
      targetInputPortId: 'in-3',
    });
    expect(existing.advisorScoringMode).toBe('heuristic');
  });

  it('normalizes workspace updates to a single default workspace', async () => {
    const existing = {
      ownerId: 'owner-1',
      name: 'Flow',
      description: 'Description',
      triggerConfig: undefined,
      settings: { recursionLimit: 25, maxParallelism: 5 },
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['workspace-1'],
      save: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: '507f1f77bcf86cd799439011',
          ownerId: 'owner-1',
          schemaVersion: 1,
          name: 'Flow',
          description: 'Description',
          settings: { recursionLimit: 25, maxParallelism: 5 },
          nodes: [],
          controlEdges: [],
          dataBindings: [],
          workspaces: ['workspace-2'],
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
      {} as any,
    );

    const result = await service.update('507f1f77bcf86cd799439011', 'owner-1', {
      workspaces: ['workspace-2', 'workspace-3'],
    } as any);

    expect(existing.workspaces).toEqual(['workspace-2']);
    expect(validatorService.validate).toHaveBeenCalledWith([], [], [], { allowDraftRouters: true });
    expect(result.workspaces).toEqual(['workspace-2']);
  });

  it('normalizes legacy multi-workspace state during unrelated updates', async () => {
    const existing = {
      ownerId: 'owner-1',
      name: 'Flow',
      description: 'Description',
      triggerConfig: undefined,
      settings: { recursionLimit: 25, maxParallelism: 5 },
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['workspace-1', 'workspace-2'],
      save: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: '507f1f77bcf86cd799439011',
          ownerId: 'owner-1',
          schemaVersion: 1,
          name: 'Renamed Flow',
          description: 'Description',
          settings: { recursionLimit: 25, maxParallelism: 5 },
          nodes: [],
          controlEdges: [],
          dataBindings: [],
          workspaces: ['workspace-1'],
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
      {} as any,
    );

    const result = await service.update('507f1f77bcf86cd799439011', 'owner-1', {
      name: 'Renamed Flow',
    } as any);

    expect(existing.workspaces).toEqual(['workspace-1']);
    expect(result.workspaces).toEqual(['workspace-1']);
  });

  it('rejects update when workspaces are explicitly cleared', async () => {
    const existing = {
      ownerId: 'owner-1',
      name: 'Flow',
      description: 'Description',
      triggerConfig: undefined,
      settings: { recursionLimit: 25, maxParallelism: 5 },
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['workspace-1'],
      save: jest.fn(),
    };
    const flowModel = {
      findById: jest.fn().mockResolvedValue(existing),
    };
    const validatorService = { validate: jest.fn() };
    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
      {} as any,
    );

    await expect(service.update('507f1f77bcf86cd799439011', 'owner-1', {
      workspaces: [],
    } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(existing.save).not.toHaveBeenCalled();
  });

  it('allows unrelated updates for legacy playbooks that still have no workspace', async () => {
    const existing = {
      ownerId: 'owner-1',
      name: 'Flow',
      description: 'Description',
      triggerConfig: undefined,
      settings: { recursionLimit: 25, maxParallelism: 5 },
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: [],
      save: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: '507f1f77bcf86cd799439011',
          ownerId: 'owner-1',
          schemaVersion: 1,
          name: 'Renamed Flow',
          description: 'Description',
          settings: { recursionLimit: 25, maxParallelism: 5 },
          nodes: [],
          controlEdges: [],
          dataBindings: [],
          workspaces: [],
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
      {} as any,
    );

    const result = await service.update('507f1f77bcf86cd799439011', 'owner-1', {
      name: 'Renamed Flow',
    } as any);

    expect(existing.save).toHaveBeenCalled();
    expect(result.workspaces).toEqual([]);
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
      workspaces: ['workspace-1'],
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
      {} as any,
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

  it('rejects stale suggestion saves when expectedUpdatedAt is older than the stored flow', async () => {
    const existing = {
      ownerId: 'owner-1',
      name: 'Flow',
      description: 'Description',
      triggerConfig: undefined,
      settings: { recursionLimit: 25, maxParallelism: 5 },
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['workspace-1'],
      updatedAt: new Date('2025-01-01T00:00:10.000Z'),
      save: jest.fn(),
    };
    const flowModel = {
      findById: jest.fn().mockResolvedValue(existing),
    };
    const validatorService = { validate: jest.fn() };

    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
      {} as any,
    );

    await expect(service.update('507f1f77bcf86cd799439011', 'owner-1', {
      expectedUpdatedAt: '2025-01-01T00:00:00.000Z',
    } as any)).rejects.toBeInstanceOf(ConflictException);

    expect(existing.save).not.toHaveBeenCalled();
  });

  it('allows suggestion saves when expectedUpdatedAt matches the stored flow', async () => {
    const updatedAt = new Date('2025-01-01T00:00:10.000Z');
    const existing = {
      ownerId: 'owner-1',
      name: 'Flow',
      description: 'Description',
      triggerConfig: undefined,
      settings: { recursionLimit: 25, maxParallelism: 5 },
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['workspace-1'],
      updatedAt,
      save: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: '507f1f77bcf86cd799439011',
          ownerId: 'owner-1',
          schemaVersion: 1,
          name: 'Flow',
          description: 'Description',
          settings: { recursionLimit: 25, maxParallelism: 5 },
          nodes: [],
          controlEdges: [],
          dataBindings: [],
          workspaces: ['workspace-1'],
          updatedAt,
          createdAt: updatedAt,
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
      {} as any,
    );

    await expect(service.update('507f1f77bcf86cd799439011', 'owner-1', {
      expectedUpdatedAt: '2025-01-01T00:00:10.000Z',
      clientMutationId: 'intent-abc123',
      name: 'Flow',
    } as any)).resolves.toBeTruthy();

    expect(existing.save).toHaveBeenCalled();
  });

  it('validates updateNodesAndEdges before saving AI-generated changes', async () => {
    const existing = {
      nodes: [{ id: 'task-1' }],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['workspace-1'],
      save: jest.fn().mockResolvedValue({
        toJSON: () => ({ id: 'flow-1', nodes: [{ id: 'task-1' }], controlEdges: [], dataBindings: [], workspaces: ['workspace-1'] }),
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
      {} as any,
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
      { allowDraftRouters: true },
    );
  });

  it('normalizes legacy workspaces during updateNodesAndEdges', async () => {
    const existing = {
      nodes: [{ id: 'task-1' }],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['workspace-1', 'workspace-2'],
      save: jest.fn().mockResolvedValue({
        toJSON: () => ({ id: 'flow-1', nodes: [{ id: 'task-1' }], controlEdges: [], dataBindings: [], workspaces: ['workspace-1'] }),
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
      {} as any,
    );

    const result = await service.updateNodesAndEdges('flow-1', {
      nodes: [{ id: 'task-1' }],
    });

    expect(existing.workspaces).toEqual(['workspace-1']);
    expect(result.workspaces).toEqual(['workspace-1']);
  });

  it('normalizes workspaces to a single default workspace on createWithNodesAndEdges', async () => {
    const savedFlow = {
      toJSON: jest.fn().mockReturnValue({
        id: 'flow-1',
        ownerId: 'owner-1',
        schemaVersion: 1,
        name: 'Flow',
        description: 'Description',
        settings: { recursionLimit: 25, maxParallelism: 5 },
        nodes: [],
        controlEdges: [],
        dataBindings: [],
        workspaces: ['workspace-1'],
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
      {} as any,
    );

    const result = await service.createWithNodesAndEdges(
      'owner-1',
      'Flow',
      'Description',
      [],
      [],
      [],
      ['workspace-1', 'workspace-2'],
    );

    expect(flowModel).toHaveBeenCalledWith(expect.objectContaining({
      workspaces: ['workspace-1'],
    }));
    expect(result.workspaces).toEqual(['workspace-1']);
  });

  it('rejects createWithNodesAndEdges when no workspace is selected', async () => {
    const flowModel = jest.fn();
    const validatorService = { validate: jest.fn() };
    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
      {} as any,
    );

    await expect(service.createWithNodesAndEdges(
      'owner-1',
      'Flow',
      'Description',
      [],
      [],
      [],
      [],
    )).rejects.toBeInstanceOf(BadRequestException);

    expect(flowModel).not.toHaveBeenCalled();
  });

  it('preserves the default workspace on clone', async () => {
    const savedFlow = {
      toJSON: jest.fn().mockReturnValue({
        id: 'flow-clone',
        ownerId: 'owner-1',
        schemaVersion: 1,
        name: 'Flow (copy)',
        description: 'Description',
        settings: { recursionLimit: 25, maxParallelism: 5 },
        nodes: [],
        controlEdges: [],
        dataBindings: [],
        workspaces: ['workspace-1'],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    const existing = {
      ownerId: 'owner-1',
      schemaVersion: 1,
      name: 'Flow',
      description: 'Description',
      triggerConfig: undefined,
      settings: { recursionLimit: 25, maxParallelism: 5 },
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['workspace-1', 'workspace-2'],
    };
    const flowModel: any = jest.fn().mockImplementation((doc) => ({
      ...doc,
      save: jest.fn().mockResolvedValue(savedFlow),
    }));
    flowModel.findById = jest.fn().mockResolvedValue(existing);
    const validatorService = { validate: jest.fn() };
    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
      {} as any,
    );

    const result = await service.clone('507f1f77bcf86cd799439011', 'owner-1');

    expect(flowModel).toHaveBeenCalledWith(expect.objectContaining({
      workspaces: ['workspace-1'],
    }));
    expect(result.workspaces).toEqual(['workspace-1']);
  });

  it('clones legacy playbooks without a workspace selection', async () => {
    const savedFlow = {
      toJSON: jest.fn().mockReturnValue({
        id: 'clone-1',
        workspaces: [],
      }),
    };
    const flowModel: any = jest.fn().mockImplementation((doc) => ({
      ...doc,
      save: jest.fn().mockResolvedValue(savedFlow),
    }));
    flowModel.findById = jest.fn().mockResolvedValue({
      ownerId: 'owner-1',
      schemaVersion: 1,
      name: 'Flow',
      description: 'Description',
      triggerConfig: undefined,
      settings: { recursionLimit: 25, maxParallelism: 5 },
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: [],
      designSettings: { inferenceModelId: 'model-1' },
      reflectionEnabled: true,
      advisorScoringMode: 'heuristic',
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 91,
      advisorAutopilotMaxTurns: 5,
    });
    const validatorService = { validate: jest.fn() };
    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      validatorService as any,
      {} as any,
    );

    const result = await service.clone('507f1f77bcf86cd799439011', 'owner-1');

    expect(flowModel).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Flow (copy)',
      workspaces: [],
      designSettings: { inferenceModelId: 'model-1' },
      reflectionEnabled: true,
      advisorScoringMode: 'heuristic',
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 91,
      advisorAutopilotMaxTurns: 5,
    }));
    expect(result.workspaces).toEqual([]);
  });
});
