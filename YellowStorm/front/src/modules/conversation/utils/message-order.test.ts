import { describe, expect, it } from 'vitest';
import { insertMessageChronologically } from './message-order';
import type { Message } from '../types';

function message(id: string, createdAt: string, conversationType: Message['conversationType'] = 'user'): Message {
  return {
    id,
    conversationId: 'conv-1',
    conversationType,
    content: `content-${id}`,
    createdAt,
  };
}

describe('insertMessageChronologically', () => {
  it('appends a newer message at the end (normal flow)', () => {
    const messages = [message('u1', '2026-01-01T10:00:00Z'), message('a1', '2026-01-01T10:00:05Z', 'ai')];
    const result = insertMessageChronologically(messages, message('u2', '2026-01-01T10:01:00Z'));
    expect(result.map((m) => m.id)).toEqual(['u1', 'a1', 'u2']);
  });

  it('inserts a late user message BEFORE an answer that arrived first via SSE', () => {
    // The reported bug: POST response resolves after the AI answer was already
    // added, so appending rendered the prompt after its answer.
    const messages = [message('u1', '2026-01-01T10:00:00Z'), message('a1', '2026-01-01T10:00:05Z', 'ai'), message('a2', '2026-01-01T10:01:05Z', 'ai')];
    const result = insertMessageChronologically(messages, message('u2', '2026-01-01T10:01:00Z'));
    expect(result.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('keeps existing order for equal timestamps (stable append semantics)', () => {
    const messages = [message('u1', '2026-01-01T10:00:00Z')];
    const result = insertMessageChronologically(messages, message('a1', '2026-01-01T10:00:00Z', 'ai'));
    expect(result.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('falls back to appending when timestamps are unparseable', () => {
    const messages = [message('u1', '2026-01-01T10:00:00Z')];
    const result = insertMessageChronologically(messages, message('a1', 'not-a-date', 'ai'));
    expect(result.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('treats existing messages with unparseable timestamps as oldest', () => {
    const messages = [message('u1', 'invalid', 'ai')];
    const result = insertMessageChronologically(messages, message('u2', '2026-01-01T10:00:00Z'));
    expect(result.map((m) => m.id)).toEqual(['u1', 'u2']);
  });
});
