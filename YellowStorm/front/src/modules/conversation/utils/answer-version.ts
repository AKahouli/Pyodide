import type { ActiveAnswerVersion, Message, MessageComponent } from '../types';

export function getAnswerComponents(message: Message, version: ActiveAnswerVersion, abstentionText: string): MessageComponent[] {
  if (version === 'corrected' && message.correctionWorkflow?.correctedComponents?.length) {
    return message.correctionWorkflow.correctedComponents;
  }
  if (version === 'abstention') {
    return [{ id: `${message.id}-abstention`, type: 'text', data: { content: abstentionText } }];
  }
  return message.components || [];
}
