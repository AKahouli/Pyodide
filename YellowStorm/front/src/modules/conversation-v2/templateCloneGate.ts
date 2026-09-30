import type { AgentEvent } from './types';
import { isTemplateRevisionId } from './template-revision';

/** True when events already include a user turn (first edit already started). */
export function hasUserMessage(events: AgentEvent[]): boolean {
  return events.some((ev) => ev.type === 'message' && ev.role === 'user');
}

export function isTemplateCloneNavigation(state: {
  source?: string;
  templateId?: string;
  initialMessage?: string;
} | null | undefined): boolean {
  if (!state) return false;
  return (
    state.source === 'template-clone' ||
    Boolean(state.templateId && !state.initialMessage)
  );
}

/**
 * Clone App / reload: wait for NodePod and keep Send disabled until ready.
 * Never auto-stream; the user must send the first message explicitly.
 */
export function shouldGateTemplateClonePreview(input: {
  isTemplateCloneSession: boolean;
  hasInitialMessage: boolean;
  hasUserMessage: boolean;
  canWrite: boolean;
}): boolean {
  if (!input.canWrite) return false;
  if (!input.isTemplateCloneSession) return false;
  if (input.hasInitialMessage) return false;
  if (input.hasUserMessage) return false;
  return true;
}

export function isTemplateCloneSession(input: {
  latchedFromNav: boolean;
  starterRevisionId: string | null | undefined;
}): boolean {
  return input.latchedFromNav || isTemplateRevisionId(input.starterRevisionId);
}
