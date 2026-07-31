import Dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 88;
const NODE_SEP = 40;
const RANK_SEP = 120;

/**
 * Generic dagre layout for compact (fixed-size) React Flow nodes, e.g. the
 * Worky dependency graph. Unlike `autoLayoutTasks`, this has no notion of
 * playbook-specific concerns (iterators, per-task dimensions) — every node
 * is laid out at the same size.
 */
export function layoutCompactCanvasNodes(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  Dagre.layout(g);

  return nodes.map((node) => {
    const position = g.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
      },
    };
  });
}
