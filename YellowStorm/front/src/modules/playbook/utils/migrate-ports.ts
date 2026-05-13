import type { PlaybookTask, PlaybookEdge, TaskInputPort, TaskOutputPort } from '../types';
import { normalizeIteratorTaskPorts } from './iterator-ports';
import { getEffectiveNodeType } from './node-type';

const DEFAULT_INPUT_PORT: TaskInputPort = {
  id: 'default',
  name: 'Input',
  artifactKind: 'text',
  required: false,
};

const DEFAULT_OUTPUT_PORT: TaskOutputPort = {
  id: 'default',
  name: 'Output',
  artifactKind: 'text',
};

export function migrateTask(task: any): PlaybookTask {
  if (task && getEffectiveNodeType(task as PlaybookTask) === 'iterator') {
    return normalizeIteratorTaskPorts(task as PlaybookTask);
  }

  const hasPorts = task.inputPorts?.length > 0 || task.outputPorts?.length > 0;
  if (hasPorts) return task as PlaybookTask;

  return {
    ...task,
    taskType: task.taskType || 'generic',
    inputPorts: [DEFAULT_INPUT_PORT],
    outputPorts: [DEFAULT_OUTPUT_PORT],
  };
}

export function migrateEdge(edge: any): PlaybookEdge {
  return {
    ...edge,
    sourceOutputPortId: edge.sourceOutputPortId || 'default',
    targetInputPortId: edge.targetInputPortId || 'default',
  };
}

export function remapIteratorEdgePorts(
  edge: PlaybookEdge,
  tasks: PlaybookTask[],
): PlaybookEdge {
  const sourceTask = tasks.find((task) => task.id === edge.sourceId);
  const targetTask = tasks.find((task) => task.id === edge.targetId);

  return {
    ...edge,
    sourceOutputPortId:
      sourceTask && getEffectiveNodeType(sourceTask) === 'iterator'
        ? 'results'
        : edge.sourceOutputPortId,
    targetInputPortId:
      targetTask && getEffectiveNodeType(targetTask) === 'iterator'
        ? 'items'
        : edge.targetInputPortId,
  };
}

export function migratePlaybook(
  tasks: PlaybookTask[],
  edges: PlaybookEdge[],
): { tasks: PlaybookTask[]; edges: PlaybookEdge[] } {
  const migratedTasks = tasks.map((t) =>
    getEffectiveNodeType(t) === 'iterator'
      ? normalizeIteratorTaskPorts(t)
      : t.inputPorts?.length || t.outputPorts?.length
        ? t
        : migrateTask(t),
  );
  const migratedEdges = edges.map((e) =>
    remapIteratorEdgePorts(
      e.sourceOutputPortId || e.targetInputPortId ? e : migrateEdge(e),
      migratedTasks,
    ),
  );
  return { tasks: migratedTasks, edges: migratedEdges };
}
