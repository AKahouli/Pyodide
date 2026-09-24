import type { WorkyTask } from '../types';

export type TaskSnapshot = Record<string, { lane: WorkyTask['lane']; updatedAt: string | null }>;

export function snapshotTasks(tasks: WorkyTask[]): TaskSnapshot {
  return Object.fromEntries(tasks.map((task) => [task.id, { lane: task.lane, updatedAt: task.updatedAt ?? null }]));
}

export function changedTasks(tasks: WorkyTask[], previous: TaskSnapshot): WorkyTask[] {
  return tasks.filter((task) => {
    const before = previous[task.id];
    return !before || before.lane !== task.lane || before.updatedAt !== (task.updatedAt ?? null);
  }).sort((a, b) => (Date.parse(b.updatedAt ?? b.completedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? a.completedAt ?? '') || 0));
}
