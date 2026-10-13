import { describe, expect, it } from 'vitest';
import type { CitationData } from '@/components/ai-elements/ai-message-content';
import { splitCitations, toStockSources } from './citations';

const citation = (reference: string | undefined, source = `workspace/${reference}.pdf`): CitationData => ({
  parentId: '', sourceType: 'text', source, externalId: '', page: '', pageContent: '', workspaceId: 'w', ...(reference === undefined ? {} : { reference }),
});

describe('splitCitations', () => {
  it('keeps the first citation of a duplicated reference inline and lists the repeat after the answer', () => {
    const first = citation('1', 'workspace/a.pdf');
    const repeat = citation('1', 'workspace/b.pdf');
    const { byReference, trailing } = splitCitations([first, repeat], 'Claim [1].');
    expect(byReference.get('1')).toBe(first);
    expect(trailing).toEqual([repeat]);
  });

  it('lists citations whose marker is absent, unless they are owned evidence', () => {
    const unmarked = citation('2');
    const owned = { ...citation('3'), evidenceId: 'e', executionId: 'x' };
    expect(splitCitations([unmarked, owned], 'Claim [1].', { conversationId: 'c', messageId: 'm' }).trailing).toEqual([unmarked]);
  });
});

describe('toStockSources', () => {
  it('builds a dense array: gaps in the numbering get a blank entry the stock renderer filters out', () => {
    const sources = toStockSources(new Map([['1', citation('1')], ['3', citation('3', 'https://example.com/page')]]));
    expect(sources).toHaveLength(3);
    expect(Object.keys(sources)).toEqual(['0', '1', '2']);
    expect(sources[1]).toEqual({ title: '', sourceName: '' });
    expect(sources[2]).toEqual({ title: 'page', sourceName: 'example.com', url: 'https://example.com/page' });
  });

  it('skips non-numeric and out-of-range references instead of creating NaN keys', () => {
    const sources = toStockSources(new Map([['abc', citation('abc')], ['0', citation('0')], ['100000', citation('100000')], ['2', citation('2')]]));
    expect(sources).toHaveLength(2);
    expect(sources.some((source) => Object.keys(source).includes('NaN'))).toBe(false);
    expect(sources[1].title).toBe('2.pdf');
    expect(toStockSources(new Map())).toEqual([]);
  });
});
