import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { PlaybookIntentBlueprintParserService } from './playbook-intent-blueprint-parser.service';
import { PlaybookIntentBlueprintRepairService } from './playbook-intent-blueprint-repair.service';
import { PlaybookIntentGraphBuilderService } from './playbook-intent-graph-builder.service';
import { PlaybookIntentGraphBindingResolverService } from './playbook-intent-graph-binding-resolver.service';
import { PlaybookIntentSuggestionDiagnosticsService } from './playbook-intent-suggestion-diagnostics.service';
import type { BuilderDesignCatalog, BuilderNodeTemplate } from './playbook-intent-graph-builder.service';
import type { IntentWorkflowValidationContext, PlaybookIntentSuggestion, PlaybookIntentWorkflowChange } from './playbook-flow-intent.service';
import type { PlaybookIntentBlueprint } from '../interfaces/playbook-flow-intent-blueprint.interface';
import type { PlaybookIntentDiagnostic } from '../interfaces/playbook-flow-intent-diagnostic.interface';

type WorkflowPlan = Extract<PlaybookIntentSuggestion, { kind: 'workflow_plan' }>;
type CreateNodeChange = Extract<PlaybookIntentWorkflowChange, { type: 'create_node' }>;
type CreateEdgeChange = Extract<PlaybookIntentWorkflowChange, { type: 'create_edge' | 'delete_edge' }> & { type: 'create_edge' };
type CreateBindingChange = Extract<PlaybookIntentWorkflowChange, { type: 'create_data_binding' }>;

interface FixtureExpectation {
  minNodes?: number;
  minEdges?: number;
  minBindings?: number;
  minConstantBindings?: number;
  routerNodeRef?: string;
  iteratorNodeRef?: string;
  iteratorRouterRef?: string;
  routerLabels?: string[];
  edgeRouterLabels?: string[];
  humanApprovalNodeRef?: string;
  toolNodeRef?: string;
  repairCodes?: string[];
  diagnosticCodes?: string[];
  forbiddenDiagnosticCodes?: string[];
  validationStatus?: WorkflowPlan['validationStatus'];
  noAutoBindRouterLabels?: string[];
  nodePorts?: Array<{ nodeRef: string; inputPort?: string; outputPort?: string }>;
}

interface GoldenFixture {
  inputBlueprint: PlaybookIntentBlueprint;
  expected: FixtureExpectation;
  existing?: Array<{
    id: string;
    inputPorts?: Array<[string, string]>;
    outputPorts?: Array<[string, string]>;
  }>;
}

const DEFAULT_LIMITS = {
  maxWorkflowPlanChanges: 80,
  maxInputPorts: 8,
  maxOutputPorts: 8,
  maxIteratorBodySteps: 16,
  maxIteratorBodyEdges: 80,
};

function makeContext(existing?: GoldenFixture['existing']): IntentWorkflowValidationContext {
  const existingTaskIds = new Set<string>();
  const inputPortsByTaskId = new Map<string, Map<string, string>>();
  const outputPortsByTaskId = new Map<string, Map<string, string>>();
  for (const task of existing || []) {
    existingTaskIds.add(task.id);
    inputPortsByTaskId.set(task.id, new Map(task.inputPorts || []));
    outputPortsByTaskId.set(task.id, new Map(task.outputPorts || []));
  }
  return {
    existingTaskIds,
    existingTaskTitles: new Map<string, string>(),
    existingTaskDescriptions: new Map<string, string>(),
    existingTaskAgents: new Map<string, string | null>(),
    inputPortsByTaskId,
    outputPortsByTaskId,
    existingBindingTargets: new Set<string>(),
  };
}

function template(overrides: Partial<BuilderNodeTemplate>): BuilderNodeTemplate {
  return {
    key: 'generic.agent_step',
    nodeType: 'agent',
    enabled: true,
    recommendedAgentTypeSlug: null,
    inputPorts: [],
    outputPorts: [],
    ...overrides,
  };
}

