import Dagre from '@dagrejs/dagre';
import type { PlaybookTask, PlaybookEdge } from '../types';

const NODE_WIDTH = 384;
const NODE_HEIGHT = 160;
const NODE_SEP = 60;
const RANK_SEP = 100;

export function autoLayoutTasks(
  tasks: PlaybookTask[],
  edges: PlaybookEdge[],
): PlaybookTask[] {
  if (tasks.length === 0) return tasks;

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP });

  for (const task of tasks) {
    g.setNode(task.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.sourceId, edge.targetId);
  }

  Dagre.layout(g);

  return tasks.map((task) => {
    const pos = g.node(task.id);
    return {
      ...task,
      positionX: pos.x - NODE_WIDTH / 2,
      positionY: pos.y - NODE_HEIGHT / 2,
    };
  });
}
