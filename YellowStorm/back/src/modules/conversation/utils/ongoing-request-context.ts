import type { MessageRecord } from '../persistence/message-store';

export interface OngoingRequestContext {
  ongoing_requests_observed_at: string;
  ongoing_requests: Array<{ question_message_id: string; assistant_message_ids: string[]; request_excerpt: string; submitted_at: string }>;
}

/** Awareness of sibling requests, without importing their unfinished answers. */
export function ongoingRequestContext(messages: MessageRecord[], assistantMessageId: string,
  conversationId: string, observedAt = new Date()): OngoingRequestContext | undefined {
  const local = messages.filter((message) => message.conversationId === conversationId);
  const origin = local.find((message) => message.id === assistantMessageId);
  if (!origin) return undefined;
  const questions = new Map(local.filter((message) => message.conversationType === 'user').map((message) => [message.id, message]));
  const submittedAt = questions.get(origin.questionMessageId ?? '')?.createdAt ?? origin.createdAt;
  const ongoing = new Map<string, MessageRecord>();
  const replies = new Map<string, string[]>();
  for (const answer of local) {
    if (answer.id === origin.id || answer.conversationType !== 'ai' || answer.isComplete || !answer.isStreaming
      || !answer.streamExecutionLeaseId || !answer.streamExecutionLeaseExpiresAt
      || answer.streamExecutionLeaseExpiresAt <= observedAt || answer.questionMessageId === origin.questionMessageId) continue;
    const question = questions.get(answer.questionMessageId ?? '');
    if (question?.content?.trim() && question.createdAt <= submittedAt && question.updatedAt <= submittedAt) {
      ongoing.set(question.id, question);
      replies.set(question.id, [...(replies.get(question.id) ?? []), answer.id].slice(0, 8));
    }
  }
  const requests = [...ongoing.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 8)
    .map((question) => ({ question_message_id: question.id, assistant_message_ids: replies.get(question.id)!, request_excerpt: question.content!.trim().slice(0, 800),
      submitted_at: question.createdAt.toISOString() }));
  return requests.length ? { ongoing_requests_observed_at: observedAt.toISOString(), ongoing_requests: requests } : undefined;
}
