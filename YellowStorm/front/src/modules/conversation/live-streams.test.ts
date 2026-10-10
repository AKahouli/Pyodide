import { describe, expect, it, vi } from 'vitest';
import { LiveStreamBuffers, applyLiveChunks, liveAnswerTimestamp, type LiveAnswer } from './live-streams';

describe('independent live replies', () => {
  it('uses server message chronology despite a browser clock one minute behind', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const answer: LiveAnswer = { conversationId: 'c', messageId: 'a', questionMessageId: 'q', createdAt: '', revision: 0, components: [] };
    const question = { id: 'q', conversationId: 'c', conversationType: 'user' as const, createdAt: '2026-01-01T00:01:00Z' };
    expect(liveAnswerTimestamp(answer, [question])).toBe(question.createdAt);
    const placeholder = { ...question, id: 'a', conversationType: 'ai' as const, createdAt: '2026-01-01T00:01:01Z' };
    expect(liveAnswerTimestamp(answer, [question, placeholder])).toBe(placeholder.createdAt);
    vi.useRealTimers();
  });
  it('batches interleaved replies independently and finishes only the target', () => {
    const answers: Record<string, LiveAnswer> = Object.fromEntries(['a', 'b'].map((id) => [`c:${id}`, { conversationId: 'c', messageId: id, revision: 0, components: [], createdAt: '' }]));
    const buffers = new LiveStreamBuffers((key, chunks) => { answers[key] = applyLiveChunks(answers[key], chunks); }, vi.fn());
    for (const [messageId, text, revision] of [['a', 'first', 1], ['b', 'second', 1], ['a', ' answer', 2]] as const) {
      buffers.push({ conversationId: 'c', messageId, revision, action: revision === 1 ? 'add' : 'update', component: { id: 'same-component-id', type: 'text', data: { content: text } } });
    }
    buffers.finish('c:b');
    expect(answers['c:b'].components[0].data.content).toBe('second');
    buffers.finish('c:a');
    expect(answers['c:a'].components[0].data.content).toBe('first answer');
    expect(buffers.push({ conversationId: 'c', messageId: 'b', revision: 2, action: 'update', component: { id: 'same-component-id', type: 'text', data: { content: 'late' } } })).toBe(false);
  });

  it('reconciles each snapshot with newer deltas without replaying duplicates or resurrecting completed replies', () => {
    const buffers = new LiveStreamBuffers(vi.fn(), vi.fn());
    const event = { conversationId: 'c', messageId: 'a', revision: 2, action: 'update' as const, component: { id: 'text', type: 'text' as const, data: { content: ' newer' } } };
    expect(buffers.push(event)).toBe(true);
    expect(buffers.push(event)).toBe(false);
    const snapshot = { conversationId: 'c', messageId: 'a', revision: 1, components: [{ id: 'text', type: 'text' as const, data: { content: 'base' } }] };
    expect(buffers.install(snapshot)?.components[0].data.content).toBe('base newer');
    buffers.finish('c:a');
    expect(buffers.install(snapshot)).toBeNull();
    buffers.clear();
    expect(buffers.install(snapshot)?.components[0].data.content).toBe('base');
  });
});
