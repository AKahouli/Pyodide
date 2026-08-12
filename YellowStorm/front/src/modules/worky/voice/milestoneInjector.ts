import { subscribeToStreamEvents } from '../stream/sse';
import type { WorkyEvent } from '../types';

/**
 * Maps a worky stream event to a short spoken-update string the concierge can
 * verbalize, or null for non-milestone (noisy) events. Filtered to milestones:
 * plan created, step completed, report ready, and the manager's final answer.
 */
export function milestoneText(event: WorkyEvent): string | null {
  switch (event.type) {
    case 'plan.version.created':
      return '[worky update: I have a plan and I am starting.]';
    case 'task.completed':
      return '[worky update: a step just finished.]';
    case 'report.generated':
      return '[worky update: the report is ready.]';
    case 'message.appended': {
      const payload = (event.data as { payload?: { role?: string; content?: string } }).payload;
      if (payload?.role === 'manager' && payload.content) return `[worky update: ${payload.content}]`;
      return null;
    }
    default:
      return null;
  }
}

/**
 * Subscribes to the stream's SSE events and injects milestone updates via the
 * provided callback (which forwards them into the live voice session as text).
 * Returns an unsubscribe.
 */
export function attachMilestoneInjector(streamId: string, inject: (text: string) => void): () => void {
  return subscribeToStreamEvents(streamId, (event) => {
    const text = milestoneText(event);
    if (text) inject(text);
  });
}
