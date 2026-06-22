import { PlaybookIntentGraphBuilderService } from './playbook-intent-graph-builder.service';
import { PlaybookIntentNodeBuildRegistryService } from './playbook-intent-node-build-registry.service';
import { PlaybookIntentGraphBindingResolverService } from './playbook-intent-graph-binding-resolver.service';
import type {
  IntentWorkflowValidationContext,
  PlaybookIntentSuggestion,
  PlaybookIntentWorkflowChange,
} from './playbook-flow-intent.service';
import type { FlowNodeTemplateResponse } from '../interfaces/playbook-flow-node-template.interface';
import type { PlaybookIntentBlueprint } from '../interfaces/playbook-flow-intent-blueprint.interface';

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
    type: 'synthesis',
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
    executionMode: 'agent',
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

describe('PlaybookIntentGraphBuilderService', () => {
  let service: PlaybookIntentGraphBuilderService;

  beforeEach(() => {
    service = new PlaybookIntentGraphBuilderService(
      new PlaybookIntentNodeBuildRegistryService(),
      new PlaybookIntentGraphBindingResolverService(),
    );
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  });

  it('produces a stable workflow_plan from a linear blueprint across repeated runs', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Linear research',
      summary: 'Linear two-step research',
      nodes: [
        { ref: 'collect', label: 'Collect', purpose: 'Gather', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
        { ref: 'draft', label: 'Draft', purpose: 'Write', inputPorts: [{ id: 'data', artifactKind: 'data', required: true }],
          outputPorts: [{ id: 'report', artifactKind: 'document' }] },
      ],
      links: [{ sourceRef: 'collect', targetRef: 'draft', sourceOutputPortId: 'data', targetInputPortId: 'data' }],
      bindings: [{ targetRef: 'draft', targetPort: 'data', sourceKind: 'node-output', sourceRef: 'collect', sourcePort: 'data' }],
    };
    const options = {
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [] as FlowNodeTemplateResponse[],
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
        { ref: 'collect', label: 'Collect', purpose: 'Gather', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
        { ref: 'draft', label: 'Draft', purpose: 'Write', inputPorts: [{ id: 'data', artifactKind: 'data', required: true }] },
      ],
      links: [{ sourceRef: 'collect', targetRef: 'draft', sourceOutputPortId: 'data', targetInputPortId: 'data' }],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [],
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
      templates: [],
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
      templates: [],
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
      templates: [],
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
    expect(result.dropped.map((drop) => drop.rule)).toEqual(expect.arrayContaining([
      'builder_connector_ref_unknown_slug',
      'builder_connector_ref_unknown_action',
      'builder_skill_ref_unknown_slug',
    ]));
  });

  it('does not inherit required flags from template input ports', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Template node',
      summary: '',
      nodes: [{ ref: 'draft', label: 'Draft', purpose: 'Write', templateType: 'document' }],
      links: [],
      bindings: [{ targetRef: 'draft', targetPort: 'input-context', sourceKind: 'constant', constantValue: { kind: 'workspace', id: 'ws-1', workspaceId: 'ws-1' } }],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [{
        type: 'document', key: 'document', nodeType: 'agent',
        inputPorts: [{ id: 'input-context', name: 'Context', artifactKind: 'text', required: true }],
        outputPorts: [], recommendedAgentTypeSlug: null, enabled: true,
      }],
      selectedNodeId: null,
    });

    const createChange = suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node');

    expect(createChange?.task.inputPorts?.[0]).toEqual(expect.objectContaining({ id: 'input-context', required: false }));
  });

  it('drops the edge when ports have incompatible artifact kinds and logs a warning', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Mismatch',
      summary: '',
      nodes: [
        { ref: 'src', label: 'Src', purpose: '', outputPorts: [{ id: 'o', artifactKind: 'text' }] },
        { ref: 'dst', label: 'Dst', purpose: '', inputPorts: [{ id: 'i', artifactKind: 'document' }] },
      ],
      links: [{ sourceRef: 'src', targetRef: 'dst', sourceOutputPortId: 'o', targetInputPortId: 'i' }],
    };

    const result = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [],
      selectedNodeId: null,
    });

    expect(result.suggestion.changes.some((c: Change) => c.type === 'create_edge')).toBe(false);
  });

  it('emits an iterator node with an isolated body that does not leak edges to the top level', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Iterate',
      summary: '',
      nodes: [{
        ref: 'loop', label: 'Loop', purpose: 'Iterate', nodeType: 'iterator',
        iteratorBody: {
          steps: [
            { ref: 's1', title: 'Step 1', outputPorts: [{ id: 'text', artifactKind: 'text' }] },
            { ref: 's2', title: 'Step 2', inputPorts: [{ id: 'text', artifactKind: 'text' }] },
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
      templates: [],
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
      nodes: [{ ref: 'dst', label: 'Dst', purpose: '', inputPorts: [{ id: 'inp', artifactKind: 'document' }] }],
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
      templates: [],
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

  it('maps iterator nodeType to runtime iterator and human_approval to human_approval', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Mixed',
      summary: '',
      nodes: [
        { ref: 'loop', label: 'Loop', purpose: '', nodeType: 'iterator', iteratorBody: { steps: [{ ref: 's1', title: 'S1' }], edges: [] } },
        { ref: 'approve', label: 'Approve', purpose: '', nodeType: 'human_approval' },
        { ref: 'route', label: 'Route', purpose: '', nodeType: 'router' },
      ],
      links: [],
      bindings: [],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [],
      selectedNodeId: null,
    });

    const nodes: CreateNodeChange[] = suggestion.changes.filter((c: Change): c is CreateNodeChange => c.type === 'create_node');
    expect(nodes).toHaveLength(3);
    expect(nodes.find((n: CreateNodeChange) => n.nodeRef === 'loop')?.task.templateType).toBeFalsy();
    expect(nodes.find((n: CreateNodeChange) => n.nodeRef === 'approve')).toBeDefined();
    expect(nodes.find((n: CreateNodeChange) => n.nodeRef === 'route')).toBeDefined();
  });

  it('uses bound node template ports when no explicit ports are provided', () => {
    const template = makeTemplate({ type: 'synthesis-step', inputPorts: [{ id: 'context', name: 'Context', artifactKind: 'text', required: false }],
      outputPorts: [{ id: 'draft', name: 'Draft', artifactKind: 'document' }] });
    const blueprint: PlaybookIntentBlueprint = {
      title: 't',
      summary: '',
      nodes: [
        { ref: 'step', label: 'Step', purpose: '', templateType: 'synthesis-step' },
        { ref: 'publish', label: 'Publish', purpose: '', inputPorts: [{ id: 'draft', artifactKind: 'document' }] },
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
      templates: [template],
      selectedNodeId: null,
    });

    const node = suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node' && c.nodeRef === 'step');
    expect(node).toBeDefined();
    if (!node) return;
    expect(node.task.templateType).toBe('synthesis-step');
    expect(node.task.inputPorts?.map((p: { id: string }) => p.id)).toEqual(['context']);
    expect(node.task.outputPorts?.map((p: { id: string }) => p.id)).toEqual(['draft']);
  });

  it('prunes unbound template ports and keeps explicit blueprint ports', () => {
    const template = makeTemplate({
      type: 'synthesis-step',
      inputPorts: [{ id: 'context', name: 'Context', artifactKind: 'text', required: true }],
      outputPorts: [{ id: 'draft', name: 'Draft', artifactKind: 'document' }],
    });
    const blueprint: PlaybookIntentBlueprint = {
      title: 't',
      summary: '',
      nodes: [{
        ref: 'step', label: 'Step', purpose: '', templateType: 'synthesis-step',
        inputPorts: [{ id: 'custom', artifactKind: 'text', required: true }],
      }],
      links: [],
      bindings: [],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [template],
      selectedNodeId: null,
    });

    const node = suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node');
    expect(node?.task.inputPorts?.map((p: { id: string }) => p.id)).toEqual(['custom']);
    expect(node?.task.outputPorts).toBeUndefined();
  });

  it('creates an edge for node-output bindings without requiring an explicit link', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Bound flow',
      summary: '',
      nodes: [
        { ref: 'collect', label: 'Collect', purpose: '', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
        { ref: 'draft', label: 'Draft', purpose: '', inputPorts: [{ id: 'data', artifactKind: 'data' }] },
      ],
      links: [],
      bindings: [{ targetRef: 'draft', targetPort: 'data', sourceKind: 'node-output', sourceRef: 'collect', sourcePort: 'data' }],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [],
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
    const template = makeTemplate({ type: 'iterator-step', inputPorts: [
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
        ref: 'loop', label: 'Loop', purpose: '', nodeType: 'iterator',
        iteratorBody: {
          steps: [
            { ref: 's1', title: 'Step 1', templateType: 'iterator-step' },
            { ref: 's2', title: 'Step 2', templateType: 'iterator-step' },
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
      templates: [template],
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

  it('recomputes impact counts deterministically from accepted changes', () => {
    const blueprint: PlaybookIntentBlueprint = {
      title: 'Plan',
      summary: 'Plan summary',
      nodes: [
        { ref: 'a', label: 'A', purpose: '', outputPorts: [{ id: 'o', artifactKind: 'text' }] },
        { ref: 'b', label: 'B', purpose: '', inputPorts: [{ id: 'i', artifactKind: 'text' }] },
      ],
      links: [{ sourceRef: 'a', targetRef: 'b', sourceOutputPortId: 'o', targetInputPortId: 'i' }],
      bindings: [{ targetRef: 'b', targetPort: 'i', sourceKind: 'node-output', sourceRef: 'a', sourcePort: 'o' }],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [],
      selectedNodeId: null,
    });

    expect(suggestion.impact.nodesToCreate).toBe(2);
    expect(suggestion.impact.edgesToCreate).toBe(1);
    expect(suggestion.impact.dataBindingsToCreate).toBe(1);
    expect(suggestion.impact.affectedTaskIds.sort()).toEqual(['a', 'b']);
  });

  it('falls back to nodeKind template lookup when no explicit templateType is set', () => {
    const template = makeTemplate({ type: 'research', nodeType: 'agent' });
    const blueprint: PlaybookIntentBlueprint = {
      title: 't',
      summary: '',
      nodes: [{ ref: 'r', label: 'R', purpose: '', nodeType: 'agent' }],
      links: [],
      bindings: [{ targetRef: 'r', targetPort: 'context', sourceKind: 'constant', constantValue: { kind: 'workspace', id: 'ws-1', workspaceId: 'ws-1' } }],
    };

    const { suggestion }: { suggestion: WorkflowPlan } = service.build({
      blueprint,
      context: makeContext(),
      limits: DEFAULT_LIMITS,
      templates: [template],
      selectedNodeId: null,
    });

    const node = suggestion.changes.find((c: Change): c is CreateNodeChange => c.type === 'create_node');
    expect(node).toBeDefined();
    if (!node) return;
    expect(node.task.inputPorts?.map((p: { id: string }) => p.id)).toContain('context');
  });
});
