import { formatDistanceToNowStrict } from 'date-fns';
import { enUS, fr } from 'date-fns/locale';
import type { WorkyTask } from './types';

export type TaskTimeKind = 'created' | 'started' | 'done';

type TaskTimeInput = Pick<WorkyTask, 'lane' | 'createdAt' | 'updatedAt' | 'startedAt' | 'completedAt'>;

/**
 * The most meaningful timestamp to surface for a task, given its lane — with a
 * graceful fallback because manager-driven (Electric-synced) tasks never get
 * `startedAt`/`completedAt` set:
 *
 *  - done            → completedAt ?? updatedAt ?? createdAt   (kind 'done')
 *  - running/review  → startedAt   ?? updatedAt ?? createdAt   (kind 'started')
 *  - otherwise       → createdAt                                (kind 'created')
 *
 * Returns null when no usable timestamp exists.
 */
export function resolveTaskTime(task: TaskTimeInput): { kind: TaskTimeKind; iso: string } | null {
  if (task.lane === 'done') {
    const iso = task.completedAt ?? task.updatedAt ?? task.createdAt;
    return iso ? { kind: 'done', iso } : null;
  }
  if (task.lane === 'running' || task.lane === 'review') {
    const iso = task.startedAt ?? task.updatedAt ?? task.createdAt;
    return iso ? { kind: 'started', iso } : null;
  }
  return task.createdAt ? { kind: 'created', iso: task.createdAt } : null;
}

/** Relative time such as "5 minutes ago" / "il y a 5 minutes", localized by the
 *  app language. Returns '' for an unparseable timestamp. */
export function formatRelativeTime(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatDistanceToNowStrict(date, {
    addSuffix: true,
    locale: language.startsWith('fr') ? fr : enUS,
  });
}
