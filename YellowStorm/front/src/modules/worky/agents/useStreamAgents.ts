import { useEffect, useMemo } from 'react';
import { useWorkyBoard } from '../store';
import { useAgentStore } from '../../agent/store';
import type { WorkyTask } from '../types';
import { groupTasksByAgent, type WorkyAgent } from './agentModel';

export interface StreamAgentsResult {
  /** Tasks grouped by their executor agent, with derived status + progress. */
  agents: WorkyAgent[];
  /** Tasks with no `assigneeKey` yet — surfaced by the caller in a fallback card. */
  ungrouped: WorkyTask[];
}

/**
 * Compose the current stream's board (Zustand mirror, kept live by SSE) with the
 * agent roster (`modules/agent` store) into agent-grouped views. `assigneeKey` is
 * the agent's Mongo id (Electric `plan_steps.assignee`), so identity is resolved
 * by id first, then slug/name as a fallback; unresolved keys keep the raw key.
 * Ensures the roster is fetched so ids can be turned into names.
 */
export function useStreamAgents(): StreamAgentsResult {
  const board = useWorkyBoard();
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const isInitialized = useAgentStore((s) => s.isInitialized);

  useEffect(() => {
    if (!isInitialized) void fetchAgents();
  }, [isInitialized, fetchAgents]);

  const tasks = useMemo<WorkyTask[]>(() => (board ? Object.values(board).flat() : []), [board]);

  const resolve = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]));
    const bySlug = new Map(agents.map((a) => [a.slug?.toLowerCase(), a]));
    const byName = new Map(agents.map((a) => [a.name.toLowerCase(), a]));
    return (key: string) =>
      byId.get(key) ?? bySlug.get(key.toLowerCase()) ?? byName.get(key.toLowerCase());
  }, [agents]);

  return useMemo(
    () => ({
      agents: groupTasksByAgent(tasks, resolve),
      ungrouped: tasks.filter((t) => !t.assigneeKey),
    }),
    [tasks, resolve],
  );
}
