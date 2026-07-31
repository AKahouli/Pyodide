import { useMemo } from 'react';
import { useWorkyBoard } from '../store';
import { useAgentStore } from '../../agent/store';
import type { WorkyTask } from '../types';
import { groupTasksByAgent, type WorkyAgent } from './agentModel';

export interface StreamAgentsResult {
  /** Tasks grouped by their executor agent, with derived status + progress. */
  agents: WorkyAgent[];
  /** Tasks with no `agentKey` yet — surfaced by the caller in a fallback card. */
  ungrouped: WorkyTask[];
}

/**
 * Compose the current stream's board (Zustand mirror, kept live by SSE) with the
 * agent roster (`modules/agent` store) into agent-grouped views. Agent identity
 * is resolved by matching `task.agentKey` against an Agent's slug then name
 * (case-insensitive); unresolved keys keep the raw key as their name.
 */
export function useStreamAgents(): StreamAgentsResult {
  const board = useWorkyBoard();
  const agents = useAgentStore((s) => s.agents);

  const tasks = useMemo<WorkyTask[]>(() => (board ? Object.values(board).flat() : []), [board]);

  const resolve = useMemo(() => {
    const bySlug = new Map(agents.map((a) => [a.slug?.toLowerCase(), a]));
    const byName = new Map(agents.map((a) => [a.name.toLowerCase(), a]));
    return (key: string) => bySlug.get(key.toLowerCase()) ?? byName.get(key.toLowerCase());
  }, [agents]);

  return useMemo(
    () => ({
      agents: groupTasksByAgent(tasks, resolve),
      ungrouped: tasks.filter((t) => !t.agentKey),
    }),
    [tasks, resolve],
  );
}
