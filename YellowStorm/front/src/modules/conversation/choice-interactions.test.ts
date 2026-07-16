import { describe, expect, it } from 'vitest';
import { buildChoiceInteractionIndex } from './choice-interactions';
import type { Message } from './types';

function userMessage(id: string, componentId: string, selectedOptions: string[]): Message {
  return {
    id,
    conversationId: 'conversation',
    conversationType: 'user',
    createdAt: '2026-07-11T00:00:00.000Z',
    interaction: {
      type: 'choice',
      componentId,
      questionId: 'question',
      selectionMode: 'single',
      selectedOptions: selectedOptions.map((optionId) => ({ optionId, label: optionId })),
    },
  };
}

describe('buildChoiceInteractionIndex', () => {
  it('indexes only user choice interactions and keeps the latest response', () => {
    const messages = [
      userMessage('first', 'choice-1', ['one']),
      { ...userMessage('ignored', 'choice-2', ['two']), conversationType: 'ai' as const },
      userMessage('latest', 'choice-1', ['two']),
    ];
    const index = buildChoiceInteractionIndex(messages);
    expect(index.size).toBe(1);
    expect(index.get('choice-1')?.selectedOptions[0]?.optionId).toBe('two');
  });
});
