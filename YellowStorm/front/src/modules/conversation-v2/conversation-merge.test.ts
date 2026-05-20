import { describe, expect, it } from 'vitest';
import { mergeConversations } from './conversation-merge';

describe('mergeConversations', () => {
  it('interleaves v1 and v2 sorted by lastEventAt desc with kind tags', () => {
    const v1 = [
      { id: 'a', title: 'A', lastMessageAt: '2026-05-01T10:00:00Z' },
      { id: 'b', title: 'B', lastMessageAt: '2026-05-03T10:00:00Z' },
    ];
    const v2 = [
      { sessionId: 'x', title: 'X', lastEventAt: '2026-05-02T10:00:00Z' },
      { sessionId: 'y', title: 'Y', lastEventAt: '2026-05-04T10:00:00Z' },
    ];
    const merged = mergeConversations(v1 as any, v2 as any);
    expect(merged.map((m) => m.id)).toEqual(['y', 'b', 'x', 'a']);
    expect(merged.find((m) => m.id === 'x')?.kind).toBe('v2');
    expect(merged.find((m) => m.id === 'a')?.kind).toBe('v1');
  });
});
