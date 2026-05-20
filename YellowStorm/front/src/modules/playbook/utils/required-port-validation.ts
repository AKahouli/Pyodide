import type { PlaybookTask, DataBinding } from '../types';

export interface UnboundPort {
  taskId: string;
  portId: string;
  portName: string;
}

export function getUnboundRequiredPorts(
  tasks: PlaybookTask[],
  dataBindings: DataBinding[],
): UnboundPort[] {
  const result: UnboundPort[] = [];

  for (const task of tasks) {
    if (!task.inputPorts) continue;
    for (const port of task.inputPorts) {
      if (!port.required) continue;
      const hasBinding = dataBindings.some(
        (b) => b.targetNode === task.id && b.targetPort === port.id,
      );
      if (!hasBinding) {
        result.push({
          taskId: task.id,
          portId: port.id,
          portName: port.name || port.id,
        });
      }
    }
  }

  return result;
}
