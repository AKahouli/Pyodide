import {
  tokenOverlapMetrics,
  semanticSimilarity,
  extractFacts,
  deterministicAnswerCorrectness,
  buildExpectedSources,
  buildRetrievalMetrics,
  buildQueryResult,
  normalizeFilename,
  extractFilePagePairs,
  selectBenchmarkQueries,
} from './evaluation-metrics';

describe('selectBenchmarkQueries', () => {
  const queries = [
    { query_id: 'Q001', query: 'a' },
    { query_id: 'Q003', query: 'b' },
    { query_id: 'Q025', query: 'c' },
  ];

  it('keeps the whole dataset when no query id is given', () => {
    expect(selectBenchmarkQueries(queries)).toHaveLength(3);
    expect(selectBenchmarkQueries(queries, [])).toHaveLength(3);
    expect(selectBenchmarkQueries(queries, ['  '])).toHaveLength(3);
  });

  it('scopes to a single query id', () => {
    expect(selectBenchmarkQueries(queries, ['Q003'])).toEqual([{ query_id: 'Q003', query: 'b' }]);
  });

  it('scopes to several query ids', () => {
    expect(selectBenchmarkQueries(queries, ['Q001', 'Q025'])).toEqual([
      { query_id: 'Q001', query: 'a' },
      { query_id: 'Q025', query: 'c' },
    ]);
  });

  it('returns an empty list for an unknown query id', () => {
    expect(selectBenchmarkQueries(queries, ['Q999'])).toEqual([]);
  });
});

describe('tokenOverlapMetrics', () => {
  it('computes recall/precision/f1 over token sets', () => {
    const metrics = tokenOverlapMetrics('congé payé 25 jours', 'Le congé payé est de 25 jours ouvrables');
    expect(metrics.recall).toBeGreaterThan(0.5);
    expect(metrics.f1).toBeGreaterThan(0);
  });

  it('treats empty expected as full recall when generated is empty', () => {
    expect(tokenOverlapMetrics('', '')).toEqual({ recall: 1, precision: 1, f1: 1 });
  });
});

describe('semanticSimilarity', () => {
  it('returns ratio > 0 for overlapping text and 0 for empty input', () => {
    expect(semanticSimilarity('bonjour le monde', 'bonjour le monde entier')).toBeGreaterThan(0.5);
    expect(semanticSimilarity('', 'abc')).toBe(0);
  });
});

describe('extractFacts', () => {
  it('extracts percentage, currency and duration facts', () => {
    const facts = extractFacts('Taux de 15,5% avec un budget de 1 200 EUR sur [1] une durée de 3 ans.');
    expect(facts).toContain('15,5%');
    expect(facts.some((fact) => fact.includes('eur'))).toBe(true);
    expect(facts.some((fact) => fact.includes('3 ans'))).toBe(true);
  });
});

describe('deterministicAnswerCorrectness', () => {
  it('reaches 1.0 when all expected facts are present', () => {
    const score = deterministicAnswerCorrectness(
      'Le taux est de 5%.',
      "D'après la fiche, le taux est bien de 5% comme indiqué.",
    );
    expect(score).toBe(1);
  });
});

describe('buildExpectedSources', () => {
  it('pairs a single file with multiple pages', () => {
    const { sources } = buildExpectedSources(['Fiche CAT.pdf'], [10, 11, 12]);
    expect(sources).toEqual([
      { file: 'Fiche CAT.pdf', page: 10 },
      { file: 'Fiche CAT.pdf', page: 11 },
      { file: 'Fiche CAT.pdf', page: 12 },
    ]);
  });

  it('errors on mismatched files/pages', () => {
    const { error } = buildExpectedSources(['a.pdf', 'b.pdf'], [1, 2, 3]);
    expect(error).toBeTruthy();
  });
});

describe('retrieval metrics', () => {
  it('reports file recall and page hit from a matched tool call', () => {
    const { sources: expectedSources } = buildExpectedSources(['hr_policy.pdf'], [3]);
    const metrics = buildRetrievalMetrics(expectedSources, [
      {
        node_id: 'step-1',
        iteration: 0,
        result: { output: 'hr_policy.pdf | Page 3' },
      },
    ] as never);
    expect(metrics.file_recall).toBe(1);
    expect(metrics.page_hit).toBe(true);
    expect(metrics.retrieval_success).toBe(true);
  });

  it('fails retrieval when the wrong page is returned', () => {
    const { sources: expectedSources } = buildExpectedSources(['hr_policy.pdf'], [3]);
    const metrics = buildRetrievalMetrics(expectedSources, [
      { node_id: 'step-1', iteration: 0, result: { output: 'hr_policy.pdf | Page 5' } },
    ] as never);
    expect(metrics.page_hit).toBe(false);
    expect(metrics.retrieval_success).toBe(false);
  });
});

describe('normalizeFilename', () => {
  it('is case/underscore/space insensitive', () => {
    expect(normalizeFilename('HR_Policy.pdf')).toBe(normalizeFilename('hr policy.pdf'));
  });
});

describe('extractFilePagePairs', () => {
  it('extracts pairs from markdown table output', () => {
    const pairs = extractFilePagePairs([
      { result: { output: '| HR Policy | Page 3 |' } },
    ]);
    expect(pairs).toEqual([{ file: 'hr_policy.pdf', page: 3 }]);
  });
});

describe('buildQueryResult', () => {
  it('produces status + metrics envelope matching python evaluator shape', () => {
    const result = buildQueryResult({
      queryId: 'Q001',
      query: 'question',
      expectedAnswer: 'reponse attendue',
      requiredFile: ['a.pdf'],
      page: [1],
      generatedAnswer: 'reponse produite',
      status: 'completed',
      durationMs: 123,
      error: null,
      toolCalls: [],
    });
    expect(result.query_id).toBe('Q001');
    expect(result.status).toBe('completed');
    expect(result.metrics.answer.token_recall).toBeGreaterThanOrEqual(0);
    expect(result.metrics.retrieval.expected_files).toEqual(['a.pdf']);
  });
});