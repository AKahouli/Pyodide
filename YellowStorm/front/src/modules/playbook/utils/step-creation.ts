/**
 * Step creation, connection, and edge-insertion planning.
 * Pure functions shared by every creation entry point (toolbar, node "+",
 * drag-to-empty picker, edge insert) so all paths commit through the same rules.
 */

import type {
  ArtifactKind,
  DataBinding,
  PlaybookEdge,
  PlaybookTask,
  TaskInputPort,
  TaskOutputPort,
  TaskTemplate,
} from '../types';
import { buildRouterOutputPorts, cloneRouterConfig } from '../hooks/helpers/router-template';
import { createCompatibleInputPort } from './port-compatibility';
import { getEffectiveNodeType } from './node-type';

export type StepBlueprint =
  | { kind: 'blank' }
  | { kind: 'router' }
  | { kind: 'humanApproval' }
  | { kind: 'template'; template: TaskTemplate };

export interface BlueprintTitles {
  blankStep: string;
  router: string;
  humanApproval: string;
}

function newId(): string {
  return crypto.randomUUID();
}

function baseTask(title: string, executionOrder: number, position: { x: number; y: number }): PlaybookTask {
  return {
    id: newId(),
    title,
    description: '',
    assignedAgentId: null,
    executionMode: 'agent',
    selectedAction: undefined,
    executionOrder,
    positionX: position.x,
    positionY: position.y,
    interruptBefore: false,
    interruptAfter: false,
    allowClarification: false,
    clarificationPrompt: '',
    maxClarifications: 3,
    inputKeys: [],
    outputKey: '',
    enabled: true,
    notifyOnComplete: false,
    notifyEmails: [],
    inputFiles: [],
    taskType: 'generic',
  };
}

/** Builds a new PlaybookTask from a blueprint (blank step, router, approval, or catalog template). */
export function buildTaskFromBlueprint(
  blueprint: StepBlueprint,
  options: {
    position: { x: number; y: number };
    executionOrder: number;
    titles: BlueprintTitles;
  },
): PlaybookTask {
  const { position, executionOrder, titles } = options;

  if (blueprint.kind === 'blank') {
    return {
      ...baseTask(`${titles.blankStep} ${executionOrder + 1}`, executionOrder, position),
      inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }],
      outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }],
    };
  }

  if (blueprint.kind === 'router') {
    const routerConfig = { outputLabels: ['retry', 'done', '__error__'], maxIterations: 3 };
    return {
      ...baseTask(titles.router, executionOrder, position),
      nodeType: 'router',
      inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }],
      outputPorts: buildRouterOutputPorts(routerConfig),
      routerConfig,
    };
  }

  if (blueprint.kind === 'humanApproval') {
    return {
      ...baseTask(titles.humanApproval, executionOrder, position),
      nodeType: 'human_approval',
      inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }],
      outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }],
      humanApprovalConfig: { promptTemplate: '', timeoutSeconds: 3600 },
    };
  }

  const template = blueprint.template;
  const isRouterTemplate = template.nodeType === 'router';
  const routerConfig = isRouterTemplate ? cloneRouterConfig(template.routerConfig) : null;
  return {
    ...baseTask(`${template.title} ${executionOrder + 1}`, executionOrder, position),
    description: template.description,
    assignedAgentId: template.nodeType === 'agent' ? (template.assignedAgentId ?? null) : null,
    executionMode: template.nodeType === 'action' ? 'action' : 'agent',
    selectedAction: template.nodeType === 'action' ? (template.selectedAction ?? undefined) : undefined,
    taskType: template.nodeType === 'iterator' ? 'iterator' : template.nodeType === 'evaluation' ? 'evaluation' : 'generic',
    nodeType: template.nodeType,
    nodeTemplateKey: template.key,
    inputPorts: template.inputPorts.map((p) => ({ ...p })),
    outputPorts: isRouterTemplate ? buildRouterOutputPorts(routerConfig!) : template.outputPorts.map((p) => ({ ...p })),
    iteratorConfig: template.iteratorConfig ? { ...template.iteratorConfig } : null,
    routerConfig,
    humanApprovalConfig: template.nodeType === 'human_approval'
      ? template.humanApprovalConfig
        ? {
            promptTemplate: template.humanApprovalConfig.promptTemplate,
            timeoutSeconds: template.humanApprovalConfig.timeoutSeconds,
          }
        : {
            promptTemplate: '',
            timeoutSeconds: 3600,
          }
      : null,
    retryPolicy: template.retryPolicy ? { ...template.retryPolicy } : null,
    modelId: template.modelId ?? null,
  };
}

export function createCompatibleOutputPort(name: string, artifactKind: ArtifactKind): TaskOutputPort {
  return { id: `out-${crypto.randomUUID().slice(0, 8)}`, name, artifactKind };
}

function controlEdgeId(source: string, sourcePortId: string, target: string, targetPortId: string): string {
  return `e-${source}-${sourcePortId}-${target}-${targetPortId}`;
}

