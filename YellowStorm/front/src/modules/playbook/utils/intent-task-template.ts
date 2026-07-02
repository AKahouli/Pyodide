import type { PlaybookIntentTaskDraft, TaskTemplate } from '../types';

export function isIntentIteratorTask(
  matchedTemplate: TaskTemplate | null,
  iteratorBody: PlaybookIntentTaskDraft['iteratorBody'] | undefined,
): boolean {
  return matchedTemplate?.nodeType === 'iterator'
    || Boolean(matchedTemplate?.iteratorConfig)
    || Boolean(iteratorBody?.steps.length);
}
