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
 *
 * Also returns `edges`, each annotated with dagre's own routed waypoints
 * (`data.dagrePoints`). An edge spanning more than one rank (e.g. a step
 * that depends directly on something several ranks back) would otherwise
 * be drawn as a straight/bezier line between just its two endpoints —
 * which, purely by coincidence of where dagre placed same-rank nodes in
 * between, can visually pass right behind an unrelated node and look like
 * a connection to it. Dagre already computes a path that routes around
 * intermediate-rank nodes (via internal dummy nodes); we just have to keep
 * it instead of discarding it, so the edge renderer (WorkyDependencyEdge)
 * can draw the real routed path.
 */
export function layoutCompactCanvasNodes(nodes: Node[], edges: Edge[], size = { width: NODE_WIDTH, height: NODE_HEIGHT }): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP });

  for (const node of nodes) {
    g.setNode(node.id, { width: size.width, height: size.height });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  Dagre.layout(g);

  const laidOutNodes = nodes.map((node) => {
    const position = g.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - size.width / 2,
        y: position.y - size.height / 2,
      },
    };
  });

  const routedEdges = edges.map((edge) => {
    const dagrePoints = g.edge(edge.source, edge.target)?.points;
    return dagrePoints ? { ...edge, data: { ...edge.data, dagrePoints } } : edge;
  });

  return { nodes: laidOutNodes, edges: routedEdges };
}
