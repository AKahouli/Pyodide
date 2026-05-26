/**
 * Cycle / Router Validator
 * Replaces wouldCreateCycle. Cycles are allowed only through router nodes
 * that have maxIterations > 0. Direct cycles between non-router nodes
 * are still rejected.
 */

import type { Edge } from '@xyflow/react';

export interface CycleValidatableNode {
  id: string;
  type?: string;
  data?: { kind?: string; nodeType?: string; routerConfig?: { maxIterations?: number } | null };
}

function buildAdjacency(edges: Edge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const children = adj.get(e.source) ?? [];
    children.push(e.target);
    adj.set(e.source, children);
  }
  return adj;
}

/**
 * Detects whether adding edge `source → target` would create a cycle.
 * Cycles are allowed only if a router node with maxIterations > 0 exists
 * on the cycle path.
 */
export function wouldCreateCycle(
  edges: Edge[],
  source: string,
  target: string,
  nodes?: CycleValidatableNode[],
): boolean {
  const adj = buildAdjacency(edges);
  const visited = new Set<string>();
  const queue = [target];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (current === source) {
      return nodes ? !hasCycleRouter(source, target, edges, nodes) : true;
    }
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adj.get(current) ?? []) {
      queue.push(neighbor);
    }
  }
  return false;
}

function hasCycleRouter(
  source: string,
  target: string,
  edges: Edge[],
  nodes: CycleValidatableNode[],
): boolean {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const isRouterWithMaxIterations = (nodeId: string): boolean => {
    const node = nodeMap.get(nodeId);
    if (!node) return false;
    const kind = node.data?.kind || node.data?.nodeType || node.type;
    if (kind !== 'router') return false;
    return (node.data?.routerConfig?.maxIterations ?? 0) > 0;
  };

  const adj = buildAdjacency(edges);
  const stack = [{ node: target, path: [target] }];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const { node: current, path } = stack.pop()!;
    if (current === source) return path.some(isRouterWithMaxIterations);
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adj.get(current) ?? []) {
      stack.push({ node: neighbor, path: [...path, neighbor] });
    }
  }
  return false;
}
