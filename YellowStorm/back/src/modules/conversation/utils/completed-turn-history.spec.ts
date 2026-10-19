import { completedTurnHistory, completedTurnSeed } from './completed-turn-history';
import type { MessageRecord } from '../persistence/message-store';

describe('completed turn history', () => {
  const message = (id: string, type: 'user' | 'ai', time: number, extra: Partial<MessageRecord> = {}): MessageRecord => ({
    id, conversationId: 'conversation', conversationType: type, createdAt: new Date(time), updatedAt: new Date(time),
    isComplete: type === 'ai', isStreaming: false, isEdited: false, webSearchEnabled: false,
    ...(type === 'user' ? { content: id } : { components: [{ id, type: 'text', data: { content: id } }] }), ...extra,
  });
  it('freezes completed pairs and excludes current input, live siblings and late completions', () => {
    const history = completedTurnHistory([
      message('q1', 'user', 1), message('a1', 'ai', 2, { questionMessageId: 'q1' }),
      message('q2', 'user', 3), message('a2', 'ai', 4, { questionMessageId: 'q2', isComplete: false, isStreaming: true }),
      message('q3', 'user', 5), message('a3', 'ai', 6, { questionMessageId: 'q3', updatedAt: new Date(12) }),
      message('current', 'user', 10), message('answer', 'ai', 11, { questionMessageId: 'current', isComplete: false }),
    ], 'answer');
    expect(history).toEqual([{ role: 'CONVERSATION_HISTORY_ROLE_USER', text: 'q1' },
      { role: 'CONVERSATION_HISTORY_ROLE_ASSISTANT', text: 'a1' }]);
  });
  it('bounds entries and includes published background answers without fabricating a question', () => {
    const messages = Array.from({ length: 42 }, (_, i) => message(`followup-${i}`, 'ai', i));
    messages.push(message('answer', 'ai', 100, { isComplete: false }));
    expect(completedTurnHistory(messages, 'answer')).toHaveLength(40);
    expect(completedTurnHistory(messages, 'answer')[0].text).toBe('followup-2');
  });
  it('uses the latest completed answer branch and excludes the current question previous answer', () => {
    const history = completedTurnHistory([
      message('q1', 'user', 1), message('old', 'ai', 2, { questionMessageId: 'q1' }),
      message('latest', 'ai', 3, { questionMessageId: 'q1' }),
      message('current', 'user', 10), message('current-old-answer', 'ai', 10, { questionMessageId: 'current' }),
      message('answer', 'ai', 11, { questionMessageId: 'current', isComplete: false }),
    ], 'answer');
    expect(history.map((entry) => entry.text)).toEqual(['q1', 'latest']);
  });
  it('selects only the latest included completed ancestor for private session continuity', () => {
    const seed = completedTurnSeed([
      message('q1', 'user', 1), message('old', 'ai', 2, { questionMessageId: 'q1' }),
      message('latest', 'ai', 3, { questionMessageId: 'q1' }),
      message('concurrent-question', 'user', 4),
      message('concurrent', 'ai', 5, { questionMessageId: 'concurrent-question', updatedAt: new Date(12) }),
      message('current', 'user', 10), message('answer', 'ai', 11, { questionMessageId: 'current', isComplete: false }),
    ], 'answer');
    expect(seed.sourceSessionId).toBe('turn_latest');
    expect(seed.history.map((entry) => entry.text)).toEqual(['q1', 'latest']);
  });
  it('does not use an edited answer as a private history source', () => {
    expect(completedTurnSeed([
      message('q1', 'user', 1), message('edited', 'ai', 2, { questionMessageId: 'q1', isEdited: true }),
      message('current', 'user', 10), message('answer', 'ai', 11, { questionMessageId: 'current', isComplete: false }),
    ], 'answer').sourceSessionId).toBeUndefined();
  });
});
