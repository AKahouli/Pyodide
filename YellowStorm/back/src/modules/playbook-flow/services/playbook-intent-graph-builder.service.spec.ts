import { PlaybookIntentGraphBuilderService } from './playbook-intent-graph-builder.service';
import { PlaybookIntentGraphBindingResolverService } from './playbook-intent-graph-binding-resolver.service';
import type {
  IntentWorkflowValidationContext,
  PlaybookIntentSuggestion,
  PlaybookIntentWorkflowChange,
} from './playbook-flow-intent.service';
import type { FlowNodeTemplateResponse } from '../interfaces/playbook-flow-node-template.interface';
import type { PlaybookIntentBlueprint } from '../interfaces/playbook-flow-intent-blueprint.interface';
import type { PlaybookIntentDiagnostic } from '../interfaces/playbook-flow-intent-diagnostic.interface';

type Change = PlaybookIntentWorkflowChange;
type WorkflowPlan = Extract<PlaybookIntentSuggestion, { kind: 'workflow_plan' }>;
type CreateNodeChange = Extract<Change, { type: 'create_node' }>;
type CreateEdgeChange = Extract<Change, { type: 'create_edge' }>;
type CreateBindingChange = Extract<Change, { type: 'create_data_binding' }>;

function makeContext(overrides: Partial<{
  existingTaskIds: string[];
  inputPortsByTaskId: Array<[string, Array<[string, string]>]>;
  outputPortsByTaskId: Array<[string, Array<[string, string]>]>;
}> = {}): IntentWorkflowValidationContext {
  return {
    existingTaskIds: new Set(overrides.existingTaskIds || []),
    existingTaskTitles: new Map(),
    existingTaskAgents: new Map(),
    inputPortsByTaskId: new Map((overrides.inputPortsByTaskId || []).map(([k, v]) => [k, new Map(v)])),
    outputPortsByTaskId: new Map((overrides.outputPortsByTaskId || []).map(([k, v]) => [k, new Map(v)])),
    existingBindingTargets: new Set<string>(),
  };
}

const DEFAULT_LIMITS = {
  maxWorkflowPlanChanges: 50,
  maxInputPorts: 4,
  maxOutputPorts: 4,
  maxIteratorBodySteps: 12,
  maxIteratorBodyEdges: 50,
};

