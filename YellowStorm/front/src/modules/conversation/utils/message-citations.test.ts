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
      { type: 'citation', data: { source: 'b.pdf', page: '7', evidenceId: 'evidence', executionId: 'worker' } },
    ];
    const result = collectMessageCitations(components);
    expect(result.map((c) => c.source)).toEqual(['a.pdf', 'b.pdf']);
    expect(result[1]).toMatchObject({ evidenceId: 'evidence', executionId: 'worker' });
  });

  it('preserves persisted web citation selectors', () => {
    expect(collectMessageCitations([{ type: 'citation', data: {
      sourceKind: 'web', sourceType: 'web', source: 'https://example.com/article', title: 'Article',
      exactText: 'Revenue rose.', prefix: 'Results', suffix: 'Outlook', evidenceOrigin: 'page_content', reference: '[2]',
    } } as never])).toEqual([expect.objectContaining({
      sourceKind: 'web', sourceType: 'web', exactText: 'Revenue rose.', prefix: 'Results', suffix: 'Outlook', evidenceOrigin: 'page_content',
    })]);
  });
  it('keeps owned source identities distinct from same-filename workers and legacy sources', () => {
    const result = collectMessageCitations([
      { type: 'citation', data: { source: 'report.pdf' } },
      { type: 'citation', data: { source: 'report.pdf', executionId: 'worker-1', evidenceId: 'evidence-1' } },
      { type: 'citation', data: { source: 'report.pdf', executionId: 'worker-2', evidenceId: 'evidence-2' } },
    ]);
    expect(result).toHaveLength(3);
    expect(result.slice(1).map(item => item.executionId)).toEqual(['worker-1', 'worker-2']);
  });

  it('de-duplicates repeated citations across parts (same source/reference/page)', () => {
    const components: MessageComponent[] = [
      { type: 'text', data: { content: 'one', citations: [citation({ source: 'a.pdf' })] } },
      { type: 'text', data: { content: 'two', citations: [citation({ source: 'a.pdf' }), citation({ source: 'b.pdf' })] } },
    ];
    expect(collectMessageCitations(components)).toHaveLength(2);
  });

  it('collapses same-document citations with different pages or references into one entry', () => {
    const components: MessageComponent[] = [
      { type: 'text', data: { content: 'one', citations: [citation({ source: 'a.pdf', page: '1', reference: '[1]' })] } },
      { type: 'text', data: { content: 'two', citations: [citation({ source: 'a.pdf', page: '2', reference: '[2]' })] } },
      { type: 'text', data: { content: 'three', citations: [citation({ source: 'a.pdf', page: '2', fileName: 'other.pdf' })] } },
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
