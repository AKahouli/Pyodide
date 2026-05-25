import { PlaybookFlowDesignService } from './playbook-flow-design.service';

describe('PlaybookFlowDesignService', () => {
  it('uses the persisted node description when sending the existing playbook to design gRPC', async () => {
    const grpcService = {
      isAvailable: true,
      generatePlaybook: jest.fn().mockResolvedValue({ nodes: [], edges: [] }),
    };
    const playbookFlowService = {
      findById: jest.fn().mockResolvedValue({
        id: '507f1f77bcf86cd799439011',
        ownerId: '507f1f77bcf86cd799439012',
        nodes: [{
          id: 'node-1',
          label: 'Draft response',
          description: 'Draft a response using the customer context.',
          taskTemplateId: 'template-1',
          metadata: { assignedAgentId: 'agent-1' },
        }],
        controlEdges: [],
        dataBindings: [],
        workspaces: [],
        designSettings: {},
      }),
      updateNodesAndEdges: jest.fn().mockResolvedValue({ id: 'flow-1' }),
    };
    const designMessageModel = {
      create: jest.fn().mockResolvedValue({
        id: '507f1f77bcf86cd799439013',
        flowId: '507f1f77bcf86cd799439011',
        createdBy: '507f1f77bcf86cd799439012',
        userQuery: 'Improve it',
        aiSummary: 'No structural changes',
        snapshotBefore: { nodes: [], controlEdges: [], dataBindings: [] },
        status: 'completed',
        revertedFromMessageId: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
    };

    const service = new PlaybookFlowDesignService(
      designMessageModel as any,
      playbookFlowService as any,
      grpcService as any,
      { buildWorkspaceContexts: jest.fn().mockResolvedValue([]), resolveAgentBrainContexts: jest.fn().mockResolvedValue(undefined) } as any,
      { getPromptOverridesPayload: jest.fn().mockResolvedValue({}) } as any,
      {
        getAgentsForUser: jest.fn().mockResolvedValue([]),
        buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([]),
      } as any,
      { getHttpClient: jest.fn() } as any,
      { resolveInferenceModel: jest.fn().mockResolvedValue('model-1') } as any,
      { recordUsage: jest.fn() } as any,
      logger as any,
    );

    await service.designFlow('507f1f77bcf86cd799439012', '507f1f77bcf86cd799439011', 'Improve it');

    const request = grpcService.generatePlaybook.mock.calls[0][0];
    expect(request.existing_playbook.nodes[0]).toMatchObject({
      id: 'node-1',
      title: 'Draft response',
      description: 'Draft a response using the customer context.',
      assigned_agent_id: 'agent-1',
    });
  });

  it('persists generated agent assignments in metadata.assignedAgentId', async () => {
    const grpcService = {
      isAvailable: true,
      generatePlaybook: jest.fn().mockResolvedValue({
        nodes: [{
          id: 'node-1',
          kind: 'step',
          title: 'Draft response',
          description: 'Draft a response using the customer context.',
          assigned_agent_id: 'agent-1',
          input_ports: [],
          output_ports: [],
        }],
        edges: [],
      }),
    };
    const playbookFlowService = {
      createWithNodesAndEdges: jest.fn().mockResolvedValue({ id: 'flow-1' }),
    };
    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
    };

    const service = new PlaybookFlowDesignService(
      { create: jest.fn() } as any,
      playbookFlowService as any,
      grpcService as any,
      { buildWorkspaceContexts: jest.fn().mockResolvedValue([]), resolveAgentBrainContexts: jest.fn().mockResolvedValue(undefined) } as any,
      { getPromptOverridesPayload: jest.fn().mockResolvedValue({}) } as any,
      {
        getAgentsForUser: jest.fn().mockResolvedValue([]),
        buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([]),
      } as any,
      { getHttpClient: jest.fn() } as any,
      { resolveInferenceModel: jest.fn().mockResolvedValue('model-1') } as any,
      { recordUsage: jest.fn() } as any,
      logger as any,
    );

    await service.generateFlow('user-1', 'Flow name', 'Make a flow');

    const createdNodes = playbookFlowService.createWithNodesAndEdges.mock.calls[0][3];
    expect(createdNodes[0]).toMatchObject({
      label: 'Draft response',
      description: 'Draft a response using the customer context.',
      metadata: { assignedAgentId: 'agent-1' },
    });
    expect(createdNodes[0].modelId).toBeUndefined();
  });

  it('forwards saved source and target port ids when sending existing playbook edges to design gRPC', async () => {
    const grpcService = {
      isAvailable: true,
      generatePlaybook: jest.fn().mockResolvedValue({ nodes: [], edges: [] }),
    };
    const playbookFlowService = {
      findById: jest.fn().mockResolvedValue({
        id: '507f1f77bcf86cd799439011',
        ownerId: '507f1f77bcf86cd799439012',
        nodes: [],
        controlEdges: [{
          id: 'edge-1',
          kind: 'sequential',
          source: 'extract-step',
          target: 'summarize-step',
          sourceOutputPortId: 'text',
          targetInputPortId: 'input',
        }],
        dataBindings: [],
        workspaces: [],
        designSettings: {},
      }),
      updateNodesAndEdges: jest.fn().mockResolvedValue({ id: 'flow-1' }),
    };
    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
    };

    const service = new PlaybookFlowDesignService(
      { create: jest.fn().mockResolvedValue({ id: '507f1f77bcf86cd799439013', flowId: '507f1f77bcf86cd799439011', createdBy: '507f1f77bcf86cd799439012', userQuery: 'Improve it', aiSummary: '', snapshotBefore: { nodes: [], controlEdges: [], dataBindings: [] }, status: 'completed', revertedFromMessageId: null, error: null, createdAt: new Date(), updatedAt: new Date() }) } as any,
      playbookFlowService as any,
      grpcService as any,
      { buildWorkspaceContexts: jest.fn().mockResolvedValue([]), resolveAgentBrainContexts: jest.fn().mockResolvedValue(undefined) } as any,
      { getPromptOverridesPayload: jest.fn().mockResolvedValue({}) } as any,
      {
        getAgentsForUser: jest.fn().mockResolvedValue([]),
        buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([]),
      } as any,
      { getHttpClient: jest.fn() } as any,
      { resolveInferenceModel: jest.fn().mockResolvedValue('model-1') } as any,
      { recordUsage: jest.fn() } as any,
      logger as any,
    );

    await service.designFlow('507f1f77bcf86cd799439012', '507f1f77bcf86cd799439011', 'Improve it');

    const request = grpcService.generatePlaybook.mock.calls[0][0];
    expect(request.existing_playbook.edges).toEqual([{
      source_id: 'extract-step',
      target_id: 'summarize-step',
      source_output_port_id: 'text',
      target_input_port_id: 'input',
    }]);
  });

  it('preserves existing data bindings when the design response does not replace them', async () => {
    const grpcService = {
      isAvailable: true,
      generatePlaybook: jest.fn().mockResolvedValue({
        nodes: [{ id: 'node-1', kind: 'step', title: 'Task', input_ports: [], output_ports: [] }],
        edges: [],
      }),
    };
    const existingBindings = [{
      id: 'binding-1',
      targetNode: 'node-1',
      targetPort: 'prompt',
      sourceKind: 'constant',
      constantValue: { text: 'hello' },
    }];
    const playbookFlowService = {
      findById: jest.fn().mockResolvedValue({
        id: '507f1f77bcf86cd799439011',
        ownerId: '507f1f77bcf86cd799439012',
        nodes: [],
        controlEdges: [],
        dataBindings: existingBindings,
        workspaces: [],
        designSettings: {},
      }),
      updateNodesAndEdges: jest.fn().mockResolvedValue({ id: 'flow-1' }),
    };
    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
    };

    const service = new PlaybookFlowDesignService(
      { create: jest.fn().mockResolvedValue({ id: '507f1f77bcf86cd799439013', flowId: '507f1f77bcf86cd799439011', createdBy: '507f1f77bcf86cd799439012', userQuery: 'Improve it', aiSummary: '', snapshotBefore: { nodes: [], controlEdges: [], dataBindings: [] }, status: 'completed', revertedFromMessageId: null, error: null, createdAt: new Date(), updatedAt: new Date() }) } as any,
      playbookFlowService as any,
      grpcService as any,
      { buildWorkspaceContexts: jest.fn().mockResolvedValue([]), resolveAgentBrainContexts: jest.fn().mockResolvedValue(undefined) } as any,
      { getPromptOverridesPayload: jest.fn().mockResolvedValue({}) } as any,
      {
        getAgentsForUser: jest.fn().mockResolvedValue([]),
        buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([]),
      } as any,
      { getHttpClient: jest.fn() } as any,
      { resolveInferenceModel: jest.fn().mockResolvedValue('model-1') } as any,
      { recordUsage: jest.fn() } as any,
      logger as any,
    );

    await service.designFlow('507f1f77bcf86cd799439012', '507f1f77bcf86cd799439011', 'Improve it');

    expect(playbookFlowService.updateNodesAndEdges).toHaveBeenCalledWith('507f1f77bcf86cd799439011', expect.objectContaining({
      dataBindings: existingBindings,
    }));
  });
});
