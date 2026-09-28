import { ControlEdge } from '../models/playbook-flow.model';

export function buildAdjacency(edges: ControlEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.source) ?? [];
    targets.push(edge.target);
    adjacency.set(edge.source, targets);
  }
  return adjacency;
}

export function canReachTarget(
  adjacency: Map<string, string[]>,
  sourceNode: string,
  targetNode: string,
): boolean {
  if (sourceNode === targetNode) return true;

  const queue = [sourceNode];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    for (const next of adjacency.get(current) ?? []) {
      if (next === targetNode) {
        return true;
      }
      if (!seen.has(next)) {
        queue.push(next);
      }
    }
  }

  return false;
}

export function findCycleComponents(nodeIds: string[], edges: ControlEdge[]): string[][] {
  const adjacency = buildAdjacency(edges);
  const indexByNode = new Map<string, number>();
  const lowLinkByNode = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let index = 0;

  const visit = (nodeId: string) => {
    indexByNode.set(nodeId, index);
    lowLinkByNode.set(nodeId, index);
    index += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const next of adjacency.get(nodeId) ?? []) {
      if (!indexByNode.has(next)) {
        visit(next);
        lowLinkByNode.set(nodeId, Math.min(lowLinkByNode.get(nodeId)!, lowLinkByNode.get(next)!));
      } else if (onStack.has(next)) {
        lowLinkByNode.set(nodeId, Math.min(lowLinkByNode.get(nodeId)!, indexByNode.get(next)!));
      }
    }

    if (lowLinkByNode.get(nodeId) !== indexByNode.get(nodeId)) {
      return;
    }

    const component: string[] = [];
    let current: string | undefined;
    do {
      current = stack.pop();
      if (!current) break;
      onStack.delete(current);
      component.push(current);
    } while (current !== nodeId);

    const hasSelfLoop = (adjacency.get(nodeId) ?? []).includes(nodeId);
    if (component.length > 1 || hasSelfLoop) {
      components.push(component);
    }
  };

  for (const nodeId of nodeIds) {
    if (!indexByNode.has(nodeId)) {
      visit(nodeId);
    }
  }

  return components;
}

export function isNodeInCycle(nodeId: string, edges: ControlEdge[]): boolean {
  return findCycleComponents([nodeId, ...edges.flatMap((edge) => [edge.source, edge.target])], edges)
    .some((component) => component.includes(nodeId));
}

export function hasCycleWithinNodes(nodeIds: Set<string>, edges: ControlEdge[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }
    const targets = adjacency.get(edge.source) ?? [];
    targets.push(edge.target);
    adjacency.set(edge.source, targets);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();

  const dfs = (nodeId: string): boolean => {
    visited.add(nodeId);
    stack.add(nodeId);

    for (const next of adjacency.get(nodeId) ?? []) {
      if (!visited.has(next) && dfs(next)) {
        return true;
      }
      if (stack.has(next)) {
        return true;
      }
    }

    stack.delete(nodeId);
    return false;
  };

  for (const nodeId of nodeIds) {
    if (!visited.has(nodeId) && dfs(nodeId)) {
      return true;
    }
  }

  return false;
}
