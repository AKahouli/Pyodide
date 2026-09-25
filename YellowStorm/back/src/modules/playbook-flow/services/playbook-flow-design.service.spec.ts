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

const messageRecord = (overrides: Record<string, unknown> = {}) => ({
  id: MESSAGE_ID,
  flowId: FLOW_ID,
  createdBy: USER_ID,
  userQuery: 'Improve it',
  aiSummary: '',
  snapshotBefore: { nodes: [], controlEdges: [], dataBindings: [] },
  status: 'completed',
  revertedFromMessageId: null,
  error: null,
  createdAt: new Date('2026-06-22T08:00:00Z'),
  updatedAt: new Date('2026-06-22T08:00:00Z'),
  ...overrides,
});

function buildService(designMessages: Record<string, jest.Mock>, playbookFlowService?: Record<string, jest.Mock>) {
  return new PlaybookFlowDesignService(
    designMessages as any,
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
    const designMessages = {
      create: jest.fn().mockResolvedValue(messageRecord({ aiSummary: 'No structural changes' })),
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
      designMessages as any,
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

    const result = await service.designFlow('507f1f77bcf86cd799439012', '507f1f77bcf86cd799439011', 'Improve it');

    const request = grpcService.generatePlaybook.mock.calls[0][0];
    expect(request.existing_playbook.nodes[0]).toMatchObject({
      id: 'node-1',
      title: 'Draft response',
      description: 'Draft a response using the customer context.',
      assigned_agent_id: 'agent-1',
    });
    expect(designMessages.create).toHaveBeenCalledWith(expect.objectContaining({
      flowId: FLOW_ID,
      createdBy: USER_ID,
      userQuery: 'Improve it',
      aiSummary: 'No structural changes',
      status: 'completed',
      error: null,
      snapshotBefore: expect.objectContaining({ nodes: [expect.objectContaining({ id: 'node-1' })] }),
    }));
    expect(result.message).toEqual(expect.objectContaining({
      id: MESSAGE_ID, flowId: FLOW_ID, playbookId: FLOW_ID, createdAt: '2026-06-22T08:00:00.000Z', revertedFromMessageId: null,
    }));
  });

  it('records a failed design turn when the design service fails', async () => {
    const create = jest.fn().mockImplementation(async (payload) => messageRecord(payload));
    const service = new PlaybookFlowDesignService(
      { create } as any,
      { findById: jest.fn().mockResolvedValue({ id: FLOW_ID, ownerId: USER_ID, nodes: [{ id: 'node-1' }], controlEdges: [], dataBindings: [], workspaces: [] }) } as any,
      { isAvailable: true, generatePlaybook: jest.fn().mockRejectedValue(new Error('model timeout')) } as any,
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

    const result = await service.designFlow(USER_ID, FLOW_ID, 'Improve it');

    expect(result.flow).toBeNull();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      flowId: FLOW_ID, createdBy: USER_ID, aiSummary: '', status: 'failed', error: 'model timeout',
      snapshotBefore: { nodes: [{ id: 'node-1' }], controlEdges: [], dataBindings: [] },
    }));
    expect(result.message).toEqual(expect.objectContaining({ status: 'failed', error: 'model timeout' }));
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

  it('passes uniquely inferred generated data bindings to flow creation', async () => {
    const grpcService = {
      isAvailable: true,
      generatePlaybook: jest.fn().mockResolvedValue({
        nodes: [
          { id: 'search', output_ports: [{ id: 'results', artifact_kind: 'data' }] },
          { id: 'summarize', input_ports: [{ id: 'search-results', artifact_kind: 'data', required: true }] },
        ],
        edges: [{ source_id: 'search', target_id: 'summarize' }],
      }),
    };
    const playbookFlowService = {
      createWithNodesAndEdges: jest.fn().mockResolvedValue({ id: 'flow-1' }),
    };
    const service = new PlaybookFlowDesignService(
      { create: jest.fn() } as any,
      playbookFlowService as any,
      grpcService as any,
      { buildWorkspaceContexts: jest.fn().mockResolvedValue([]), resolveAgentBrainContexts: jest.fn() } as any,
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

    await service.generateFlow(USER_ID, 'Flow name', 'Make a flow');

    expect(playbookFlowService.createWithNodesAndEdges.mock.calls[0][5]).toEqual([
      expect.objectContaining({
        sourceNode: 'search', sourcePort: 'results',
        targetNode: 'summarize', targetPort: 'search-results',
      }),
    ]);
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

  it('preserves unrelated existing data bindings when design generates a new binding', async () => {
    const grpcService = {
      isAvailable: true,
      generatePlaybook: jest.fn().mockResolvedValue({
        nodes: [
          {
            id: 'node-1', kind: 'step', title: 'Task',
            input_ports: [{ id: 'prompt', artifact_kind: 'text', required: false }],
            output_ports: [{ id: 'output', artifact_kind: 'data' }],
          },
          {
            id: 'node-2', kind: 'step', title: 'Summarize',
            input_ports: [{ id: 'results', artifact_kind: 'data', required: true }],
            output_ports: [],
          },
        ],
        edges: [{ source_id: 'node-1', target_id: 'node-2' }],
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
      dataBindings: [
        ...existingBindings,
        expect.objectContaining({
          sourceNode: 'node-1', sourcePort: 'output',
          targetNode: 'node-2', targetPort: 'results',
        }),
      ],
    }));
  });

  it('replaces only an existing binding that targets the generated input', () => {
    const result = designResultApplier.applyToSnapshot({
      nodes: [
        { id: 'source', output_ports: [{ id: 'output', artifact_kind: 'data' }] },
        { id: 'target', input_ports: [{ id: 'input', artifact_kind: 'data', required: true }] },
      ],
      edges: [{ source_id: 'source', target_id: 'target' }],
    }, {
      dataBindings: [
        { id: 'old-target', targetNode: 'target', targetPort: 'input', sourceKind: 'constant', constantValue: 'old' } as any,
        { id: 'unrelated', targetNode: 'source', targetPort: 'prompt', sourceKind: 'constant', constantValue: 'keep' } as any,
      ],
    });

    expect(result.dataBindings).toEqual([
      expect.objectContaining({ id: 'unrelated' }),
      expect.objectContaining({
        sourceKind: 'node-output', sourceNode: 'source', sourcePort: 'output',
        targetNode: 'target', targetPort: 'input',
      }),
    ]);
  });

  it('preserves colon-containing target tuples that do not exactly match', () => {
    const result = designResultApplier.applyToSnapshot({
      nodes: [
        { id: 'source', output_ports: [{ id: 'output', artifact_kind: 'data' }] },
        { id: 'target:a', input_ports: [{ id: 'input', artifact_kind: 'data', required: true }] },
      ],
      edges: [{ source_id: 'source', target_id: 'target:a' }],
    }, {
      dataBindings: [
        { id: 'unrelated', targetNode: 'target', targetPort: 'a:input', sourceKind: 'constant', constantValue: 'keep' } as any,
      ],
    });

    expect(result.dataBindings).toEqual([
      expect.objectContaining({ id: 'unrelated' }),
      expect.objectContaining({ targetNode: 'target:a', targetPort: 'input' }),
    ]);
  });

  it('loads only the current user design messages for the playbook', async () => {
    const listForUser = jest.fn().mockResolvedValue([messageRecord()]);
    const service = buildService({ listForUser });

    await expect(service.getDesignMessages(FLOW_ID, USER_ID)).resolves.toEqual([{
      id: MESSAGE_ID,
      flowId: FLOW_ID,
      playbookId: FLOW_ID,
      userQuery: 'Improve it',
      aiSummary: '',
      snapshotBefore: { nodes: [], controlEdges: [], dataBindings: [] },
      status: 'completed',
      revertedFromMessageId: null,
      error: null,
      createdAt: '2026-06-22T08:00:00.000Z',
      updatedAt: '2026-06-22T08:00:00.000Z',
    }]);
    expect(listForUser).toHaveBeenCalledWith(FLOW_ID, USER_ID);
  });

  it('does not list another user design messages', async () => {
    const listForUser = jest.fn();
    const service = buildService(
      { listForUser },
      { findById: jest.fn().mockResolvedValue({ id: FLOW_ID, ownerId: OTHER_USER_ID }) },
    );

    await expect(service.getDesignMessages(FLOW_ID, USER_ID)).rejects.toThrow();
    expect(listForUser).not.toHaveBeenCalled();
  });

  it('appends a designer sidebar interaction with a current flow snapshot', async () => {
    const create = jest.fn().mockImplementation(async (payload) => messageRecord(payload));
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
      flowId: FLOW_ID,
      createdBy: USER_ID,
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
    const deleteForUser = jest.fn().mockResolvedValue(2);
    const service = buildService({ deleteForUser });

    const result = await service.clearDesignMessages(FLOW_ID, USER_ID);

    expect(result).toEqual({ deletedCount: 2 });
    expect(deleteForUser).toHaveBeenCalledWith(FLOW_ID, USER_ID);
  });

  it('does not clear another user design messages', async () => {
    const deleteForUser = jest.fn();
    const service = buildService(
      { deleteForUser },
      { findById: jest.fn().mockResolvedValue({ id: FLOW_ID, ownerId: OTHER_USER_ID }) },
    );

    await expect(service.clearDesignMessages(FLOW_ID, USER_ID)).rejects.toThrow();
    expect(deleteForUser).not.toHaveBeenCalled();
  });

  it('requires reverted design messages to belong to the current user', async () => {
    const findForUser = jest.fn().mockResolvedValue(null);
    const service = buildService({ findForUser });

    await expect(service.revertToSnapshot(FLOW_ID, MESSAGE_ID, USER_ID)).rejects.toThrow('Design message not found');

    expect(findForUser).toHaveBeenCalledWith(MESSAGE_ID, FLOW_ID, USER_ID);
  });

  it('rejects a malformed design message id', async () => {
    const findForUser = jest.fn();
    const service = buildService({ findForUser });

    await expect(service.revertToSnapshot(FLOW_ID, 'not-a-message', USER_ID)).rejects.toThrow('Invalid message ID');
    expect(findForUser).not.toHaveBeenCalled();
  });

  it('restores the message snapshot and records the revert with the current graph', async () => {
    const snapshot = { nodes: [{ id: 'old-node' }], controlEdges: [{ id: 'old-edge' }], dataBindings: [] };
    const findForUser = jest.fn().mockResolvedValue(messageRecord({ snapshotBefore: snapshot }));
    const create = jest.fn().mockImplementation(async (payload) => messageRecord({ id: '507f1f77bcf86cd799439015', ...payload }));
    const updateNodesAndEdges = jest.fn().mockResolvedValue({ id: FLOW_ID });
    const service = buildService(
      { findForUser, create },
      {
        findById: jest.fn().mockResolvedValue({ id: FLOW_ID, ownerId: USER_ID, nodes: [{ id: 'new-node' }], controlEdges: [], dataBindings: [] }),
        updateNodesAndEdges,
      },
    );

    const result = await service.revertToSnapshot(FLOW_ID, MESSAGE_ID, USER_ID);

    expect(updateNodesAndEdges).toHaveBeenCalledWith(FLOW_ID, snapshot);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      flowId: FLOW_ID,
      createdBy: USER_ID,
      userQuery: `Reverted to snapshot from ${MESSAGE_ID}`,
      status: 'reverted',
      revertedFromMessageId: MESSAGE_ID,
      snapshotBefore: { nodes: [{ id: 'new-node' }], controlEdges: [], dataBindings: [] },
    }));
    expect(result.message).toEqual(expect.objectContaining({ status: 'reverted', revertedFromMessageId: MESSAGE_ID }));
  });
});
