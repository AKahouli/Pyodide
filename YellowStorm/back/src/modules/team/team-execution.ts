import { BadRequestException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';

export const MAX_EXECUTABLE_TEAM_NODES = 25;
export const MAX_EXECUTABLE_TEAM_DEPTH = 5;

export interface TeamExecutionNode {
  agentId: string;
  parentAgentId: string | null;
  order: number;
}

export interface TeamExecutionDefinition {
  teamId: string;
  nodes: TeamExecutionNode[];
}

export function validateExecutableTeam(
  nodes: TeamExecutionNode[],
  agents: { id: string; agentTypeSlug: string }[],
): TeamExecutionNode[] {
  const fail = (message: string): never => {
    throw new BadRequestException(ErrorCode.TEAM_NOT_EXECUTABLE, message);
  };

  if (nodes.length === 0) fail('The team has no members.');
  if (nodes.length > MAX_EXECUTABLE_TEAM_NODES) fail(`A team may contain at most ${MAX_EXECUTABLE_TEAM_NODES} agents.`);

  const nodeById = new Map(nodes.map((node) => [node.agentId, node]));
  if (nodeById.size !== nodes.length) fail('Each agent must appear exactly once.');

  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  if (agentById.size !== nodes.length || [...nodeById.keys()].some((id) => !agentById.has(id))) {
    fail('Every team member must reference an active agent.');
  }

  const roots = nodes.filter((node) => node.parentAgentId === null);
  if (roots.length !== 1) fail('An executable team must have exactly one root.');

  const children = new Map<string, TeamExecutionNode[]>();
  for (const node of nodes) {
    if (node.parentAgentId === node.agentId) fail('An agent cannot be its own parent.');
    if (node.parentAgentId && !nodeById.has(node.parentAgentId)) fail('Every parent must be a team member.');
    if (node.parentAgentId) {
      const siblings = children.get(node.parentAgentId) ?? [];
      siblings.push(node);
      children.set(node.parentAgentId, siblings);
    }
  }

  const ordered: TeamExecutionNode[] = [];
  const visited = new Set<string>();
  const queue: { node: TeamExecutionNode; depth: number }[] = [{ node: roots[0], depth: 1 }];
  while (queue.length) {
    const { node, depth } = queue.shift()!;
    if (visited.has(node.agentId)) fail('The team hierarchy must be acyclic.');
    if (depth > MAX_EXECUTABLE_TEAM_DEPTH) fail(`A team hierarchy may be at most ${MAX_EXECUTABLE_TEAM_DEPTH} levels deep.`);
    visited.add(node.agentId);
    ordered.push(node);
    const directChildren = (children.get(node.agentId) ?? []).sort((a, b) => a.order - b.order);
    queue.push(...directChildren.map((child) => ({ node: child, depth: depth + 1 })));
  }
  if (visited.size !== nodes.length) fail('Every team member must be reachable from the root.');

  for (const node of nodes) {
    if ((node.parentAgentId === null || children.has(node.agentId)) && agentById.get(node.agentId)?.agentTypeSlug !== 'manager') {
      fail('The root and every parent agent must have type manager.');
    }
  }
  return ordered;
}
