import type { PlaybookTask, TaskInputPort, TaskOutputPort } from '../types';

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

export function getDefaultIteratorInputPorts(): TaskInputPort[] {
  return [{ ...DEFAULT_ITERATOR_INPUT_PORT }];
}

export function getDefaultIteratorOutputPorts(): TaskOutputPort[] {
  return [{ ...DEFAULT_ITERATOR_OUTPUT_PORT }];
}

export function normalizeIteratorTaskPorts(task: PlaybookTask): PlaybookTask {
  if (task.taskType !== 'iterator') {
    return task;
  }

  return {
    ...task,
    inputPorts: getDefaultIteratorInputPorts(),
    outputPorts: getDefaultIteratorOutputPorts(),
  };
}
