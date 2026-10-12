import { ongoingRequestContext } from './ongoing-request-context';
import type { MessageRecord } from '../persistence/message-store';

describe('ongoing request context', () => {
  const message = (id: string, type: 'user' | 'ai', time: number, extra: Partial<MessageRecord> = {}): MessageRecord => ({
    id, conversationId: 'chat', conversationType: type, createdAt: new Date(time), updatedAt: new Date(time),
    isComplete: false, isStreaming: type === 'ai', isEdited: false, webSearchEnabled: false,
    content: id, streamExecutionLeaseId: 'lease', streamExecutionLeaseExpiresAt: new Date(100), ...extra,
  });
  const origin = [message('current', 'user', 20), message('answer', 'ai', 21, { questionMessageId: 'current' })];
  const pair = (extra: Partial<MessageRecord> = {}) => [message('research', 'user', 1, { content: 'Compare databases' }),
    message('research-answer', 'ai', 2, { questionMessageId: 'research', ...extra })];
  const context = (messages: MessageRecord[]) => ongoingRequestContext([...messages, ...origin], 'answer', 'chat', new Date(30));

  it('includes only the earlier user request, never partial components or current input', () => {
    const result = context(pair({ components: [{ id: 'partial', type: 'text', data: { content: 'SECRET PARTIAL' } }] }));
    expect(result).toEqual({ ongoing_requests_observed_at: new Date(30).toISOString(), ongoing_requests: [
      { question_message_id: 'research', assistant_message_ids: ['research-answer'], request_excerpt: 'Compare databases', submitted_at: new Date(1).toISOString() },
    ] });
  });
  it.each([{ isComplete: true }, { isStreaming: false }, { streamExecutionLeaseId: undefined },
    { streamExecutionLeaseExpiresAt: new Date(29) }, { conversationId: 'foreign' }])('excludes inactive/foreign answers %o', (extra) => {
    expect(context(pair(extra))).toBeUndefined();
  });
  it('excludes future questions, foreign questions, and edits after submission', () => {
    for (const extra of [{ createdAt: new Date(40) }, { updatedAt: new Date(40) }, { conversationId: 'foreign' }]) {
      const messages = pair(); Object.assign(messages[0], extra);
      expect(context(messages)).toBeUndefined();
    }
  });
  it('deduplicates branches and bounds excerpts and item count', () => {
    const messages = Array.from({ length: 12 }, (_, i) => [message(`q${i}`, 'user', i, { content: 'x'.repeat(1000) }),
      message(`a${i}`, 'ai', i, { questionMessageId: `q${i}` })]).flat();
    messages.push(message('alternate', 'ai', 12, { questionMessageId: 'q11' }));
    expect(context(messages)?.ongoing_requests).toHaveLength(8);
    expect(context(messages)?.ongoing_requests[0].request_excerpt).toHaveLength(800);
    expect(context(messages)?.ongoing_requests[0].question_message_id).toBe('q11');
    expect(context(messages)?.ongoing_requests[0].assistant_message_ids).toEqual(['a11', 'alternate']);
    expect(ongoingRequestContext(messages, 'absent', 'chat')).toBeUndefined();
  });
});
