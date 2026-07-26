import { describe, expect, it } from 'vitest';
import { getAnswerComponents } from './answer-version';

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
});
