export const CONVERSATION_DRAG_MIME = 'application/x-yellowstorm-conversation';

export interface ConversationDragPayload {
  conversationId: string;
  sourceProjectId: string | null;
}

export function encodeConversationDrag(payload: ConversationDragPayload): string {
  return JSON.stringify(payload);
}

export function decodeConversationDrag(raw: string | null): ConversationDragPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof parsed.conversationId !== 'string') return null;
    return {
      conversationId: parsed.conversationId,
      sourceProjectId: typeof parsed.sourceProjectId === 'string' ? parsed.sourceProjectId : null,
    };
  } catch {
    return null;
  }
}

export function hasConversationDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes(CONVERSATION_DRAG_MIME);
}
