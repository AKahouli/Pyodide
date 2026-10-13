import { completedSourceContext } from './completed-source-context';
import { completedTurnHistory } from './completed-turn-history';
import type { MessageRecord } from '../persistence/message-store';

describe('completed web source provenance', () => {
  it('keeps citation references, URLs and titles without raw response or private document data', () => {
    const citation = { id: 'web', type: 'citation' as const, data: { sourceType: 'web', reference: '[1]',
      source: 'https://www.postgresql.org/docs/', title: 'PostgreSQL documentation', exactText: 'raw extract' } };
    const result = completedSourceContext([citation, citation,
      { id: 'document', type: 'citation', data: { sourceType: 'text', source: 'private-file', pageContent: 'private contents' } },
      { id: 'sources', type: 'sources', data: { sources: [{ title: 'DuckDB', url: 'https://duckdb.org/docs/' }, { url: 'javascript:alert(1)' }] } },
    ]);
    expect(result).toContain('"reference":"[1]"');
    expect(result).toContain('https://www.postgresql.org/docs/');
    expect(result).toContain('DuckDB');
    expect(result).not.toMatch(/raw extract|private|javascript/);
    expect(result.match(/PostgreSQL documentation/g)).toHaveLength(1);
  });
  it('bounds provenance and preserves it at the end of a long completed answer', () => {
    const components = [{ id: 'text', type: 'text' as const, data: { content: 'x'.repeat(40_000) } },
      ...Array.from({ length: 50 }, (_, i) => ({ id: `citation-${i}`, type: 'citation' as const,
        data: { sourceType: 'web', reference: `[${i}]`, source: `https://example.com/${i}`, title: 'title'.repeat(100) } }))];
    const base = { conversationId: 'chat', isStreaming: false, isEdited: false, webSearchEnabled: false,
      createdAt: new Date(1), updatedAt: new Date(1) };
    const messages = [{ ...base, id: 'q', conversationType: 'user', content: 'research', isComplete: false },
      { ...base, id: 'a', conversationType: 'ai', questionMessageId: 'q', isComplete: true, components },
      { ...base, id: 'new', conversationType: 'ai', isComplete: false, createdAt: new Date(2) }] as MessageRecord[];
    const answer = completedTurnHistory(messages, 'new')[1].text;
    expect(answer.length).toBeLessThanOrEqual(30_000);
    expect(answer).toContain('Source references');
    expect(answer).toMatch(/"omitted_count":[1-9]/);
  });
});
