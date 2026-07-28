import type { DisplayedAnswerVersion, Message, MessageComponent, ReliabilityEvaluation } from '../types';

export function attemptVersion(attemptId: string): DisplayedAnswerVersion {
  return `attempt:${attemptId}`;
}

function selectedAttempt(message: Message, version: DisplayedAnswerVersion) {
  if (!version.startsWith('attempt:')) return undefined;
  return message.correctionWorkflow?.attempts?.find((attempt) => attempt.attemptId === version.slice('attempt:'.length));
}

export function getDefaultAnswerVersion(message: Message): DisplayedAnswerVersion {
  const workflow = message.correctionWorkflow;
  if (workflow?.activeVersion === 'corrected' && workflow.publishedAttemptId) return attemptVersion(workflow.publishedAttemptId);
  return workflow?.activeVersion || 'original';
}

export function getAnswerComponents(message: Message, version: DisplayedAnswerVersion, abstentionText: string): MessageComponent[] {
  const attempt = selectedAttempt(message, version);
  if (attempt?.components?.length) return attempt.components;
  if (version === 'corrected' && message.correctionWorkflow?.correctedComponents?.length) {
    return message.correctionWorkflow.correctedComponents;
  }
  if (version === 'abstention') {
    return [{ id: `${message.id}-abstention`, type: 'text', data: { content: abstentionText } }];
  }
  return message.components || [];
}

export function getAnswerEvaluation(message: Message, version: DisplayedAnswerVersion): ReliabilityEvaluation | undefined {
  const attempt = selectedAttempt(message, version);
  if (attempt) return attempt.evaluation;
  return version === 'corrected' ? message.correctionWorkflow?.finalReliabilityEvaluation : message.reliabilityEvaluation;
}
