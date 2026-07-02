import { PlaybookFlowDesignService } from './playbook-flow-design.service';
import { PlaybookDesignRequestBuilderService } from '../design/playbook-design-request-builder.service';
import { PlaybookDesignResultApplierService } from '../design/playbook-design-result-applier.service';

const designSummaryService = { summarizeStructuralChanges: jest.fn().mockReturnValue('') };
const designRequestBuilder = new PlaybookDesignRequestBuilderService();
const designResultApplier = new PlaybookDesignResultApplierService();
const USER_ID = '507f1f77bcf86cd799439012';
const OTHER_USER_ID = '507f1f77bcf86cd799439014';
const FLOW_ID = '507f1f77bcf86cd799439011';
const MESSAGE_ID = '507f1f77bcf86cd799439013';

function buildService(designMessageModel: Record<string, jest.Mock>, playbookFlowService?: Record<string, jest.Mock>) {
  return new PlaybookFlowDesignService(
    designMessageModel as any,
    (playbookFlowService || { findById: jest.fn().mockResolvedValue({ id: FLOW_ID, ownerId: USER_ID }) }) as any,
    { isAvailable: true, generatePlaybook: jest.fn() } as any,
    { buildWorkspaceContexts: jest.fn().mockResolvedValue([]), resolveAgentBrainContexts: jest.fn().mockResolvedValue(undefined) } as any,
    { getPromptOverridesPayload: jest.fn().mockResolvedValue({}) } as any,
    { getAgentsForUser: jest.fn().mockResolvedValue([]), buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([]) } as any,
    { getHttpClient: jest.fn() } as any,
    { resolveInferenceModel: jest.fn().mockResolvedValue('model-1') } as any,
    { recordUsage: jest.fn() } as any,
    designSummaryService as any,
    designRequestBuilder as any,
    designResultApplier as any,
    { setContext: jest.fn(), warn: jest.fn() } as any,
  );
}

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

    const designSummaryService = {
      summarizeStructuralChanges: jest.fn().mockReturnValue('No structural changes'),
    };
    const designRequestBuilder = new PlaybookDesignRequestBuilderService();
    const designResultApplier = new PlaybookDesignResultApplierService();

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
      designSummaryService as any,
      designRequestBuilder as any,
      designResultApplier as any,
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

    const designSummaryService = {
      summarizeStructuralChanges: jest.fn().mockReturnValue('No structural changes'),
    };
    const designRequestBuilder = {
      buildGenerateRequest: jest.fn().mockResolvedValue({}),
    };
    const designResultApplier = {
      applyToSnapshot: jest.fn().mockReturnValue({ nodes: [], controlEdges: [], dataBindings: [] }),
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
      designSummaryService as any,
      designRequestBuilder as any,
      designResultApplier as any,
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

    const designSummaryService = {
      summarizeStructuralChanges: jest.fn().mockReturnValue('No structural changes'),
    };
    const designRequestBuilder = new PlaybookDesignRequestBuilderService();
    const designResultApplier = new PlaybookDesignResultApplierService();

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
      designSummaryService as any,
      designRequestBuilder as any,
      designResultApplier as any,
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

    const designSummaryService = {
      summarizeStructuralChanges: jest.fn().mockReturnValue('No structural changes'),
    };
    const designRequestBuilder = new PlaybookDesignRequestBuilderService();
    const designResultApplier = new PlaybookDesignResultApplierService();

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
      designSummaryService as any,
      designRequestBuilder as any,
      designResultApplier as any,
      logger as any,
    );

    await service.designFlow('507f1f77bcf86cd799439012', '507f1f77bcf86cd799439011', 'Improve it');

    expect(playbookFlowService.updateNodesAndEdges).toHaveBeenCalledWith('507f1f77bcf86cd799439011', expect.objectContaining({
      dataBindings: existingBindings,
    }));
  });

  it('loads only the current user design messages for the playbook', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ lean });
    const find = jest.fn().mockReturnValue({ sort });
    const service = buildService({ find });

    await service.getDesignMessages(FLOW_ID, USER_ID);

    expect(find).toHaveBeenCalledWith({
      flowId: expect.objectContaining({ _bsontype: 'ObjectId' }),
      createdBy: expect.objectContaining({ _bsontype: 'ObjectId' }),
    });
    const filter = find.mock.calls[0][0];
    expect(filter.flowId.toString()).toBe(FLOW_ID);
    expect(filter.createdBy.toString()).toBe(USER_ID);
  });

  it('appends a designer sidebar interaction with a current flow snapshot', async () => {
    const create = jest.fn().mockImplementation((payload) => Promise.resolve({
      id: MESSAGE_ID,
      ...payload,
      revertedFromMessageId: null,
      createdAt: new Date('2026-06-22T08:00:00Z'),
      updatedAt: new Date('2026-06-22T08:00:00Z'),
    }));
    const service = buildService(
      { create },
      { findById: jest.fn().mockResolvedValue({
        id: FLOW_ID,
        ownerId: USER_ID,
        nodes: [{ id: 'node-1' }],
        controlEdges: [{ id: 'edge-1' }],
        dataBindings: [{ id: 'binding-1' }],
      }) },
    );

    const result = await service.appendDesignMessage(FLOW_ID, USER_ID, {
      userQuery: 'Add scoring',
      aiSummary: 'Assistant processed the request.',
    });

    expect(result).toEqual(expect.objectContaining({ userQuery: 'Add scoring', aiSummary: 'Assistant processed the request.' }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      userQuery: 'Add scoring',
      aiSummary: 'Assistant processed the request.',
      status: 'completed',
      error: null,
      snapshotBefore: {
        nodes: [{ id: 'node-1' }],
        controlEdges: [{ id: 'edge-1' }],
        dataBindings: [{ id: 'binding-1' }],
      },
    }));
  });

  it('rejects invalid append message statuses', async () => {
    const create = jest.fn();
    const service = buildService({ create });

    await expect(service.appendDesignMessage(FLOW_ID, USER_ID, {
      userQuery: 'Add scoring',
      aiSummary: 'Assistant processed the request.',
      status: 'reverted' as any,
    })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('clears only the current user design messages for the playbook', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ deletedCount: 2 });
    const service = buildService({ deleteMany });

    const result = await service.clearDesignMessages(FLOW_ID, USER_ID);

    expect(result).toEqual({ deletedCount: 2 });
    const filter = deleteMany.mock.calls[0][0];
    expect(filter.flowId.toString()).toBe(FLOW_ID);
    expect(filter.createdBy.toString()).toBe(USER_ID);
  });

  it('does not clear another user design messages', async () => {
    const deleteMany = jest.fn();
    const service = buildService(
      { deleteMany },
      { findById: jest.fn().mockResolvedValue({ id: FLOW_ID, ownerId: OTHER_USER_ID }) },
    );

    await expect(service.clearDesignMessages(FLOW_ID, USER_ID)).rejects.toThrow();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('requires reverted design messages to belong to the current user', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const service = buildService({ findOne });

    await expect(service.revertToSnapshot(FLOW_ID, MESSAGE_ID, USER_ID)).rejects.toThrow('Design message not found');

    const filter = findOne.mock.calls[0][0];
    expect(filter._id.toString()).toBe(MESSAGE_ID);
    expect(filter.flowId.toString()).toBe(FLOW_ID);
    expect(filter.createdBy.toString()).toBe(USER_ID);
  });
});
