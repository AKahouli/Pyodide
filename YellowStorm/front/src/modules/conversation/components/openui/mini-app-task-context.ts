import { createContext, type ContextType } from 'react';
import type { Message } from '../../types';

export const MiniAppTaskContext = createContext<{ conversationId: string; actorId: string; messageId: string; componentId: string; programDigest: string;
  stateRevision: number; dirty: boolean;
  running?: { formName: string; answerId?: string }; cancel: (answerId: string) => Promise<void> } | null>(null);

export function findMiniAppTask(messages: Message[], scope: NonNullable<ContextType<typeof MiniAppTaskContext>>, formName: string) {
  return messages.filter(message => message.conversationId === scope.conversationId && message.conversationType === 'user'
    && message.senderId === scope.actorId && message.interaction?.type === 'openui'
    && message.interaction.sourceMessageId === scope.messageId && message.interaction.componentId === scope.componentId
    && message.interaction.appTask?.programDigest === scope.programDigest && message.interaction.formName === formName)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
}