const TEMPLATES: BuilderNodeTemplate[] = [
  template({ key: 'generic.agent_step' }),
  template({ key: 'collector', outputPorts: [{ id: 'source_cv_list', name: 'Source CV list', artifactKind: 'data' }] }),
  template({ key: 'iterator', nodeType: 'iterator', iteratorConfig: { source: 'items', mode: 'item' }, inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: true }], outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }] }),
  template({ key: 'router.basic', nodeType: 'router' }),
  template({ key: 'router.template', nodeType: 'router', routerConfig: { outputLabels: ['yes', 'no'], defaultLabel: 'yes' } }),
  template({ key: 'human.approval', nodeType: 'human_approval', humanApprovalConfig: { required: true, mode: 'approve_reject' } }),
  template({ key: 'action.github', nodeType: 'action', selectedAction: 'github.create_issue' }),
  template({ key: 'requires.context', inputPorts: [{ id: 'context', name: 'Context', artifactKind: 'text', required: true }] }),
];

const DESIGN_CATALOG: BuilderDesignCatalog = {
  connectors: [{ id: 'connector-github', slug: 'github', name: 'GitHub' }],
  connectorActions: [{ connectorSlug: 'github', actionKey: 'create_issue' }],
  skills: [{ id: 'skill-docx', slug: 'docx', name: 'DOCX' }],
};

function loadFixtures(): Array<{ name: string; fixture: GoldenFixture }> {
  const dir = join(__dirname, '..', 'test-fixtures', 'intent-blueprint-v2');
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({
      name: file,
      fixture: JSON.parse(readFileSync(join(dir, file), 'utf8')) as GoldenFixture,
    }));
}

