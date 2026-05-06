import type { PlaybookTask, PlaybookEdge, TaskInputPort, TaskOutputPort } from '../types';

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

const DEFAULT_ITERATOR_INPUT_PORT: TaskInputPort = {
  id: 'items',
  name: 'Items',
  artifactKind: 'data',
  required: false,
};

export function migrateTask(task: any): PlaybookTask {
  const hasPorts = task.inputPorts?.length > 0 || task.outputPorts?.length > 0;
  if (hasPorts) return task as PlaybookTask;

   const isIterator = task.taskType === 'iterator';

  return {
    ...task,
    taskType: task.taskType || 'generic',
    inputPorts: [isIterator ? DEFAULT_ITERATOR_INPUT_PORT : DEFAULT_INPUT_PORT],
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

export function migratePlaybook(
  tasks: PlaybookTask[],
  edges: PlaybookEdge[],
): { tasks: PlaybookTask[]; edges: PlaybookEdge[] } {
  const migratedTasks = tasks.map((t) =>
    t.inputPorts?.length || t.outputPorts?.length ? t : migrateTask(t),
  );
  const migratedEdges = edges.map((e) =>
    e.sourceOutputPortId || e.targetInputPortId ? e : migrateEdge(e),
  );
  return { tasks: migratedTasks, edges: migratedEdges };
}
