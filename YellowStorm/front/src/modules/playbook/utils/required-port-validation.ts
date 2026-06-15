import type { PlaybookTask, DataBinding } from '../types';

export interface UnboundPort {
  taskId: string;
  portId: string;
  portName: string;
}

export function isDataBindingResolved(binding: DataBinding): boolean {
  switch (binding.sourceKind) {
    case 'node-output':
      return Boolean(binding.sourceNode && binding.sourcePort);
    case 'trigger':
      return Boolean(binding.triggerPath?.trim());
    case 'state':
      return Boolean(binding.statePath?.trim());
    case 'constant': {
      if (binding.constantValue === undefined) return false;
      if (typeof binding.constantValue === 'string') return binding.constantValue !== '';
      if (typeof binding.constantValue === 'object' && binding.constantValue !== null) {
        const obj = binding.constantValue as Record<string, unknown>;
        if (typeof obj.text === 'string') return obj.text.trim() !== '';
        return true;
      }
      return false;
    }
    case 'expression':
      return Boolean(binding.expression?.trim());
    default:
      return false;
  }
}

export function hasIncompleteDataBindings(dataBindings: DataBinding[]): boolean {
  return dataBindings.some((binding) => !isDataBindingResolved(binding));
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
        (b) => b.targetNode === task.id && b.targetPort === port.id && isDataBindingResolved(b),
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

export function getUnboundRequiredPortsForTaskIds(
  tasks: PlaybookTask[],
  dataBindings: DataBinding[],
  taskIds: Set<string>,
): UnboundPort[] {
  return getUnboundRequiredPorts(
    tasks.filter((task) => taskIds.has(task.id)),
    dataBindings,
  );
}
