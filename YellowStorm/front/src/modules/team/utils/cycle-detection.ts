import type { TeamMember } from '../types';

/**
 * Returns true if setting parentAgentId on childId would create a cycle.
 */
export function wouldCreateCycle(
  members: TeamMember[],
  childId: string,
  newParentId: string,
): boolean {
  if (childId === newParentId) return true;

  // Build parent map: agentId -> parentAgentId
  const parentMap = new Map<string, string | null>();
  for (const m of members) {
    parentMap.set(m.agentId, m.parentAgentId);
  }

  // Temporarily apply the change
  parentMap.set(childId, newParentId);

  // Walk up from newParentId; if we reach childId, it's a cycle
  const visited = new Set<string>();
  let current: string | null = newParentId;
  while (current) {
    if (current === childId) return true;
    if (visited.has(current)) return true;
    visited.add(current);
    current = parentMap.get(current) ?? null;
  }

  return false;
}
