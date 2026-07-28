import type { ArtifactKind, ControlEdge, PlaybookTask, DataBinding } from '../types';
import { getEffectiveNodeType } from './node-type';

export type PlaybookValidationReason =
  | 'missing_required_binding'
  | 'missing_node_output'
  | 'missing_trigger_path'
  | 'missing_state_path'
  | 'missing_constant_value'
  | 'missing_expression';

export interface PlaybookValidationIssue {
  id: string;
  taskId: string;
  taskName: string;
  portId: string;
  portName: string;
  artifactKind?: ArtifactKind;
  reason: PlaybookValidationReason;
}

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

function getIncompleteBindingReason(binding: DataBinding): PlaybookValidationReason {
  switch (binding.sourceKind) {
    case 'node-output': return 'missing_node_output';
    case 'trigger': return 'missing_trigger_path';
    case 'state': return 'missing_state_path';
    case 'constant': return 'missing_constant_value';
    case 'expression': return 'missing_expression';
    default: return 'missing_required_binding';
  }
}

export function getPlaybookValidationIssues(
  tasks: PlaybookTask[],
  dataBindings: DataBinding[],
  controlEdges: ControlEdge[] = [],
): PlaybookValidationIssue[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const issues: PlaybookValidationIssue[] = [];
  const representedTargets = new Set<string>();

  for (const binding of dataBindings) {
    if (isDataBindingResolved(binding)) continue;
    const task = taskById.get(binding.targetNode);
    const port = task?.inputPorts?.find((candidate) => candidate.id === binding.targetPort);
    const targetKey = `${binding.targetNode}:${binding.targetPort}`;
    if (representedTargets.has(targetKey)) continue;
    representedTargets.add(targetKey);
    issues.push({
      id: `binding:${binding.id}`,
      taskId: binding.targetNode,
      taskName: task?.title || binding.targetNode,
      portId: binding.targetPort,
      portName: port?.name || binding.targetPort,
      artifactKind: port?.artifactKind,
      reason: getIncompleteBindingReason(binding),
    });
  }

  for (const unboundPort of getUnboundRequiredPorts(tasks, dataBindings, controlEdges)) {
    const targetKey = `${unboundPort.taskId}:${unboundPort.portId}`;
    if (representedTargets.has(targetKey)) continue;
    const task = taskById.get(unboundPort.taskId);
    const port = task?.inputPorts?.find((candidate) => candidate.id === unboundPort.portId);
    issues.push({
      id: `required:${targetKey}`,
      taskId: unboundPort.taskId,
      taskName: task?.title || unboundPort.taskId,
      portId: unboundPort.portId,
      portName: unboundPort.portName,
      artifactKind: port?.artifactKind,
      reason: 'missing_required_binding',
    });
  }

  return issues;
}

export function getUnboundRequiredPorts(
  tasks: PlaybookTask[],
  dataBindings: DataBinding[],
  controlEdges: ControlEdge[] = [],
): UnboundPort[] {
  const result: UnboundPort[] = [];
  const routerIds = new Set(
    tasks.filter((task) => getEffectiveNodeType(task) === 'router').map((task) => task.id),
  );

  for (const task of tasks) {
    if (!task.inputPorts) continue;
    for (const port of task.inputPorts) {
      if (!port.required) continue;
      const hasBinding = dataBindings.some(
        (b) => b.targetNode === task.id && b.targetPort === port.id && isDataBindingResolved(b),
      );
      const hasRouterControlEdge = controlEdges.some((edge) => edge.kind === 'conditional'
        && routerIds.has(edge.source)
        && edge.target === task.id
        && (edge.targetInputPortId || 'default') === port.id);
      if (!hasBinding && !hasRouterControlEdge) {
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
  controlEdges: ControlEdge[] = [],
): UnboundPort[] {
  return getUnboundRequiredPorts(
    tasks,
    dataBindings,
    controlEdges,
  ).filter((port) => taskIds.has(port.taskId));
}
