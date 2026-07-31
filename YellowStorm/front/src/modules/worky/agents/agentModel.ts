import type { Agent } from '../../agent/types';
import type { WorkyTask } from '../types';

export type WorkyAgentStatus = 'working' | 'blocked' | 'idle' | 'done';

export interface WorkyAgent {
  key: string;
  name: string;
  role: string;
  initials: string;
  colorSeed: string;
  status: WorkyAgentStatus;
  currentTask: WorkyTask | null;
  tasks: WorkyTask[];
  doneCount: number;
  totalCount: number;
}

const isDone = (t: WorkyTask): boolean => t.lane === 'done';
const isRunning = (t: WorkyTask): boolean => t.lane === 'running' || t.lane === 'review';
const isBlocked = (t: WorkyTask): boolean => t.lane === 'blocked';

/** Synthesize a per-agent "global status" from the lanes of that agent's tasks. */
export function deriveAgentStatus(tasks: WorkyTask[]): WorkyAgentStatus {
  if (tasks.some(isRunning)) return 'working';
  if (tasks.some(isBlocked)) return 'blocked';
  if (tasks.length > 0 && tasks.every(isDone)) return 'done';
  return 'idle';
}

/** Up to two uppercase word-initials from a display name. */
export function agentInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase();
}

/**
 * Group tasks by their `agentKey`, resolving each key to a real Agent for
 * display. Tasks with no `agentKey` are skipped (the caller surfaces them
 * separately). Never fabricates an agent: unresolved keys use the raw key as
 * the display name.
 */
export function groupTasksByAgent(
  tasks: WorkyTask[],
  resolve: (key: string) => Agent | undefined,
): WorkyAgent[] {
  const byKey = new Map<string, WorkyTask[]>();
  for (const t of tasks) {
    if (!t.agentKey) continue;
    const list = byKey.get(t.agentKey);
    if (list) list.push(t);
    else byKey.set(t.agentKey, [t]);
  }
  return [...byKey.entries()].map(([key, list]) => {
    const agent = resolve(key);
    const name = agent?.name ?? key;
    return {
      key,
      name,
      role: agent?.role ?? agent?.agentType?.name ?? '',
      initials: agentInitials(name),
      colorSeed: agent?.id ?? key,
      status: deriveAgentStatus(list),
      currentTask: list.find(isRunning) ?? list.find(isBlocked) ?? list[0] ?? null,
      tasks: list,
      doneCount: list.filter(isDone).length,
      totalCount: list.length,
    };
  });
}