function makeTemplate(overrides: Partial<FlowNodeTemplateResponse>): FlowNodeTemplateResponse {
  return {
    id: 'tpl-1',
    key: 'synthesis-step',
    nodeType: 'agent',
    title: 'Synthesis step',
    description: '',
    icon: '',
    color: '',
    category: 'general',
    inputPorts: [{ id: 'context', name: 'Context', artifactKind: 'text', required: false }],
    outputPorts: [{ id: 'draft', name: 'Draft', artifactKind: 'document' }],
    promptTemplate: '',
    recommendedAgentTypeSlug: 'synthesis-agent',
    requiredToolNames: [],
    assignedAgentId: null,
    selectedAction: null,
    iteratorConfig: null,
    routerConfig: null,
    humanApprovalConfig: null,
    retryPolicy: null,
    modelId: null,
    enabled: true,
    version: 1,
    isBuiltIn: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function genericTemplate(overrides: Partial<FlowNodeTemplateResponse> = {}): FlowNodeTemplateResponse {
  return makeTemplate({
    id: 'tpl-generic',
    key: 'generic.agent_step',
    title: 'Generic agent step',
    inputPorts: [],
    outputPorts: [],
    recommendedAgentTypeSlug: null,
    ...overrides,
  });
}

const ITERATOR_CONFIG = { source: 'items', mode: 'item' as const };

describe('PlaybookIntentGraphBuilderService', () => {
  let service: PlaybookIntentGraphBuilderService;
  let resolver: PlaybookIntentGraphBindingResolverService;

  beforeEach(() => {
    resolver = new PlaybookIntentGraphBindingResolverService();
    service = new PlaybookIntentGraphBuilderService(resolver);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((resolver as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((resolver as any).logger, 'error').mockImplementation(() => undefined);
  });

  it('produces a stable workflow_plan from a linear blueprint across repeated runs', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Linear research',
      summary: 'Linear two-step research',
      nodes: [
        { ref: 'collect', label: 'Collect', purpose: 'Gather', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
        { ref: 'draft', label: 'Draft', purpose: 'Write', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'data', artifactKind: 'data', required: true }],
          outputPorts: [{ id: 'report', artifactKind: 'document' }] },
      ],
      links: [{ sourceRef: 'collect', targetRef: 'draft', sourceOutputPortId: 'data', targetInputPortId: 'data' }],
      bindings: [{ targetRef: 'draft', targetPort: 'data', sourceKind: 'node-output', sourceRef: 'collect', sourcePort: 'data' }],
    };
    const options = {
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate()],
      selectedNodeId: null,
    };
    const first = service.build(options);
    const second = service.build(options);
    expect(first.suggestion.changes.map((c: Change) => JSON.stringify(c))).toEqual(
      second.suggestion.changes.map((c: Change) => JSON.stringify(c)),
    );
  });

  it('builds a create_node, a create_edge, and a synthesized create_data_binding for port-compatible nodes', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Research',
      summary: 'Linear',
      nodes: [
        { ref: 'collect', label: 'Collect', purpose: 'Gather', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
        { ref: 'draft', label: 'Draft', purpose: 'Write', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'data', artifactKind: 'data', required: true }] },
      ],
      links: [{ sourceRef: 'collect', targetRef: 'draft', sourceOutputPortId: 'data', targetInputPortId: 'data' }],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate()],
      selectedNodeId: null,
    });

    expect(suggestion.changes.filter((c: Change) => c.type === 'create_node')).toHaveLength(2);
    expect(suggestion.changes.filter((c: Change) => c.type === 'create_edge')).toHaveLength(1);
    expect(suggestion.changes.filter((c: Change) => c.type === 'create_data_binding')).toHaveLength(1);
    expect(suggestion.impact.nodesToCreate).toBe(2);
    expect(suggestion.impact.edgesToCreate).toBe(1);
  });

  it('resolves connector and skill refs into drag-drop equivalent bindings', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Use catalog',
      summary: '',
      nodes: [{
        ref: 'search_files',
        label: 'Search files',
        purpose: 'Find documents',
        nodeTemplateKey: 'generic.agent_step',
        connectorRefs: [{ connectorSlug: 'google-drive', actionKey: 'search' }],
        skillRefs: [{ skillSlug: 'summarize-documents' }],
      }],
      links: [],
      bindings: [],
    };

    const result = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate()],
      designCatalog: {
        connectors: [{ id: 'connector-1', slug: 'google-drive', name: 'Google Drive' }],
        connectorActions: [{ connectorSlug: 'google-drive', actionKey: 'search' }],
        skills: [{ id: 'skill-1', slug: 'summarize-documents', name: 'Summarize Documents' }],
      },
      selectedNodeId: null,
    });

    const createChange = result.suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node');
    expect(createChange?.task.toolBindings).toEqual([{
      id: 'tool-search-files-google-drive',
      connectorId: 'connector-1',
      connectorSlug: 'google-drive',
      connectorName: 'Google Drive',
      actions: [{ actionKey: 'search', isEnabled: true }],
      isEnabled: true,
    }]);
    expect(createChange?.task.skillBindings).toEqual([{
      id: 'skill-search-files-summarize-documents',
      skillId: 'skill-1',
      skillSlug: 'summarize-documents',
      skillName: 'Summarize Documents',
      isEnabled: true,
    }]);
  });

  it('groups multiple connector actions into one drag-drop equivalent binding per connector', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Use catalog',
      summary: '',
      nodes: [{
        ref: 'search_files',
        label: 'Search files',
        purpose: 'Find documents',
        nodeTemplateKey: 'generic.agent_step',
        connectorRefs: [
          { connectorSlug: 'google-drive', actionKey: 'search' },
          { connectorSlug: 'google-drive', actionKey: 'read' },
        ],
      }],
      links: [],
      bindings: [],
    };

    const result = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate()],
      designCatalog: {
        connectors: [{ id: 'connector-1', slug: 'google-drive', name: 'Google Drive' }],
        connectorActions: [
          { connectorSlug: 'google-drive', actionKey: 'search' },
          { connectorSlug: 'google-drive', actionKey: 'read' },
        ],
        skills: [],
      },
      selectedNodeId: null,
    });

    const createChange = result.suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node');
    expect(createChange?.task.toolBindings).toEqual([expect.objectContaining({
      connectorId: 'connector-1',
      connectorSlug: 'google-drive',
      actions: [
        { actionKey: 'search', isEnabled: true },
        { actionKey: 'read', isEnabled: true },
      ],
    })]);
  });

  it('drops connector and skill refs that are not in the design catalog', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Use catalog',
      summary: '',
      nodes: [{
        ref: 'search_files',
        label: 'Search files',
        purpose: 'Find documents',
        nodeTemplateKey: 'generic.agent_step',
        connectorRefs: [
          { connectorSlug: 'missing-connector', actionKey: 'search' },
          { connectorSlug: 'google-drive', actionKey: 'missing' },
        ],
        skillRefs: [{ skillSlug: 'missing-skill' }],
      }],
      links: [],
      bindings: [],
    };

    const result = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate()],
      designCatalog: {
        connectors: [{ id: 'connector-1', slug: 'google-drive', name: 'Google Drive' }],
        connectorActions: [{ connectorSlug: 'google-drive', actionKey: 'search' }],
        skills: [],
      },
      selectedNodeId: null,
    });

    const createChange = result.suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node');
    expect(createChange?.task.toolBindings).toEqual([]);
    expect(createChange?.task.skillBindings).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'builder_connector_ref_unknown_slug',
      'builder_connector_ref_unknown_action',
      'builder_skill_ref_unknown_slug',
    ]));
  });

  it('preserves required flags from template input ports', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Template node',
      summary: '',
      nodes: [{ ref: 'draft', label: 'Draft', purpose: 'Write', nodeTemplateKey: 'document' }],
      links: [],
      bindings: [{ targetRef: 'draft', targetPort: 'input-context', sourceKind: 'constant', constantValue: { kind: 'workspace', id: 'ws-1', workspaceId: 'ws-1' } }],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [{
        key: 'document', nodeType: 'agent',
        inputPorts: [{ id: 'input-context', name: 'Context', artifactKind: 'text', required: true }],
        outputPorts: [], recommendedAgentTypeSlug: null, enabled: true,
      }],
      selectedNodeId: null,
    });

    const createChange = suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node');

    expect(createChange?.task.inputPorts?.[0]).toEqual(expect.objectContaining({ id: 'input-context', required: true }));
  });

  it('rejects edges with incompatible artifact kinds and logs an error', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Mismatch',
      summary: '',
      nodes: [
        { ref: 'src', label: 'Src', purpose: '', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'o', artifactKind: 'text' }] },
        { ref: 'dst', label: 'Dst', purpose: '', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'i', artifactKind: 'image' }] },
      ],
      links: [{ sourceRef: 'src', targetRef: 'dst', sourceOutputPortId: 'o', targetInputPortId: 'i' }],
    };

    const result = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate()],
      selectedNodeId: null,
    });

    expect(result.suggestion.changes.some((c: Change) => c.type === 'create_edge')).toBe(false);
    expect(result.suggestion.changes.some((c: Change) => c.type === 'create_data_binding')).toBe(false);
    expect(result.diagnostics.some((d: PlaybookIntentDiagnostic) => d.code === 'edge_artifact_mismatch' && d.severity === 'error')).toBe(true);
    expect((resolver as any).logger.error).toHaveBeenCalledWith(expect.stringContaining('rule=edge_artifact_mismatch'));
  });

  it('emits an iterator node with an isolated body that does not leak edges to the top level', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Iterate',
      summary: '',
      nodes: [{
        ref: 'loop', label: 'Loop', purpose: 'Iterate', nodeTemplateKey: 'iterator.template',
        iteratorBody: {
          steps: [
            { ref: 's1', title: 'Step 1', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'text', artifactKind: 'text' }] },
            { ref: 's2', title: 'Step 2', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'text', artifactKind: 'text' }] },
          ],
          edges: [{ sourceRef: 's1', targetRef: 's2', sourceOutputPortId: 'text', targetInputPortId: 'text' }],
        },
      }],
      links: [],
      bindings: [],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate({ key: 'iterator.template', iteratorConfig: ITERATOR_CONFIG }), genericTemplate()],
      selectedNodeId: null,
    });

    const createChange = suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node');
    expect(createChange).toBeDefined();
    if (!createChange) return;
    expect(createChange.task.iteratorBody?.steps).toHaveLength(2);
    expect(createChange.task.iteratorBody?.edges).toHaveLength(1);
    expect(suggestion.changes.some((c: Change) => c.type === 'create_edge')).toBe(false);
  });

  it('keeps constant document bindings and forwards workspace/document metadata', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Constant',
      summary: '',
      nodes: [{ ref: 'dst', label: 'Dst', purpose: '', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'inp', artifactKind: 'document' }] }],
      links: [],
      bindings: [{
        targetRef: 'dst', targetPort: 'inp', sourceKind: 'constant',
        constantValue: { kind: 'document', id: 'doc-1', workspaceId: 'ws-1', documentId: 'doc-1', label: 'Invoice', path: '/Finance' },
      }],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate()],
      selectedNodeId: null,
    });

    const binding = suggestion.changes.find((c: Change): c is CreateBindingChange => c.type === 'create_data_binding');
    expect(binding).toBeDefined();
    if (!binding || binding.sourceKind !== 'constant') return;
    expect(binding.constantValue).toEqual(expect.objectContaining({
      kind: 'document',
      id: 'doc-1',
      workspaceId: 'ws-1',
      documentId: 'doc-1',
    }));
  });

  it('drops iterator body when the selected template does not support it', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Mixed',
      summary: '',
      nodes: [
        { ref: 'loop', label: 'Loop', purpose: '', nodeTemplateKey: 'generic.agent_step', iteratorBody: { steps: [{ ref: 's1', title: 'S1', nodeTemplateKey: 'generic.agent_step' }], edges: [] } },
      ],
      links: [],
      bindings: [],
    };

    const result = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate()],
      selectedNodeId: null,
    });

    const nodes: CreateNodeChange[] = result.suggestion.changes.filter((c: Change): c is CreateNodeChange => c.type === 'create_node');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].task.iteratorBody).toBeUndefined();
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === 'builder_iterator_body_not_supported_by_template')).toMatchObject({ stage: 'graph_builder', severity: 'warning' });
  });

  it('uses bound node template ports when no explicit ports are provided', () => {
    const template = makeTemplate({ inputPorts: [{ id: 'context', name: 'Context', artifactKind: 'text', required: false }],
      outputPorts: [{ id: 'draft', name: 'Draft', artifactKind: 'document' }] });
    const blueprint: PlaybookIntentBlueprint = {
      title: 't',
      summary: '',
      nodes: [
        { ref: 'step', label: 'Step', purpose: '', nodeTemplateKey: 'synthesis-step' },
        { ref: 'publish', label: 'Publish', purpose: '', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'draft', artifactKind: 'document' }] },
      ],
      links: [],
      bindings: [
        { targetRef: 'step', targetPort: 'context', sourceKind: 'constant', constantValue: { kind: 'workspace', id: 'ws-1', workspaceId: 'ws-1' } },
        { targetRef: 'publish', targetPort: 'draft', sourceKind: 'node-output', sourceRef: 'step', sourcePort: 'draft' },
      ],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [template, genericTemplate()],
      selectedNodeId: null,
    });

    const node = suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node' && c.nodeRef === 'step');
    expect(node).toBeDefined();
    if (!node) return;
    expect(node.task.nodeTemplateKey).toBe('synthesis-step');
    expect(node.task.inputPorts?.map((p: { id: string }) => p.id)).toEqual(['context']);
    expect(node.task.outputPorts?.map((p: { id: string }) => p.id)).toEqual(['draft']);
  });

  it('keeps explicit blueprint ports and preserves referenced required template ports', () => {
    const template = makeTemplate({
      inputPorts: [{ id: 'context', name: 'Context', artifactKind: 'text', required: true }],
      outputPorts: [{ id: 'draft', name: 'Draft', artifactKind: 'document' }],
    });
    const blueprint: PlaybookIntentBlueprint = {
      title: 't',
      summary: '',
      nodes: [{
        ref: 'step', label: 'Step', purpose: '', nodeTemplateKey: 'synthesis-step',
        inputPorts: [{ id: 'custom', artifactKind: 'text', required: true }],
      }],
      links: [],
      bindings: [{
        targetRef: 'step',
        targetPort: 'context',
        sourceKind: 'constant',
        constantValue: { kind: 'workspace', id: 'ws-1', workspaceId: 'ws-1' },
      }],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [template],
      selectedNodeId: null,
    });

    const node = suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node');
    expect(node?.task.inputPorts?.map((p: { id: string }) => p.id)).toEqual(['context', 'custom']);
    expect(node?.task.outputPorts).toBeUndefined();
  });

  it('compiles router primitives into task config, output ports, and conditional edges without data bindings', () => {
    const blueprint: PlaybookIntentBlueprint = {
      version: 2,
      title: 'Route',
      summary: '',
      nodes: [
        {
          ref: 'classify',
          label: 'Classify',
          purpose: '',
          nodeTemplateKey: 'router.template',
          primitive: { kind: 'router', router: { outputLabels: ['approved', 'rejected'], defaultLabel: 'rejected' } },
        },
        { ref: 'approve', label: 'Approve', purpose: '', nodeTemplateKey: 'generic.agent_step' },
      ],
      links: [{ sourceRef: 'classify', targetRef: 'approve', kind: 'conditional', routerLabel: 'approved' }],
      bindings: [],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate({ key: 'router.template', nodeType: 'router' }), genericTemplate()],
      selectedNodeId: null,
    });

    const router = suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node' && c.nodeRef === 'classify');
    const edge = suggestion.changes.find((c: Change): c is CreateEdgeChange => c.type === 'create_edge');

    expect(router?.task.routerConfig).toEqual(expect.objectContaining({ outputLabels: ['approved', 'rejected'], defaultLabel: 'rejected' }));
    expect(router?.task.outputPorts?.map((port: { id: string }) => port.id)).toEqual(['approved', 'rejected']);
    expect(edge).toEqual(expect.objectContaining({ edgeKind: 'conditional', routerLabel: 'approved', sourceOutputPortId: 'approved' }));
    expect(suggestion.changes.some((c: Change) => c.type === 'create_data_binding')).toBe(false);
  });

  it('rejects conditional router edges with labels missing from the source router', () => {
    const blueprint: PlaybookIntentBlueprint = {
      version: 2,
      title: 'Bad route',
      summary: '',
      nodes: [
        {
          ref: 'classify',
          label: 'Classify',
          purpose: '',
          nodeTemplateKey: 'router.template',
          primitive: { kind: 'router', router: { outputLabels: ['approved'], defaultLabel: 'approved' } },
        },
        { ref: 'reject', label: 'Reject', purpose: '', nodeTemplateKey: 'generic.agent_step' },
      ],
      links: [{ sourceRef: 'classify', targetRef: 'reject', kind: 'conditional', routerLabel: 'rejected' }],
      bindings: [],
    };

    const result = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate({ key: 'router.template', nodeType: 'router' }), genericTemplate()],
      selectedNodeId: null,
    });

    expect(result.suggestion.changes.some((c: Change) => c.type === 'create_edge')).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'builder_conditional_edge_invalid_router_label', itemId: 'classify->reject' }),
    ]));
  });

  it('creates an edge for node-output bindings without requiring an explicit link', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Bound flow',
      summary: '',
      nodes: [
        { ref: 'collect', label: 'Collect', purpose: '', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
        { ref: 'draft', label: 'Draft', purpose: '', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'data', artifactKind: 'data' }] },
      ],
      links: [],
      bindings: [{ targetRef: 'draft', targetPort: 'data', sourceKind: 'node-output', sourceRef: 'collect', sourcePort: 'data' }],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate()],
      selectedNodeId: null,
    });

    const edge = suggestion.changes.find((c: Change): c is CreateEdgeChange => c.type === 'create_edge');
    expect(edge).toEqual(expect.objectContaining({
      sourceNodeRef: 'collect',
      targetNodeRef: 'draft',
      sourceOutputPortId: 'data',
      targetInputPortId: 'data',
    }));
    expect(suggestion.impact.edgesToCreate).toBe(1);
  });

  it('prunes iterator step template ports against the enclosing iterator body edges', () => {
    const template = makeTemplate({ inputPorts: [
      { id: 'bound', name: 'Bound', artifactKind: 'text', required: false },
      { id: 'unused', name: 'Unused', artifactKind: 'text', required: false },
    ], outputPorts: [
      { id: 'out', name: 'Out', artifactKind: 'text' },
      { id: 'extra', name: 'Extra', artifactKind: 'text' },
    ] });
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Iterate templates',
      summary: '',
      nodes: [{
        ref: 'loop', label: 'Loop', purpose: '', nodeTemplateKey: 'iterator.template',
        iteratorBody: {
          steps: [
            { ref: 's1', title: 'Step 1', nodeTemplateKey: 'synthesis-step' },
            { ref: 's2', title: 'Step 2', nodeTemplateKey: 'synthesis-step' },
          ],
          edges: [{ sourceRef: 's1', targetRef: 's2', sourceOutputPortId: 'out', targetInputPortId: 'bound' }],
        },
      }],
      links: [],
      bindings: [],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate({ key: 'iterator.template', iteratorConfig: ITERATOR_CONFIG }), template],
      selectedNodeId: null,
    });

    const node = suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node');
    const firstStep = node?.task.iteratorBody?.steps.find((step: { nodeRef: string }) => step.nodeRef === 's1');
    const secondStep = node?.task.iteratorBody?.steps.find((step: { nodeRef: string }) => step.nodeRef === 's2');
    expect(firstStep?.outputPorts?.map((port: { id: string }) => port.id)).toEqual(['out']);
    expect(firstStep?.inputPorts).toBeUndefined();
    expect(secondStep?.inputPorts?.map((port: { id: string }) => port.id)).toEqual(['bound']);
    expect(secondStep?.outputPorts).toBeUndefined();
  });

  it('rejects iterator body conditional edges with undeclared router labels', () => {
    const blueprint: PlaybookIntentBlueprint = {
      version: 2,
      title: 'Iterator router',
      summary: '',
      nodes: [{
        ref: 'loop', label: 'Loop', purpose: '', nodeTemplateKey: 'iterator.template',
        iteratorBody: {
          steps: [
            {
              ref: 'route_child',
              title: 'Route child',
              nodeTemplateKey: 'router.template',
              primitive: { kind: 'router', router: { outputLabels: ['yes'], defaultLabel: 'yes' } },
            },
            { ref: 'no_child', title: 'No child', nodeTemplateKey: 'generic.agent_step' },
          ],
          edges: [{ sourceRef: 'route_child', targetRef: 'no_child', kind: 'conditional', routerLabel: 'no' }],
        },
      }],
      links: [],
      bindings: [],
    };

    const result = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [
        genericTemplate({ key: 'iterator.template', iteratorConfig: ITERATOR_CONFIG }),
        genericTemplate({ key: 'router.template', nodeType: 'router' }),
        genericTemplate(),
      ],
      selectedNodeId: null,
    });

    const iterator = result.suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node' && c.nodeRef === 'loop');
    expect(iterator?.task.iteratorBody?.edges).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'builder_conditional_edge_invalid_router_label', itemId: 'loop.route_child->no_child' }),
    ]));
  });

  it('synthesizes iterator child router output ports from declared labels', () => {
    const blueprint: PlaybookIntentBlueprint = {
      version: 2,
      title: 'Iterator router outputs',
      summary: '',
      nodes: [{
        ref: 'loop', label: 'Loop', purpose: '', nodeTemplateKey: 'iterator.template',
        iteratorBody: {
          steps: [{
            ref: 'route_child',
            title: 'Route child',
            nodeTemplateKey: 'router.template',
            primitive: { kind: 'router', router: { outputLabels: ['yes', 'no'], defaultLabel: 'no' } },
          }],
          edges: [],
        },
      }],
      links: [],
      bindings: [],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [
        genericTemplate({ key: 'iterator.template', iteratorConfig: ITERATOR_CONFIG }),
        genericTemplate({ key: 'router.template', nodeType: 'router' }),
      ],
      selectedNodeId: null,
    });

    const iterator = suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node' && c.nodeRef === 'loop');
    const routeChild = iterator?.task.iteratorBody?.steps.find((step: { nodeRef: string }) => step.nodeRef === 'route_child');
    expect(routeChild?.outputPorts?.map((port: { id: string }) => port.id)).toEqual(['yes', 'no']);
  });

  it('targets iterator child inputs with scoped external links instead of collapsing onto parent items', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Adapt CVs',
      summary: '',
      nodes: [
        { ref: 'collect_cv_sources', label: 'Collect CVs', purpose: '', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'cv_documents', artifactKind: 'document' }] },
        { ref: 'load_docx_template', label: 'Load template', purpose: '', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'template_document', artifactKind: 'document' }] },
        {
          ref: 'adapt_cvs_to_template', label: 'Adapt CVs', purpose: '', nodeTemplateKey: 'iterator.template',
          inputPorts: [{ id: 'items', artifactKind: 'document' }],
          iteratorBody: {
            steps: [{
              ref: 'apply_template_to_cv', title: 'Apply template to CV', nodeTemplateKey: 'synthesis-step',
            }],
            edges: [],
          },
        },
      ],
      links: [
        { sourceRef: 'collect_cv_sources', targetRef: 'adapt_cvs_to_template', sourceOutputPortId: 'cv_documents', targetInputPortId: 'items' },
        { sourceRef: 'load_docx_template', targetIteratorRef: 'adapt_cvs_to_template', targetRef: 'apply_template_to_cv', sourceOutputPortId: 'template_document', targetInputPortId: 'template' },
      ],
      bindings: [
        { sourceKind: 'node-output', sourceRef: 'collect_cv_sources', sourcePort: 'cv_documents', targetRef: 'adapt_cvs_to_template', targetPort: 'items' },
        { sourceKind: 'node-output', sourceRef: 'load_docx_template', sourcePort: 'template_document', targetIteratorRef: 'adapt_cvs_to_template', targetRef: 'apply_template_to_cv', targetPort: 'template' },
      ],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [
        genericTemplate(),
        genericTemplate({ key: 'iterator.template', iteratorConfig: ITERATOR_CONFIG, inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'document', required: false }] }),
        makeTemplate({ key: 'synthesis-step', inputPorts: [{ id: 'template', name: 'Template', artifactKind: 'document', required: false }], outputPorts: [] }),
      ],
      selectedNodeId: null,
    });

    const iteratorNode = suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node' && c.nodeRef === 'adapt_cvs_to_template');
    const childStep = iteratorNode?.task.iteratorBody?.steps.find((step: { nodeRef: string }) => step.nodeRef === 'apply_template_to_cv');
    const scopedEdge = suggestion.changes.find((c: Change): c is CreateEdgeChange => c.type === 'create_edge' && c.targetIteratorNodeRef === 'adapt_cvs_to_template');
    const scopedBinding = suggestion.changes.find((c: Change): c is CreateBindingChange => c.type === 'create_data_binding' && c.targetIteratorNodeRef === 'adapt_cvs_to_template');

    expect(childStep?.inputPorts?.map((port: { id: string }) => port.id)).toContain('template');
    expect(scopedEdge).toEqual(expect.objectContaining({
      sourceNodeRef: 'load_docx_template',
      targetIteratorNodeRef: 'adapt_cvs_to_template',
      targetNodeRef: 'apply_template_to_cv',
      targetInputPortId: 'template',
    }));
    expect(scopedBinding).toEqual(expect.objectContaining({
      sourceNodeRef: 'load_docx_template',
      targetIteratorNodeRef: 'adapt_cvs_to_template',
      targetNodeRef: 'apply_template_to_cv',
      targetPort: 'template',
    }));
  });

  it('uses connected explicit artifact kind for referenced template-derived iterator collection ports', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Adapt CVs',
      summary: '',
      nodes: [
        { ref: 'collect_cv_sources', label: 'Collect CVs', purpose: '', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'cv_documents', artifactKind: 'document' }] },
        { ref: 'adapt_cvs_to_template', label: 'Adapt CVs', purpose: '', nodeTemplateKey: 'iterator.template' },
      ],
      links: [{ sourceRef: 'collect_cv_sources', targetRef: 'adapt_cvs_to_template', sourceOutputPortId: 'cv_documents', targetInputPortId: 'items' }],
      bindings: [{ sourceKind: 'node-output', sourceRef: 'collect_cv_sources', sourcePort: 'cv_documents', targetRef: 'adapt_cvs_to_template', targetPort: 'items' }],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [
        genericTemplate(),
        genericTemplate({ key: 'iterator.template', iteratorConfig: ITERATOR_CONFIG, inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: false }] }),
      ],
      selectedNodeId: null,
    });

    const iteratorNode = suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node' && c.nodeRef === 'adapt_cvs_to_template');

    expect(iteratorNode?.task.inputPorts).toEqual([expect.objectContaining({ id: 'items', artifactKind: 'document' })]);
    expect(suggestion.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'create_edge', targetNodeRef: 'adapt_cvs_to_template', targetInputPortId: 'items' }),
      expect.objectContaining({ type: 'create_data_binding', targetNodeRef: 'adapt_cvs_to_template', targetPort: 'items' }),
    ]));
  });

  it('recomputes impact counts deterministically from accepted changes', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Plan',
      summary: 'Plan summary',
      nodes: [
        { ref: 'a', label: 'A', purpose: '', nodeTemplateKey: 'generic.agent_step', outputPorts: [{ id: 'o', artifactKind: 'text' }] },
        { ref: 'b', label: 'B', purpose: '', nodeTemplateKey: 'generic.agent_step', inputPorts: [{ id: 'i', artifactKind: 'text' }] },
      ],
      links: [{ sourceRef: 'a', targetRef: 'b', sourceOutputPortId: 'o', targetInputPortId: 'i' }],
      bindings: [{ targetRef: 'b', targetPort: 'i', sourceKind: 'node-output', sourceRef: 'a', sourcePort: 'o' }],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [genericTemplate()],
      selectedNodeId: null,
    });

    expect(suggestion.impact.nodesToCreate).toBe(2);
    expect(suggestion.impact.edgesToCreate).toBe(1);
    expect(suggestion.impact.dataBindingsToCreate).toBe(1);
    expect(suggestion.impact.affectedTaskIds.sort()).toEqual(['a', 'b']);
  });

  it('does not fall back to nodeType template lookup when nodeTemplateKey is unknown', () => {
    const template = makeTemplate({ key: 'research', nodeType: 'agent' });
    const blueprint: PlaybookIntentBlueprint = {
      title: 't',
      summary: '',
      nodes: [{ ref: 'r', label: 'R', purpose: '', nodeTemplateKey: 'missing-template' }],
      links: [],
      bindings: [{ targetRef: 'r', targetPort: 'context', sourceKind: 'constant', constantValue: { kind: 'workspace', id: 'ws-1', workspaceId: 'ws-1' } }],
    };

    const result = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [template],
      selectedNodeId: null,
    });

    expect(result.suggestion.changes.some((c: Change) => c.type === 'create_node')).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'builder_node_template_key_unknown', stage: 'graph_builder', severity: 'warning', itemId: 'missing-template' }),
    ]));
  });
});
