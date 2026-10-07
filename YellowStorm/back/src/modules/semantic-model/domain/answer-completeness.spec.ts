import type {
  RuntimeGraphExpandResult,
  RuntimeGraphSearchResult,
  RuntimeRecordsQueryResult,
} from '../services/semantic-runtime-client.service';
import { findCompleteness, queryCompleteness, relatedCompleteness } from './answer-completeness';

const pinned = { modelId: 'm', environment: 'production' as const, modelVersionId: 'v', dataRevisionId: 'dr-1', projectionRef: 'age:v2:pop_dr_1' };

function search(overrides: Partial<RuntimeGraphSearchResult>): RuntimeGraphSearchResult {
  return {
    ...pinned, status: 'found', modeUsed: 'hybrid', concepts: [], unknownConcepts: [],
    index: { indexId: 'i', state: 'ready', embeddingFingerprint: 'f' },
    seeds: [{ entityId: 'e1' }, { entityId: 'e2' }] as RuntimeGraphSearchResult['seeds'],
    coverage: { expectedCount: 10, indexedCount: 9, exactOnlyCount: 1 },
    timings: { embedMs: 0, seedMs: 0 },
    ...overrides,
  } as RuntimeGraphSearchResult;
}

function walk(overrides: Partial<RuntimeGraphExpandResult>): RuntimeGraphExpandResult {
  const node = (entityId: string, reason: 'seed' | 'relationship') => ({
    entityId, conceptId: 'c-fact', conceptLabel: 'Fait', label: entityId, keyFields: {}, inclusionReason: reason, path: [], provenance: [],
  });
  return {
    ...pinned, status: 'found', nodes: [node('mail', 'seed'), node('f1', 'relationship'), node('f2', 'relationship')],
    edges: [], hiddenSeeds: 0, truncated: false, timings: { expandMs: 1 },
    linkCounts: [{ relationId: 'r', relationKey: 'enonce', direction: 'outgoing', conceptId: 'c-fact', conceptLabel: 'Fait', count: 2, hidden: 0 }],
    ...overrides,
  };
}

function query(overrides: Partial<RuntimeRecordsQueryResult>): RuntimeRecordsQueryResult {
  return {
    ...pinned, status: 'ok', appliedQuery: {} as RuntimeRecordsQueryResult['appliedQuery'],
    total: 2, hiddenRecords: 0, records: [{ entityId: 'a' }, { entityId: 'b' }] as RuntimeRecordsQueryResult['records'],
    returned: 2, offset: 0, nextOffset: null, ...overrides,
  };
}

describe('answer completeness', () => {
  it('find_records is complete only when nothing was cut and the whole data is indexed', () => {
    expect(findCompleteness(search({}))).toEqual({
      complete: true, returned: 2, total: null, hasMore: false, hiddenRecords: 0, reasons: [], dataRevisionId: 'dr-1',
    });
    expect(findCompleteness(search({ hasMore: true, hiddenRecords: 3 }))).toMatchObject({
      complete: false, hasMore: true, hiddenRecords: 3, reasons: ['more_results'],
    });
    expect(findCompleteness(search({ coverage: { expectedCount: 10, indexedCount: 4, exactOnlyCount: 1 } })).reasons).toEqual(['index_partial']);
    expect(findCompleteness(search({ index: { indexId: null, state: 'queued', embeddingFingerprint: null } })).reasons).toEqual(['index_not_ready']);
  });

  it('get_related_records gives the exact total of linked records and says when the walk stopped short', () => {
    expect(relatedCompleteness(walk({}), true)).toMatchObject({ complete: true, returned: 2, total: 2, hasMore: false });
    const sixty = walk({ truncated: true, linkCounts: [{ relationId: 'r', relationKey: 'enonce', direction: 'outgoing',
      conceptId: 'c-fact', conceptLabel: 'Fait', count: 60, hidden: 4 }] });
    expect(relatedCompleteness(sixty, true)).toMatchObject({ complete: false, returned: 2, total: 60, hasMore: true, hiddenRecords: 4 });
    // Two steps: the stored links of the seeds do not count the second step's records.
    expect(relatedCompleteness(walk({}), false)).toMatchObject({ total: null, complete: true });
    expect(relatedCompleteness(walk({ hiddenSeeds: 1 }), true).hiddenRecords).toBe(1);
  });

  it('query_records says when a page, the groups or the values leave records out', () => {
    expect(queryCompleteness(query({}))).toMatchObject({ complete: true, total: 2, returned: 2 });
    expect(queryCompleteness(query({ total: 60, nextOffset: 2 }))).toMatchObject({ complete: false, hasMore: true, reasons: ['more_results'] });
    expect(queryCompleteness(query({ unparsable: { amount: 3 } })).reasons).toEqual(['values_unreadable']);
    expect(queryCompleteness(query({ records: [{ entityId: 'a', truncated: true }] as RuntimeRecordsQueryResult['records'] })).reasons)
      .toEqual(['values_cut']);
    expect(queryCompleteness(query({ records: undefined, buckets: [{}, {}], bucketsTruncated: true }))).toMatchObject({
      returned: 2, hasMore: true, complete: false,
    });
  });
});
