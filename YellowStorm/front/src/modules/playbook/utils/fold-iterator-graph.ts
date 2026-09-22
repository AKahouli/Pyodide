import type { Edge, Node } from '@xyflow/react';

/** Presentation only: never pass this projection back to graph persistence. */
export function foldIteratorGraph(nodes: Node[], edges: Edge[], collapsedIds: ReadonlySet<string>) {
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
  const descendants = (id: string) => new Set(nodes.filter((node) => {
    let parent = node.parentId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      if (parent === id) return true;
      seen.add(parent);
      parent = parents.get(parent);
    }
    return false;
  }).map((node) => node.id));
  const foldable = new Set<string>();
  const hidden = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'playbookIteratorContainer') continue;
    const children = descendants(node.id);
    // Do not hide routes which bypass the iterator's explicit boundary ports.
    if (edges.some((edge) => children.has(edge.source) !== children.has(edge.target)
      && edge.source !== node.id && edge.target !== node.id)) continue;
    foldable.add(node.id);
    if (collapsedIds.has(node.id)) children.forEach((id) => hidden.add(id));
  }
  const collapsed = new Set([...collapsedIds].filter((id) => foldable.has(id)));
  return {
    collapsed,
    nodes: nodes.map((node) => ({
      ...node,
      hidden: node.hidden || hidden.has(node.id),
      ...(collapsed.has(node.id) ? { width: 320, height: 100, style: { ...node.style, width: 320, height: 100 } } : {}),
      data: { ...node.data, iteratorCollapsed: collapsed.has(node.id), iteratorFoldable: foldable.has(node.id) },
    })),
    edges: edges.map((edge) => ({ ...edge, hidden: edge.hidden || hidden.has(edge.source) || hidden.has(edge.target) })),
  };
}
