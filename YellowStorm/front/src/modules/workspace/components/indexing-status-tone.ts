/**
 * Tone of an indexing state.
 *
 * `inProgress`, `failed` and `done` carry distinct colours so a file's state is
 * readable at a glance; `idle` stays neutral because "not indexed yet" is not a
 * state the user has to act on.
 */
export type IndexingTone = 'inProgress' | 'failed' | 'done' | 'idle';

/**
 * Colours of an indexing state, shared by every status rendering of the module so
 * the dot, the label and the step schedule cannot drift apart.
 *
 * The text tones keep a readable contrast on the light and the dark canvas; the dot
 * tones are the solid colours of the status indicator.
 */
export const INDEXING_TONE: Record<IndexingTone, { text: string; dot: string }> = {
  inProgress: { text: 'text-orange-700 dark:text-orange-400', dot: 'bg-orange-500' },
  failed: { text: 'text-destructive', dot: 'bg-red-500' },
  done: { text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500' },
  idle: { text: 'text-muted-foreground', dot: 'bg-muted-foreground/40' },
};

/** The tone of a status filter value, including the "all statuses" entry. */
export function statusFilterTone(status: string): IndexingTone {
  if (status === 'failed') return 'failed';
  if (status === 'ready') return 'done';
  if (status === 'pending' || status === 'processing') return 'inProgress';
  return 'idle';
}