export function createControlEdge(
  source: string,
  sourcePortId: string,
  target: string,
  targetPortId: string,
): PlaybookEdge {
  return {
    id: controlEdgeId(source, sourcePortId, target, targetPortId),
    sourceId: source,
    sourceOutputPortId: sourcePortId,
    targetId: target,
    targetInputPortId: targetPortId,
  };
}

export function createNodeOutputBinding(
  source: string,
  sourcePortId: string,
  target: string,
  targetPortId: string,
): DataBinding {
  return {
    id: `db-${source}-${sourcePortId}-${target}-${targetPortId}`,
    targetNode: target,
    targetPort: targetPortId,
    sourceKind: 'node-output',
    sourceNode: source,
    sourcePort: sourcePortId,
    iteration: 'current',
  };
}

function findPortByKind<T extends { artifactKind: ArtifactKind }>(ports: T[], kind: ArtifactKind | undefined): T | undefined {
  if (!kind) return ports[0];
  return ports.find((p) => p.artifactKind === kind);
}

export interface NewStepConnection {
  /** Final input ports for the new task (may include an appended compatible port). */
  taskInputPorts: TaskInputPort[];
  /** Final output ports for the new task (unchanged today; kept for symmetry). */
  taskOutputPorts: TaskOutputPort[];
  /** Control edge to create, or null when the source is the mail trigger (binding-only). */
  edge: PlaybookEdge | null;
  /** Data binding to create; null for router branches (control-only, like commitConditionalEdge). */
  binding: DataBinding | null;
  sourcePortId: string;
  targetPortId: string;
}

export interface ConnectionSource {
  nodeId: string;
  /** Task for real steps; null for the mail trigger pseudo-node. */
  task: PlaybookTask | null;
  outputPorts: TaskOutputPort[];
  /** Explicit output handle the gesture started from (picker "+" with ambiguous output resolves it first). */
  sourcePortId?: string | null;
}

/**
 * Plans how a newly created task connects to its origin (node output or mail trigger).
 * Prefers an existing type-compatible input port, otherwise appends a compatible one —
 * the same rule the canvas already uses for drop-on-node-body connections.
 */
export function planConnectionForNewTask(source: ConnectionSource, newTask: PlaybookTask): NewStepConnection {
  const sourcePort =
    (source.sourcePortId ? source.outputPorts.find((p) => p.id === source.sourcePortId) : undefined)
    ?? source.outputPorts[0];
  const sourcePortId = sourcePort?.id ?? 'default';
  const sourceKind = sourcePort?.artifactKind;

  const inputPorts = newTask.inputPorts?.length ? newTask.inputPorts : [];
  let targetPort = findPortByKind(inputPorts, sourceKind);
  let taskInputPorts = inputPorts;
  if (!targetPort) {
    targetPort = createCompatibleInputPort(sourcePort?.name || 'Input', sourceKind ?? 'text');
    taskInputPorts = [...inputPorts, targetPort];
  }

  const targetPortId = targetPort.id;

  if (source.task === null) {
    // Mail trigger: binding-only, no control edge (matches onConnect's trigger path).
    return {
      taskInputPorts,
      taskOutputPorts: newTask.outputPorts ?? [],
      edge: null,
      binding: {
        id: `db-trigger-${sourcePortId}-${newTask.id}-${targetPortId}`,
        targetNode: newTask.id,
        targetPort: targetPortId,
        sourceKind: 'trigger',
        triggerPath: sourcePortId,
      },
      sourcePortId,
      targetPortId,
    };
  }

  if (getEffectiveNodeType(source.task) === 'router') {
    // Router branch: conditional edge labelled by the source handle, no data binding.
    return {
      taskInputPorts,
      taskOutputPorts: newTask.outputPorts ?? [],
      edge: createControlEdge(source.nodeId, sourcePortId, newTask.id, targetPortId),
      binding: null,
      sourcePortId,
      targetPortId,
    };
  }

  return {
    taskInputPorts,
    taskOutputPorts: newTask.outputPorts ?? [],
    edge: createControlEdge(source.nodeId, sourcePortId, newTask.id, targetPortId),
    binding: createNodeOutputBinding(source.nodeId, sourcePortId, newTask.id, targetPortId),
    sourcePortId,
    targetPortId,
  };
}

export interface InsertStepPlan {
  /** Final input ports for the new task (may include an appended compatible port). */
  taskInputPorts: TaskInputPort[];
  /** Final output ports for the new task (may include an appended compatible port). */
  taskOutputPorts: TaskOutputPort[];
  /** The original edge id to remove. */
  removedEdgeId: string;
  /** Replacement edges [source → new, new → target]. */
  addedEdges: PlaybookEdge[];
  /** Bindings replacing the one that flowed source.output → target.input. */
  addedBindings: DataBinding[];
  /** Binding ids that must be removed with the original edge. */
  removedBindingIds: string[];
  sourcePortId: string;
  newInputPortId: string;
  newOutputPortId: string;
  targetPortId: string;
}

