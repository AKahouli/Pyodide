import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { laneToOrch } from './status';
import type { WorkyTask } from './types';
import type { WorkyGraphNodeData } from './components/WorkyGraphNode';

/**
 * Turns the board's tasks into React Flow nodes/edges: one node per step,
 * one edge per resolvable `dependsOnStepIds` entry. `dependsOnStepIds`
 * refers to another task's `externalId` (the plan_steps.step_id), not its
 * Mongo `id` — a dependency outside this board's window (or predating the
 * field) resolves to nothing and is silently skipped rather than drawn
 * dangling.
 */
export function buildWorkyGraph(tasks: WorkyTask[]): { nodes: Node[]; edges: Edge[] } {
  const idByExternalId = new Map(
    tasks.filter((t) => t.externalId).map((t) => [t.externalId as string, t.id]),
  );

  const nodes: Node[] = tasks.map((task) => ({
    id: task.id,
    type: 'workyStep',
    position: { x: 0, y: 0 },
    data: {
      title: task.title,
      status: laneToOrch(task.lane),
      wave: task.wave,
    } satisfies WorkyGraphNodeData,
  }));

  const edges: Edge[] = [];
  tasks.forEach((task) => {
    (task.dependsOnStepIds ?? []).forEach((depStepId) => {
      const sourceId = idByExternalId.get(depStepId);
      if (!sourceId) return;
      edges.push({
        id: `${sourceId}->${task.id}`,
        source: sourceId,
        target: task.id,
        type: 'workyDependency',
        markerEnd: { type: MarkerType.ArrowClosed },
      });
    });
  });

  return { nodes, edges };
}

export function traceWorkyDependencies(edges: Edge[], taskId: string, direction: 'upstream' | 'downstream'): Set<string> {
  const visited = new Set([taskId]);
  const queue = [taskId];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of edges) {
      if (direction === 'upstream' && edge.target === current && !visited.has(edge.source)) {
        visited.add(edge.source);
        queue.push(edge.source);
      }
      if (direction === 'downstream' && edge.source === current && !visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return visited;
}
