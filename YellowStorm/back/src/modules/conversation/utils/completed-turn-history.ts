import type { MessageRecord } from '../persistence/message-store';
import type { ConversationHistoryEntry } from '../services/stream.service';
import { BadRequestException, ErrorCode } from '../../exceptions';
import { completedSourceContext } from './completed-source-context';

/** Seed only the visible transcript completed before this request was submitted. */
export function completedTurnHistory(messages: MessageRecord[], assistantMessageId: string): ConversationHistoryEntry[] {
  const origin = messages.find((message) => message.id === assistantMessageId);
  if (!origin) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Turn origin is unavailable');
  const submittedAt = messages.find((message) => message.id === origin.questionMessageId)?.createdAt ?? origin.createdAt;
  const beforeSubmission = (message: MessageRecord) => message.createdAt <= submittedAt
    && message.updatedAt <= submittedAt;
  const candidates = messages.filter((message) => message.conversationType === 'ai'
    && message.id !== origin.id && (!origin.questionMessageId || message.questionMessageId !== origin.questionMessageId)
    && message.isComplete && !message.isStreaming && beforeSubmission(message));
  // Default transcript shows the latest completed branch of each question.
  const latestAnswers = new Map<string, MessageRecord>();
  for (const message of candidates) {
    const key = message.questionMessageId ?? message.id;
    if (!latestAnswers.has(key) || latestAnswers.get(key)!.createdAt <= message.createdAt) latestAnswers.set(key, message);
  }
  const completed = [...latestAnswers.values()];
  const answeredQuestions = new Set(completed.map((message) => message.questionMessageId).filter(Boolean));
  const completedIds = new Set(completed.map((message) => message.id));
  const history: ConversationHistoryEntry[] = [];
  for (const message of messages) {
    if (message.id === origin.questionMessageId || message.id === origin.id) continue;
    if (message.conversationType === 'user' && answeredQuestions.has(message.id) && beforeSubmission(message)) {
      if (message.content?.trim()) history.push({ role: 'CONVERSATION_HISTORY_ROLE_USER', text: message.content.slice(0, 30_000) });
    } else if (completedIds.has(message.id)) {
      const components = message.correctionWorkflow?.activeVersion === 'corrected'
        ? message.correctionWorkflow.correctedComponents : message.components;
      const text = (components ?? []).filter((component) => component.type === 'text')
        .map((component) => typeof component.data.content === 'string' ? component.data.content
          : typeof component.data.text === 'string' ? component.data.text : '').filter(Boolean).join('\n\n').trim();
      const sources = completedSourceContext(components ?? []);
      if (text) history.push({ role: 'CONVERSATION_HISTORY_ROLE_ASSISTANT', text: text.slice(0, 30_000 - sources.length) + sources });
    }
  }
  return history.slice(-40);
}
