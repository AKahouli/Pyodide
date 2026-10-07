import { describe, expect, it } from 'vitest';
import {
  SEARCH_INDEX_DEFAULTS, cleanFieldIndex, effectiveIndex, fieldOverrideProblems, searchIndexProblems, searchQueryProblems, withSearchIndex,
} from './searchSettings';
import type { AttributeDefinition } from './types';

describe('search settings validation', () => {
  it('accepts the built-ins and nothing set', () => {
    expect(searchIndexProblems({})).toBeNull();
    expect(searchQueryProblems({})).toBeNull();
    expect(fieldOverrideProblems(undefined, SEARCH_INDEX_DEFAULTS)).toBeNull();
  });

  it('checks the index ranges and how passage sizes agree, on the effective values', () => {
    expect(searchIndexProblems({ cardValueChars: 50 })).toBe('searchSettings.problems.range');
    expect(searchIndexProblems({ passageMinChars: 1000 })).toBe('searchSettings.problems.passageOrder');
    expect(searchIndexProblems({ passageTargetChars: 1300 })).toBe('searchSettings.problems.passageOrder');
    expect(searchIndexProblems({ passageOverlapChars: 700 })).toBe('searchSettings.problems.overlap');
    expect(searchIndexProblems({ cardValueChars: 1000, cardTextChars: 800 })).toBe('searchSettings.problems.cardText');
    expect(searchIndexProblems({ maxPassagesPerField: 60 })).toBe('searchSettings.problems.passagesPerRecord');
    expect(searchIndexProblems({ passageTargetChars: 1.5 })).toBe('searchSettings.problems.range');
  });

  it('caps the long field size at the effective card value size, which is also its default', () => {
    expect(searchIndexProblems({ longFieldChars: 400 })).toBe('searchSettings.problems.range');
    expect(searchIndexProblems({ cardValueChars: 500, longFieldChars: 400 })).toBeNull();
    expect(effectiveIndex({ cardValueChars: 500 }).longFieldChars).toBe(500);
  });

  it('checks the search ranges, limits and extra stop words', () => {
    expect(searchQueryProblems({ minSimilarity: 0.55 })).toBeNull();
    expect(searchQueryProblems({ minSimilarity: 1.2 })).toBe('searchSettings.problems.range');
    expect(searchQueryProblems({ lexicalCandidates: 10.5 })).toBe('searchSettings.problems.range');
    expect(searchQueryProblems({ defaultLimit: 30 })).toBe('searchSettings.problems.limit');
    expect(searchQueryProblems({ defaultLimit: 30, maxLimit: 40 })).toBeNull();
    expect(searchQueryProblems({ extraStopWords: ['x'.repeat(41)] })).toBe('searchSettings.problems.stopWords');
    expect(searchQueryProblems({ extraStopWords: Array.from({ length: 501 }, (_, index) => `w${index}`) })).toBe('searchSettings.problems.stopWords');
  });

  it('checks a field override over the global values', () => {
    const global = { ...SEARCH_INDEX_DEFAULTS, passageMinChars: 300 };
    expect(fieldOverrideProblems({ passageTargetChars: 600 }, global)).toBeNull();
    expect(fieldOverrideProblems({ passageTargetChars: 600 }, SEARCH_INDEX_DEFAULTS)).toBe('searchSettings.problems.passageOrder');
    expect(fieldOverrideProblems({ passageOverlapChars: 400 }, global)).toBe('searchSettings.problems.overlap');
    expect(fieldOverrideProblems({ longFieldChars: 500 }, SEARCH_INDEX_DEFAULTS)).toBe('searchSettings.problems.range');
    expect(fieldOverrideProblems({ passages: false }, SEARCH_INDEX_DEFAULTS)).toBeNull();
  });

  it('drops empty overrides from a field', () => {
    expect(cleanFieldIndex({ passages: undefined, longFieldChars: undefined })).toBeUndefined();
    expect(cleanFieldIndex({ passageTargetChars: 600, passages: undefined })).toEqual({ passageTargetChars: 600 });
    const field: AttributeDefinition = { key: 'body', label: 'Body', type: 'text', required: false, searchIndex: { passageTargetChars: 600 } };
    expect('searchIndex' in withSearchIndex(field, {})).toBe(false);
    expect(withSearchIndex(field, { passages: false }).searchIndex).toEqual({ passages: false });
  });
});
