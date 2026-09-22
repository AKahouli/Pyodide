/**
 * Node Serializer
 * Converts between FlowNode/PlaybookTask and React Flow Node representations.
 */

import type { Node } from '@xyflow/react';
import type {
  PlaybookTask,
  PlaybookNodeData,
  TaskInputPort,
  TaskOutputPort,
  ArtifactKind,
} from '../../types';
import { getEffectiveNodeType } from '../../utils/node-type';

const ITERATOR_HEADER_HEIGHT = 56;
const ITERATOR_PADDING = 32;
const ITERATOR_MIN_WIDTH = 360;
const ITERATOR_MIN_HEIGHT = 220;
const ITERATOR_CHILD_HORIZONTAL_GAP = 221;
const ITERATOR_CHILD_VERTICAL_GAP = 221;
const ITERATOR_CHILD_MAX_COLUMNS = 3;
const ITERATOR_CHILD_NODE_WIDTH = 384;
const ITERATOR_CHILD_NODE_HEIGHT = 240;

/** Default ports used when a legacy task has no ports defined. */
export const DEFAULT_INPUT_PORT: TaskInputPort = {
  id: 'default',
  name: 'Input',
  artifactKind: 'text',
  required: false,
};

export const DEFAULT_OUTPUT_PORT: TaskOutputPort = {
  id: 'default',
  name: 'Output',
  artifactKind: 'text',
};

export const DEFAULT_ITERATOR_INPUT_PORT: TaskInputPort = {
  id: 'items',
  name: 'Items',
  artifactKind: 'data',
  required: false,
};

export const DEFAULT_ITERATOR_OUTPUT_PORT: TaskOutputPort = {
  id: 'results',
  name: 'Results',
  artifactKind: 'data',
};

export const TRIGGER_NODE_ID = '__trigger__';

const MAIL_TRIGGER_PORTS = [
  { id: 'mail_data', name: 'Mail data', artifactKind: 'data' as ArtifactKind },
  { id: 'mail_attachments', name: 'Mail attachments', artifactKind: 'document' as ArtifactKind },
];

function getDefaultIteratorInputPorts(): TaskInputPort[] {
  return [{ ...DEFAULT_ITERATOR_INPUT_PORT }];
}

function getDefaultIteratorOutputPorts(): TaskOutputPort[] {
  return [{ ...DEFAULT_ITERATOR_OUTPUT_PORT }];
}

function normalizeIteratorTaskPorts(task: PlaybookTask): PlaybookTask {
  if (task.taskType !== 'iterator') {
    return task;
  }
  return {
    ...task,
    inputPorts: task.inputPorts?.length ? task.inputPorts : getDefaultIteratorInputPorts(),
    outputPorts: task.outputPorts?.length ? task.outputPorts : getDefaultIteratorOutputPorts(),
  };
}

/**
 * Ensures a legacy task has input/output ports.
 * Iterator tasks get normalized ports; portless tasks get defaults.
 */
export function migrateTask(task: unknown): PlaybookTask {
  const t = task as PlaybookTask;
  if (t && getEffectiveNodeType(t) === 'iterator') {
    return normalizeIteratorTaskPorts(t);
  }
  const hasPorts = t?.inputPorts?.length || t?.outputPorts?.length;
  if (hasPorts) return t;
  return {
    ...t,
    taskType: t?.taskType || 'generic',
    inputPorts: [DEFAULT_INPUT_PORT],
    outputPorts: [DEFAULT_OUTPUT_PORT],
  };
}

export function buildTriggerNode(): Node {
  return {
    id: TRIGGER_NODE_ID,
    type: 'playbookTrigger',
    position: { x: 40, y: 160 },
    draggable: true,
    selectable: true,
    data: {
      title: 'Mail Trigger',
      outputPorts: MAIL_TRIGGER_PORTS,
      triggerType: 'mail',
    },
  };
}

function getIteratorChildTasks(tasks: PlaybookTask[], iteratorId: string): PlaybookTask[] {
  return tasks.filter((t) => t.containerConfig?.parentIteratorId === iteratorId);
}

function getIteratorNodeMap(tasks: PlaybookTask[]): Map<string, PlaybookTask> {
  return new Map(
    tasks.filter((t) => getEffectiveNodeType(t) === 'iterator').map((t) => [t.id, t]),
  );
}

function buildIteratorContainerNode(task: PlaybookTask, childTasks: PlaybookTask[]): Node {
  const normalizedTask = normalizeIteratorTaskPorts(task);
  const bounds = childTasks.reduce(
    (acc, child) => {
      const relX = child.positionX - task.positionX;
      const relY = child.positionY - task.positionY;
      acc.maxX = Math.max(acc.maxX, relX + ITERATOR_CHILD_NODE_WIDTH);
      acc.maxY = Math.max(acc.maxY, relY + ITERATOR_CHILD_NODE_HEIGHT);
      return acc;
    },
    { maxX: ITERATOR_MIN_WIDTH, maxY: ITERATOR_MIN_HEIGHT },
  );
  const autoW = Math.max(ITERATOR_MIN_WIDTH, bounds.maxX + ITERATOR_PADDING);
  const autoH = Math.max(ITERATOR_MIN_HEIGHT, bounds.maxY + ITERATOR_PADDING);
  const manualW = normalizedTask.iteratorLayout?.width ?? 0;
  const manualH = normalizedTask.iteratorLayout?.height ?? 0;
  const width = Math.max(autoW, manualW);
  const height = Math.max(autoH, manualH);

  return {
    id: normalizedTask.id,
    type: 'playbookIteratorContainer',
    position: { x: normalizedTask.positionX, y: normalizedTask.positionY },
    data: {
      ...normalizedTask,
      width,
      height,
      childTaskIds: childTasks.map((c) => c.id),
    } as PlaybookNodeData,
    style: { width, height },
  };
}