describe('Playbook intent blueprint v2 golden fixtures', () => {
  const parser = new PlaybookIntentBlueprintParserService();
  const repairService = new PlaybookIntentBlueprintRepairService();
  const resolver = new PlaybookIntentGraphBindingResolverService();
  const builder = new PlaybookIntentGraphBuilderService(resolver);
  const diagnosticsService = new PlaybookIntentSuggestionDiagnosticsService();

  beforeEach(() => {
    jest.spyOn((parser as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((builder as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((resolver as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((resolver as any).logger, 'error').mockImplementation(() => undefined);
  });

  it.each(loadFixtures())('$name compiles through parser, repair, builder, resolver, and diagnostics', ({ fixture }) => {
    const context = makeContext(fixture.existing);
    const parsed = parser.parse(JSON.stringify({ blueprint: fixture.inputBlueprint }), context);
    expect(parsed).not.toBeNull();

    const repaired = repairService.repair({
      blueprint: parsed!.blueprint,
      templates: TEMPLATES,
      designCatalog: DESIGN_CATALOG,
      existingContext: context,
    });
    const built = builder.build({
      blueprint: repaired.blueprint,
      context,
      limits: DEFAULT_LIMITS,
      templates: TEMPLATES,
      designCatalog: DESIGN_CATALOG,
      selectedNodeId: null,
    });
    const diagnostics = [...parsed!.diagnostics, ...repaired.diagnostics, ...built.diagnostics];
    const existingFlow = {
      nodes: (fixture.existing || []).map((task) => ({
        id: task.id,
        kind: 'step',
        label: task.id,
        input: { ports: (task.inputPorts || []).map(([id, type]) => ({ id, label: id, type, required: false })) },
        output: { ports: (task.outputPorts || []).map(([id, type]) => ({ id, label: id, type })) },
      })),
      controlEdges: [],
      dataBindings: [],
    };
    const enriched = diagnosticsService.enrichWorkflowPlan(built.suggestion, existingFlow, diagnostics, repaired.repairSummary);

    assertExpectedShape(enriched, diagnostics, fixture.expected);
  });
});

function assertExpectedShape(
  suggestion: WorkflowPlan,
  diagnostics: PlaybookIntentDiagnostic[],
  expected: FixtureExpectation,
): void {
  const nodes = suggestion.changes.filter((change): change is CreateNodeChange => change.type === 'create_node');
  const edges = suggestion.changes.filter((change): change is CreateEdgeChange => change.type === 'create_edge');
  const bindings = suggestion.changes.filter((change): change is CreateBindingChange => change.type === 'create_data_binding');
  const diagnosticCodes = diagnostics.map((diagnostic) => diagnostic.code);

  if (expected.minNodes !== undefined) expect(nodes.length).toBeGreaterThanOrEqual(expected.minNodes);
  if (expected.minEdges !== undefined) expect(edges.length).toBeGreaterThanOrEqual(expected.minEdges);
  if (expected.minBindings !== undefined) expect(bindings.length).toBeGreaterThanOrEqual(expected.minBindings);
  if (expected.minConstantBindings !== undefined) {
    expect(bindings.filter((binding) => binding.sourceKind === 'constant')).toHaveLength(expected.minConstantBindings);
  }
  for (const code of expected.diagnosticCodes || []) expect(diagnosticCodes).toContain(code);
  for (const code of expected.repairCodes || []) expect(diagnosticCodes).toContain(code);
  for (const code of expected.forbiddenDiagnosticCodes || []) expect(diagnosticCodes).not.toContain(code);
  if (expected.validationStatus) expect(suggestion.validationStatus).toBe(expected.validationStatus);
  if (expected.routerNodeRef) assertRouter(nodes, edges, expected.routerNodeRef, expected.routerLabels || [], expected.edgeRouterLabels);
  if (expected.iteratorNodeRef) assertIteratorRouter(nodes, expected);
  if (expected.humanApprovalNodeRef) {
    expect(nodes.find((node) => node.nodeRef === expected.humanApprovalNodeRef)?.task.humanApprovalConfig).toBeTruthy();
  }
  if (expected.toolNodeRef) {
    expect(nodes.find((node) => node.nodeRef === expected.toolNodeRef)?.task.toolBindings?.length).toBeGreaterThan(0);
  }
  for (const portExpectation of expected.nodePorts || []) assertNodePort(nodes, portExpectation);
  for (const label of expected.noAutoBindRouterLabels || []) {
    expect(bindings.find((binding) => binding.sourceKind === 'node-output' && binding.sourcePort === label)).toBeUndefined();
  }
}

function assertRouter(nodes: CreateNodeChange[], edges: CreateEdgeChange[], nodeRef: string, labels: string[], edgeLabels = labels): void {
  const node = nodes.find((change) => change.nodeRef === nodeRef);
  expect(node?.task.routerConfig?.outputLabels).toEqual(expect.arrayContaining(labels));
  for (const label of labels) {
    expect(node?.task.outputPorts?.some((port) => port.id === label)).toBe(true);
  }
  for (const label of edgeLabels) {
    expect(edges.find((edge) => edge.sourceNodeRef === nodeRef && edge.routerLabel === label)).toEqual(expect.objectContaining({
      edgeKind: 'conditional',
      sourceOutputPortId: label,
    }));
  }
}

function assertIteratorRouter(nodes: CreateNodeChange[], expected: FixtureExpectation): void {
  const iteratorNode = nodes.find((change) => change.nodeRef === expected.iteratorNodeRef);
  const routerStep = iteratorNode?.task.iteratorBody?.steps.find((step) => step.nodeRef === expected.iteratorRouterRef);
  expect(routerStep?.routerConfig?.outputLabels).toEqual(expect.arrayContaining(expected.routerLabels || []));
  for (const label of expected.routerLabels || []) {
    expect(routerStep?.outputPorts?.some((port) => port.id === label)).toBe(true);
    expect(iteratorNode?.task.iteratorBody?.edges.find((edge) => edge.sourceNodeRef === expected.iteratorRouterRef && edge.routerLabel === label)).toEqual(expect.objectContaining({
      edgeKind: 'conditional',
      sourceOutputPortId: label,
    }));
  }
}

function assertNodePort(nodes: CreateNodeChange[], expected: { nodeRef: string; inputPort?: string; outputPort?: string }): void {
  const node = nodes.find((change) => change.nodeRef === expected.nodeRef);
  if (expected.inputPort) expect(node?.task.inputPorts?.some((port) => port.id === expected.inputPort)).toBe(true);
  if (expected.outputPort) expect(node?.task.outputPorts?.some((port) => port.id === expected.outputPort)).toBe(true);
}
