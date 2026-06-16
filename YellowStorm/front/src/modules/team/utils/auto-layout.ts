import Dagre from '@dagrejs/dagre';
import type { TeamMember } from '../types';

const NODE_WIDTH = 280;
const NODE_HEIGHT = 120;
const NODE_SEP = 60;
const RANK_SEP = 100;

export function autoLayoutMembers(members: TeamMember[]): TeamMember[] {
  if (members.length === 0) return members;

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: NODE_SEP, ranksep: RANK_SEP });

  for (const m of members) {
    g.setNode(m.agentId, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const m of members) {
    if (m.parentAgentId) {
      g.setEdge(m.parentAgentId, m.agentId);
    }
  }

  Dagre.layout(g);

  return members.map((m) => {
    const pos = g.node(m.agentId);
    return {
      ...m,
      positionX: pos.x - NODE_WIDTH / 2,
      positionY: pos.y - NODE_HEIGHT / 2,
    };
  });
}