/**
 * Plans an atomic insertion of a new task into an existing control edge A → B.
 * Preserves a router branch label on the segment leaving the router. Returns null
 * when the new task cannot bridge the edge's contracts (strict for catalog
 * templates and structural presets; only the generic blank step may grow
 * compatible ports, mirroring canvas connect behavior).
 */
export function planInsertOnEdge(
  edge: PlaybookEdge,
  tasks: PlaybookTask[],
  bindings: DataBinding[],
  newTask: PlaybookTask,
  options?: { allowPortCreation?: boolean },
): InsertStepPlan | null {
  const sourceTask = tasks.find((t) => t.id === edge.sourceId);
  const targetTask = tasks.find((t) => t.id === edge.targetId);
  if (!sourceTask || !targetTask) return null;

  const sourcePortId = edge.sourceOutputPortId
    && sourceTask.outputPorts?.some((p) => p.id === edge.sourceOutputPortId)
    ? edge.sourceOutputPortId
    : sourceTask.outputPorts?.[0]?.id ?? 'default';
  const sourceKind = sourceTask.outputPorts?.find((p) => p.id === sourcePortId)?.artifactKind;

  const targetPortId = edge.targetInputPortId
    && targetTask.inputPorts?.some((p) => p.id === edge.targetInputPortId)
    ? edge.targetInputPortId
    : targetTask.inputPorts?.[0]?.id ?? 'default';
  const targetKind = targetTask.inputPorts?.find((p) => p.id === targetPortId)?.artifactKind;

  const inputPorts = newTask.inputPorts?.length ? newTask.inputPorts : [];
  const outputPorts = newTask.outputPorts?.length ? newTask.outputPorts : [];

  const strict = Boolean(newTask.nodeTemplateKey) || options?.allowPortCreation === false;
  let inputPort = findPortByKind(inputPorts, sourceKind);
  if (!inputPort && strict) return null;
  let taskInputPorts = inputPorts;
  if (!inputPort) {
    inputPort = createCompatibleInputPort(sourceTask.outputPorts?.find((p) => p.id === sourcePortId)?.name || 'Input', sourceKind ?? 'text');
    taskInputPorts = [...inputPorts, inputPort];
  }

  let outputPort = findPortByKind(outputPorts, targetKind);
  if (!outputPort && strict) return null;
  let taskOutputPorts = outputPorts;
  if (!outputPort) {
    outputPort = createCompatibleOutputPort(targetTask.inputPorts?.find((p) => p.id === targetPortId)?.name || 'Output', targetKind ?? 'text');
    taskOutputPorts = [...outputPorts, outputPort];
  }

  const edgeIn = createControlEdge(edge.sourceId, sourcePortId, newTask.id, inputPort.id);
  const edgeOut = createControlEdge(newTask.id, outputPort.id, edge.targetId, targetPortId);

  const bridgedBinding = bindings.find(
    (b) => b.sourceNode === edge.sourceId
      && b.sourcePort === sourcePortId
      && b.targetNode === edge.targetId
      && b.targetPort === targetPortId,
  );

  // Mirror what the original edge carried: replace an existing source→target binding
  // with source→new and new→target; never invent bindings the edge did not have.
  const addedBindings: DataBinding[] = bridgedBinding
    ? [
        createNodeOutputBinding(edge.sourceId, sourcePortId, newTask.id, inputPort.id),
        createNodeOutputBinding(newTask.id, outputPort.id, edge.targetId, targetPortId),
      ]
    : [];

  return {
    taskInputPorts,
    taskOutputPorts,
    removedEdgeId: edge.id,
    addedEdges: [edgeIn, edgeOut],
    addedBindings,
    removedBindingIds: bridgedBinding ? [bridgedBinding.id] : [],
    sourcePortId,
    newInputPortId: inputPort.id,
    newOutputPortId: outputPort.id,
    targetPortId,
  };
}

/**
 * Edge-insert compatibility: a candidate fits when it already declares an input port
 * matching the edge's source artifact kind and an output port matching the target kind.
 * No silent type conversion for catalog picks.
 */
export function blueprintCanInsertOnEdge(
  blueprint: StepBlueprint,
  sourceKind: ArtifactKind | undefined,
  targetKind: ArtifactKind | undefined,
): boolean {
  if (blueprint.kind === 'blank') {
    // Generic step: bridges by growing a compatible port when needed.
    return true;
  }
  const template = blueprint.kind === 'template' ? blueprint.template : null;
  const inputPorts: TaskInputPort[] = template
    ? template.inputPorts
    : [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }];
  const outputPorts: TaskOutputPort[] = template
    ? template.outputPorts
    : [{ id: 'default', name: 'Output', artifactKind: 'text' }];

  const acceptsSource = inputPorts.some((p) => !sourceKind || p.artifactKind === sourceKind);
  const feedsTarget = outputPorts.some((p) => !targetKind || p.artifactKind === targetKind);
  return acceptsSource && feedsTarget;
}
