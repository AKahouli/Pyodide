import { describe, expect, it } from 'vitest';
import { collectMessageCitations, getCitationEntryLabel, isUrlCitation } from './message-citations';
import type { CitationData } from '@/components/ai-elements/ai-message-content';
import type { MessageComponent } from '../types';

function citation(overrides: Partial<CitationData>): CitationData {
  return {
    parentId: 'parent-1',
    sourceType: 'text',
    source: 'workspace/doc.pdf',
    externalId: 'ext-1',
    page: '3',
    pageContent: '',
    workspaceId: 'ws-1',
    ...overrides,
  };
}

describe('collectMessageCitations', () => {
  it('collects citations from text parts and standalone citation parts', () => {
    const components: MessageComponent[] = [
      { type: 'text', data: { content: 'intro', citations: [citation({ source: 'a.pdf' })] } },
      { type: 'citation', data: { source: 'b.pdf', page: '7' } },
    ];
    const result = collectMessageCitations(components);
    expect(result.map((c) => c.source)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('de-duplicates repeated citations across parts (same source/reference/page)', () => {
    const components: MessageComponent[] = [
      { type: 'text', data: { content: 'one', citations: [citation({ source: 'a.pdf' })] } },
      { type: 'text', data: { content: 'two', citations: [citation({ source: 'a.pdf' }), citation({ source: 'b.pdf' })] } },
    ];
    expect(collectMessageCitations(components)).toHaveLength(2);
  });

  it('keeps same-source citations with different pages separate', () => {
    const components: MessageComponent[] = [
      { type: 'text', data: { content: 'one', citations: [citation({ source: 'a.pdf', page: '1' })] } },
      { type: 'text', data: { content: 'two', citations: [citation({ source: 'a.pdf', page: '2' })] } },
    ];
    expect(collectMessageCitations(components)).toHaveLength(2);
  });

  it('returns empty for missing or empty components', () => {
    expect(collectMessageCitations(undefined)).toEqual([]);
    expect(collectMessageCitations([{ type: 'code', data: { content: 'x' } }])).toEqual([]);
  });
});

describe('getCitationEntryLabel', () => {
  it('prefers fileName, then path tail, then source tail', () => {
    expect(getCitationEntryLabel(citation({ fileName: 'Report.pdf' }), 'fallback')).toBe('Report.pdf');
    expect(getCitationEntryLabel(citation({ source: 'a/b/c.pdf', path: 'x/y.pdf' }), 'fallback')).toBe('y.pdf');
    expect(getCitationEntryLabel(citation({ source: 'a/b/c.pdf' }), 'fallback')).toBe('c.pdf');
    expect(getCitationEntryLabel(citation({ source: '' }), 'fallback')).toBe('fallback');
  });
});

describe('isUrlCitation', () => {
  it('detects http(s) sources', () => {
    expect(isUrlCitation(citation({ source: 'https://example.com/a' }))).toBe(true);
    expect(isUrlCitation(citation({ source: 'http://example.com/a' }))).toBe(true);
    expect(isUrlCitation(citation({ source: 'workspace/doc.pdf' }))).toBe(false);
  });
});