function buildChildFlowNode(task: PlaybookTask, iteratorTasks: Map<string, PlaybookTask>): Node {
  const parentId = task.containerConfig?.parentIteratorId;
  const parent = parentId ? iteratorTasks.get(parentId) : null;
  const isScoped = Boolean(parentId && parent);

  return {
    id: task.id,
    type: taskTypeToReactFlowType(task.nodeType),
    position: isScoped && parent
      ? { x: task.positionX - parent.positionX, y: task.positionY - parent.positionY }
      : { x: task.positionX, y: task.positionY },
    parentId: isScoped ? parentId ?? undefined : undefined,
    extent: isScoped ? ('parent' as const) : undefined,
    data: { ...task } as PlaybookNodeData,
    ariaLabel: task.title || undefined,
  };
}

/**
 * Converts PlaybookTask array to React Flow Node array.
 * @param includeTrigger Whether to include the trigger node (mail-triggered playbooks).
 */
export function tasksToNodes(tasks: PlaybookTask[], includeTrigger = true): Node[] {
  const iteratorTasks = getIteratorNodeMap(tasks);
  const iteratorNodes = tasks
    .filter((t) => getEffectiveNodeType(t) === 'iterator')
    .map((t) => buildIteratorContainerNode(t, getIteratorChildTasks(tasks, t.id)));
  const stepNodes = tasks
    .filter((t) => getEffectiveNodeType(t) !== 'iterator')
    .map((t) => buildChildFlowNode(t, iteratorTasks));
  const taskNodes: Node[] = [...iteratorNodes, ...stepNodes];
  return includeTrigger ? [buildTriggerNode(), ...taskNodes] : taskNodes;
}

function toAbsoluteTaskPosition(
  node: Node,
  nodeMap: Map<string, Node>,
): { x: number; y: number } {
  if (!node.parentId) return { x: node.position.x, y: node.position.y };
  const parent = nodeMap.get(node.parentId);
  if (!parent) return { x: node.position.x, y: node.position.y };
  return { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y };
}

/**
 * Converts React Flow Node array back to PlaybookTask array.
 */
export function nodesToTasks(nodes: Node[]): PlaybookTask[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return nodes
    .filter((n) => n.type === 'playbookStep' || n.type === 'playbookIteratorContainer' || n.type === 'playbookRouter' || n.type === 'playbookHumanApproval')
    .map((node) => {
      const data = node.data as PlaybookNodeData;
      const abs = toAbsoluteTaskPosition(node, nodeMap);
      return {
        ...data,
        id: node.id,
        positionX: abs.x,
        positionY: abs.y,
        containerConfig:
          node.type === 'playbookStep'
            ? { parentIteratorId: node.parentId || null }
            : data.containerConfig ?? null,
      };
    });
}

function getIteratorChildAbsolutePosition(
  tasks: PlaybookTask[],
  iteratorId: string,
  childIndex: number,
): { x: number; y: number } | null {
  const iteratorTask = tasks.find(
    (t) => t.id === iteratorId && getEffectiveNodeType(t) === 'iterator',
  );
  if (!iteratorTask) return null;

  const siblingCount = tasks.filter(
    (t) => t.containerConfig?.parentIteratorId === iteratorId,
  ).length;
  const total = Math.max(siblingCount, childIndex + 1);
  const cols = Math.min(ITERATOR_CHILD_MAX_COLUMNS, Math.max(1, Math.ceil(Math.sqrt(total))));
  const col = childIndex % cols;
  const row = Math.floor(childIndex / cols);

  return {
    x: iteratorTask.positionX + ITERATOR_PADDING + col * (ITERATOR_CHILD_NODE_WIDTH + ITERATOR_CHILD_HORIZONTAL_GAP),
    y: iteratorTask.positionY + ITERATOR_HEADER_HEIGHT + 16 + row * (ITERATOR_CHILD_NODE_HEIGHT + ITERATOR_CHILD_VERTICAL_GAP),
  };
}

export function repackIteratorChildrenInTasks(
  tasks: PlaybookTask[],
  iteratorId: string,
): PlaybookTask[] {
  const children = tasks.filter((t) => t.containerConfig?.parentIteratorId === iteratorId);
  if (children.length === 0) return tasks;

  const ordered = [...children]
    .sort((a, b) => {
      if (a.executionOrder !== b.executionOrder) return a.executionOrder - b.executionOrder;
      return a.id.localeCompare(b.id);
    })
    .map((t) => t.id);

  return tasks.map((task) => {
    const idx = ordered.indexOf(task.id);
    if (idx === -1) return task;
    const pos = getIteratorChildAbsolutePosition(tasks, iteratorId, idx);
    if (!pos) return task;
    return { ...task, positionX: pos.x, positionY: pos.y };
  });
}

export function getIteratorChildAbsolutePositionForNewChild(
  tasks: PlaybookTask[],
  iteratorId: string,
): { x: number; y: number } | null {
  const existingCount = tasks.filter(
    (t) => t.containerConfig?.parentIteratorId === iteratorId,
  ).length;
  return getIteratorChildAbsolutePosition(tasks, iteratorId, existingCount);
}

function taskTypeToReactFlowType(nodeType: string | null | undefined): string {
  if (nodeType === 'iterator') return 'playbookIteratorContainer';
  if (nodeType === 'router') return 'playbookRouter';
  if (nodeType === 'human_approval') return 'playbookHumanApproval';
  return 'playbookStep';
}

export { getDefaultIteratorInputPorts, getDefaultIteratorOutputPorts };
