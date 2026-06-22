import Dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';

const COMPACT_NODE_WIDTH = 180;
const COMPACT_NODE_HEIGHT = 84;
const COMPACT_NODE_SEP = 64;
const COMPACT_RANK_SEP = 112;

export function layoutCompactCanvasNodes(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;

  const nodeIds = new Set(nodes.map((node) => node.id));
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: COMPACT_NODE_SEP, ranksep: COMPACT_RANK_SEP });

  for (const node of nodes) {
    g.setNode(node.id, { width: COMPACT_NODE_WIDTH, height: COMPACT_NODE_HEIGHT });
  }

  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  Dagre.layout(g);

  return nodes.map((node) => {
    const position = g.node(node.id);
    if (!position) return node;
    return {
      ...node,
      position: {
        x: position.x - COMPACT_NODE_WIDTH / 2,
        y: position.y - COMPACT_NODE_HEIGHT / 2,
      },
    };
  });
}
