/**
 * Shared classification for the free-form `status` strings carried by tool,
 * step and plan events.
 *
 * The SSE contract types these as plain `string`, so every consumer would
 * otherwise re-derive "is this done yet?" with a different set of string
 * comparisons. Classifying once, defensively, keeps the conversation visuals
 * consistent and means a new backend status degrades to a neutral dot instead
 * of rendering as "still running" forever.
 */

export type ActivityStatus = 'pending' | 'running' | 'success' | 'error';

const SUCCESS = new Set(['completed', 'complete', 'done', 'success', 'succeeded', 'ok']);
const RUNNING = new Set(['running', 'calling', 'in_progress', 'in-progress', 'started', 'active']);
const ERROR = new Set(['error', 'failed', 'failure', 'cancelled', 'canceled', 'aborted', 'timeout']);

export function classifyStatus(status: string | null | undefined): ActivityStatus {
  const value = (status ?? '').trim().toLowerCase();
  if (SUCCESS.has(value)) return 'success';
  if (ERROR.has(value)) return 'error';
  if (RUNNING.has(value)) return 'running';
  // `pending`, `queued`, `waiting`, and anything unrecognised.
  return 'pending';
}

/**
 * Colour for the status dot/pill. Uses semantic tokens only, so it stays
 * correct across the COLOR_THEMES (never a raw blue/green/red literal).
 */
export const ACTIVITY_TONE_CLASS: Record<ActivityStatus, string> = {
  pending: 'border-muted-foreground/40 text-muted-foreground',
  running: 'border-primary/50 text-primary',
  success: 'border-ok/50 text-ok',
  error: 'border-fail/50 text-fail',
};
