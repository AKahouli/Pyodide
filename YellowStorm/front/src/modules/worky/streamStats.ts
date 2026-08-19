import type { WorkyStreamStatus } from './types';

/**
 * Home-page status groupings. Every one of the 13 stream statuses belongs to
 * exactly one group — the dashboard's KPI tiles / filter chips are built from
 * these, and each chip filters the list by its group's status list.
 */
export const STREAM_STATUS_GROUPS = {
  active: ['created', 'planning', 'start_requested', 'active', 'partially_blocked'],
  attention: [
    'start_validation_failed',
    'waiting_for_owner',
    'waiting_for_human',
    'waiting_for_budget_decision',
  ],
  paused: ['paused', 'stopped'],
  completed: ['completed'],
  archived: ['archived'],
} satisfies Record<string, WorkyStreamStatus[]>;

export type StreamStatusGroup = keyof typeof STREAM_STATUS_GROUPS;

/**
 * Formats an accumulated active-duration (in minutes) as a compact elapsed
 * label: `45m`, `2h`, `2h 14m`.
 */
export function formatElapsedMinutes(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/** Sums the counts for the given statuses, treating absent keys as 0. */
export function sumStatusCounts(
  counts: Record<string, number>,
  statuses: readonly string[],
): number {
  return statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
}
