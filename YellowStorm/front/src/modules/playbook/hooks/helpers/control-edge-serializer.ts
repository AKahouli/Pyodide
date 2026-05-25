/**
 * Control Edge Serializer
 * Converts between ControlEdge/PlaybookEdge and React Flow Edge representations.
 */

import type { Edge } from '@xyflow/react';
import type { PlaybookEdge, PlaybookTask, ControlEdge, FlowNode } from '../../types';
import { getEffectiveNodeType } from '../../utils/node-type';

// ---- Legacy: PlaybookEdge ↔ React Flow Edge ----

function migrateEdgeOutputPortId(edge: Partial<PlaybookEdge>): string {
  return edge.sourceOutputPortId || 'default';
}

function migrateEdgeInputPortId(edge: Partial<PlaybookEdge>): string {
  return edge.targetInputPortId || 'default';
}

export function migrateEdge(edge: Partial<PlaybookEdge>): PlaybookEdge {
  return {
    id: edge.id ?? '',
    sourceId: edge.sourceId ?? '',
    targetId: edge.targetId ?? '',
    sourceOutputPortId: migrateEdgeOutputPortId(edge),
    targetInputPortId: migrateEdgeInputPortId(edge),
  };
}

export function remapIteratorEdgePorts(
  edge: PlaybookEdge,
  tasks: PlaybookTask[],
): PlaybookEdge {
  const sourceTask = tasks.find((t) => t.id === edge.sourceId);
  const targetTask = tasks.find((t) => t.id === edge.targetId);

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

export function playbookEdgesToFlowEdges(
  edges: PlaybookEdge[],
  tasks: PlaybookTask[],
): Edge[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  return edges
    .filter((e) => e.sourceId !== e.targetId)
    .map((edge) => {
      const normalized = remapIteratorEdgePorts(edge, tasks);
      const sourceTask = taskMap.get(normalized.sourceId);
      const sourceType = sourceTask ? getEffectiveNodeType(sourceTask) : null;
      const isRouterSource = sourceType === 'router';
      const routerLabel = isRouterSource ? normalized.sourceOutputPortId : null;
      const isErrorEdge = routerLabel === '__error__';

      return {
        id: normalized.id,
        source: normalized.sourceId,
        target: normalized.targetId,
        sourceHandle: normalized.sourceOutputPortId || undefined,
        targetHandle: normalized.targetInputPortId || undefined,
        type: isRouterSource ? 'conditional' : 'animated',
        animated: !isRouterSource,
        data: {
          sourceOutputPortId: normalized.sourceOutputPortId || 'default',
          targetInputPortId: normalized.targetInputPortId || 'default',
          isTypeMatch: undefined,
          routerLabel,
        },
        style: isRouterSource
          ? {
              strokeDasharray: '6 4',
              ...(isErrorEdge ? { stroke: 'var(--destructive)' } : {}),
            }
          : undefined,
      };
    });
}

export function flowEdgesToPlaybookEdges(edges: Edge[]): PlaybookEdge[] {
  return edges.map((edge) => {
    const data = (edge.data || {}) as Record<string, unknown>;
    return migrateEdge({
      id: edge.id,
      sourceId: edge.source,
      targetId: edge.target,
      sourceOutputPortId: data.sourceOutputPortId as string | undefined,
      targetInputPortId: data.targetInputPortId as string | undefined,
    });
  });
}

// ---- New: ControlEdge ↔ React Flow Edge ----

function buildControlEdgeId(source: string, target: string, routerLabel?: string): string {
  const base = `${source}->${target}`;
  return routerLabel ? `ce-${base}#${routerLabel}` : `ce-${base}`;
}

export function controlEdgesToFlowEdges(controlEdges: ControlEdge[]): Edge[] {
  return controlEdges
    .filter((ce) => ce.source !== ce.target)
    .map((ce) => {
      const isConditional = ce.kind === 'conditional';
      const sourceOutputPortId = ce.sourceOutputPortId ?? ce.routerLabel ?? 'default';
      const targetInputPortId = ce.targetInputPortId ?? 'default';
      return {
        id: ce.id || buildControlEdgeId(ce.source, ce.target, ce.routerLabel),
        source: ce.source,
        target: ce.target,
        sourceHandle: sourceOutputPortId,
        targetHandle: targetInputPortId,
        type: isConditional ? 'conditional' : 'sequential',
        animated: !isConditional,
        data: {
          kind: ce.kind,
          routerLabel: ce.routerLabel ?? null,
          sourceOutputPortId,
          targetInputPortId,
          priority: ce.priority ?? null,
        },
        style: isConditional
          ? {
              strokeDasharray: '6 4',
              ...(ce.routerLabel === '__error__' ? { stroke: 'var(--destructive)' } : {}),
            }
          : undefined,
      } as Edge;
    });
}

export function flowEdgesToControlEdges(edges: Edge[]): ControlEdge[] {
  return edges.map((edge) => {
    const data = (edge.data || {}) as Record<string, unknown>;
    const isConditional = edge.type === 'conditional' || data.kind === 'conditional';
    const sourceOutputPortId = (data.sourceOutputPortId as string) || edge.sourceHandle || 'default';
    const targetInputPortId = (data.targetInputPortId as string) || edge.targetHandle || 'default';

    return {
      id: edge.id,
      kind: isConditional ? 'conditional' : 'sequential',
      source: edge.source,
      target: edge.target,
      routerLabel: isConditional ? ((data.routerLabel as string) || sourceOutputPortId) : undefined,
      sourceOutputPortId,
      targetInputPortId,
      priority: (data.priority as number) || undefined,
    };
  });
}

// ---- Intent Edge Port Resolution ----

export interface ResolvedIntentEdgePorts {
  sourceOutputPortId: string;
  targetInputPortId: string;
}

function artifactKindsCompatible(
  sourceKind?: string | null,
  targetKind?: string | null,
): boolean {
  if (!sourceKind || !targetKind) return true;
  return sourceKind === targetKind;
}

function getPreferredIntentInputPortId(task: PlaybookTask, index = 0): string {
  return task.inputPorts?.[index]?.id || task.inputPorts?.[0]?.id || 'default';
}

function getPreferredIntentOutputPortId(task: PlaybookTask): string {
  return task.outputPorts?.[0]?.id || 'default';
}

export function resolveIntentEdgePorts(
  sourceTask: PlaybookTask,
  targetTask: PlaybookTask,
  suggestedOutputPortId?: string | null,
  suggestedInputPortId?: string | null,
): ResolvedIntentEdgePorts | null {
  const outputPorts = sourceTask.outputPorts || [];
  const inputPorts = targetTask.inputPorts || [];
  const suggestedOutput = outputPorts.find((p) => p.id === suggestedOutputPortId) || null;
  const suggestedInput = inputPorts.find((p) => p.id === suggestedInputPortId) || null;

  if (suggestedOutput && suggestedInput) {
    if (artifactKindsCompatible(suggestedOutput.artifactKind, suggestedInput.artifactKind)) {
      return { sourceOutputPortId: suggestedOutput.id, targetInputPortId: suggestedInput.id };
    }
  }

  if (suggestedOutput) {
    const match = inputPorts.find((p) =>
      artifactKindsCompatible(suggestedOutput.artifactKind, p.artifactKind),
    );
    if (match) return { sourceOutputPortId: suggestedOutput.id, targetInputPortId: match.id };
  }

  if (suggestedInput) {
    const match = outputPorts.find((p) =>
      artifactKindsCompatible(p.artifactKind, suggestedInput.artifactKind),
    );
    if (match) return { sourceOutputPortId: match.id, targetInputPortId: suggestedInput.id };
  }

  for (const op of outputPorts) {
    const match = inputPorts.find((p) =>
      artifactKindsCompatible(op.artifactKind, p.artifactKind),
    );
    if (match) return { sourceOutputPortId: op.id, targetInputPortId: match.id };
  }

  if (outputPorts.length === 0 && inputPorts.length === 0) {
    return { sourceOutputPortId: 'default', targetInputPortId: 'default' };
  }

  if (outputPorts.length === 0) {
    return {
      sourceOutputPortId: 'default',
      targetInputPortId: suggestedInput?.id || getPreferredIntentInputPortId(targetTask),
    };
  }

  if (inputPorts.length === 0) {
    return {
      sourceOutputPortId: suggestedOutput?.id || getPreferredIntentOutputPortId(sourceTask),
      targetInputPortId: 'default',
    };
  }

  return null;
}

export function edgeMatchesIntentPortPair(
  edge: Pick<PlaybookEdge, 'sourceId' | 'targetId' | 'sourceOutputPortId' | 'targetInputPortId'>,
  sourceId: string,
  targetId: string,
  sourceOutputPortId?: string | null,
  targetInputPortId?: string | null,
): boolean {
  return (
    edge.sourceId === sourceId &&
    edge.targetId === targetId &&
    (sourceOutputPortId == null || edge.sourceOutputPortId === sourceOutputPortId) &&
    (targetInputPortId == null || edge.targetInputPortId === targetInputPortId)
  );
}

export {
  getPreferredIntentInputPortId,
  getPreferredIntentOutputPortId,
};
