/**
 * Data Binding Serializer
 * Handles DataBinding ↔ visual representation conversion.
 * Data bindings are NOT persisted as React Flow edges — they are a separate
 * collection rendered as a data-layer overlay (toggleable via canvas toolbar).
 */

import type { DataBinding, PlaybookTask } from '../../types';

const TRIGGER_NODE_ID = '__trigger__';

export interface DataLayerEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  kind: string;
  iteration: string | null;
  label: string;
  details: string[];
  status: 'ok' | 'warning';
}

function getTaskPort(task: PlaybookTask | undefined, portId: string, direction: 'input' | 'output') {
  return direction === 'input'
    ? task?.inputPorts?.find((port) => port.id === portId)
    : task?.outputPorts?.find((port) => port.id === portId);
}

function getFallbackSourceHandle(task: PlaybookTask | undefined): string {
  return task?.outputPorts?.[0]?.id ?? 'default';
}

function formatConstantValue(value: unknown): string {
  if (!value || typeof value !== 'object') return 'constant';
  const obj = value as Record<string, unknown>;
  if ('kind' in obj && 'name' in obj) {
    const items = Array.isArray(value) ? value : [value];
    const names = items
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => `${item.name}`);
    return names.length > 0 ? names.join(', ') : 'constant';
  }
  return 'constant';
}

export function dataBindingsToLayerEdges(bindings: DataBinding[], tasks: PlaybookTask[]): DataLayerEdge[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  return bindings.map((db) => {
    const sourceTask = db.sourceNode ? tasksById.get(db.sourceNode) : undefined;
    const targetTask = tasksById.get(db.targetNode);
    const sourcePort = db.sourcePort ? getTaskPort(sourceTask, db.sourcePort, 'output') : undefined;
    const targetPort = getTaskPort(targetTask, db.targetPort, 'input');
    const hasTypeMismatch = Boolean(
      sourcePort?.artifactKind
      && targetPort?.artifactKind
      && sourcePort.artifactKind !== targetPort.artifactKind,
    );
    const hasMissingPort = db.sourceKind === 'node-output'
      ? !sourceTask || !sourcePort || !targetTask || !targetPort
      : !targetTask || !targetPort;
    const sourceLabel = db.sourceKind === 'node-output'
      ? `${sourceTask?.title || db.sourceNode || 'Unknown'}.${sourcePort?.name || db.sourcePort || 'default'}`
      : db.sourceKind === 'trigger'
        ? `trigger.${db.triggerPath || db.sourcePort || 'payload'}`
        : db.sourceKind === 'state'
          ? `state.${db.statePath || 'path'}`
          : db.sourceKind === 'constant'
            ? formatConstantValue(db.constantValue)
            : 'expression';
    const targetLabel = `${targetTask?.title || db.targetNode}.${targetPort?.name || db.targetPort}`;
    const artifactKind = targetPort?.artifactKind || sourcePort?.artifactKind || 'unknown';
    const details = [
      `${sourceLabel} -> ${targetLabel}`,
      `Kind: ${db.sourceKind}`,
      `Artifact: ${artifactKind}`,
      `Iteration: ${db.iteration ?? 'current'}`,
    ];

    if (hasMissingPort) {
      details.push('Warning: missing node or port');
    }
    if (hasTypeMismatch) {
      details.push('Warning: artifact type mismatch');
    }

    return {
      id: db.id,
      source: db.sourceKind === 'trigger'
        ? TRIGGER_NODE_ID
        : db.sourceNode || db.targetNode,
      sourceHandle: db.sourceKind === 'trigger'
        ? db.triggerPath || 'default'
        : db.sourcePort || getFallbackSourceHandle(targetTask),
      target: db.targetNode,
      targetHandle: db.targetPort,
      kind: db.sourceKind,
      iteration: db.iteration ?? null,
      label: `${db.sourceKind === 'trigger' ? 'trigger' : db.sourcePort || db.sourceKind} -> ${db.targetPort}`,
      details,
      status: hasMissingPort || hasTypeMismatch ? 'warning' : 'ok',
    };
  });
}


