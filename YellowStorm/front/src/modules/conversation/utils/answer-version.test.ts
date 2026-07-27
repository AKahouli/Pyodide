import { describe, expect, it } from 'vitest';
import { getAnswerComponents, getAnswerEvaluation, getDefaultAnswerVersion } from './answer-version';

const message = {
  id: 'message-1', conversationId: 'conversation-1', conversationType: 'ai' as const, createdAt: '2026-07-26T00:00:00.000Z',
  components: [{ id: 'text-1', type: 'text' as const, data: { content: 'Original' } }],
  correctionWorkflow: {
    mode: 'corrective_transparent' as const, status: 'corrected' as const, activeVersion: 'corrected' as const,
    threshold: 70, attemptCount: 1, maxAttempts: 1, failureBehavior: 'publish_with_warning' as const,
    showOriginalAnswer: true, queuedAt: '2026-07-26T00:00:00.000Z',
    correctedComponents: [{ id: 'text-1', type: 'text' as const, data: { content: 'Corrected' } }],
  },
};

describe('getAnswerComponents', () => {
  it('selects original, corrected, and abstention versions without mutating the message', () => {
    expect(getAnswerComponents(message, 'original', 'Withheld')[0].data.content).toBe('Original');
    expect(getAnswerComponents(message, 'corrected', 'Withheld')[0].data.content).toBe('Corrected');
    expect(getAnswerComponents(message, 'abstention', 'Withheld')[0].data.content).toBe('Withheld');
    expect(message.components[0].data.content).toBe('Original');
  });

  it('selects rejected attempts while keeping the policy default on the original', () => {
    const withAttempt = {
      ...message,
      reliabilityEvaluation: { status: 'completed' as const, score: 30 },
      correctionWorkflow: {
        ...message.correctionWorkflow,
        status: 'failed' as const,
        activeVersion: 'original' as const,
        attempts: [{
          attemptId: 'attempt-1', attemptNumber: 1, status: 'rejected' as const, decision: 'rejected' as const,
          policyReasons: ['score_below_threshold' as const], createdAt: '2026-07-26T00:00:01.000Z',
          components: [{ id: 'attempt-text', type: 'text' as const, data: { content: 'Generated candidate' } }],
          evaluation: { status: 'completed' as const, score: 52 },
        }],
      },
    };
    expect(getDefaultAnswerVersion(withAttempt)).toBe('original');
    expect(getAnswerComponents(withAttempt, 'attempt:attempt-1', 'Withheld')[0].data.content).toBe('Generated candidate');
    expect(getAnswerEvaluation(withAttempt, 'attempt:attempt-1')?.score).toBe(52);
  });

  it('does not substitute the original evaluation when a selected attempt has no evaluation', () => {
    const withFailedAttempt = {
      ...message,
      reliabilityEvaluation: { status: 'completed' as const, score: 30 },
      correctionWorkflow: {
        ...message.correctionWorkflow,
        attempts: [{
          attemptId: 'attempt-1', attemptNumber: 1, status: 'failed' as const, decision: 'failed' as const,
          policyReasons: ['candidate_generation_failed' as const], createdAt: '2026-07-26T00:00:01.000Z',
          components: [{ id: 'attempt-text', type: 'text' as const, data: { content: 'Generated candidate' } }],
        }],
      },
    };
    expect(getAnswerEvaluation(withFailedAttempt, 'attempt:attempt-1')).toBeUndefined();
  });
});
