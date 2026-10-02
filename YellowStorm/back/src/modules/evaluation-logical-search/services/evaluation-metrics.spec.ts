import {
  tokenOverlapMetrics,
  semanticSimilarity,
  extractFacts,
  deterministicAnswerCorrectness,
  buildExpectedSources,
  buildRetrievalMetrics,
  buildQueryResult,
  buildCitations,
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

  it('keeps target and judge token usage separate from the global total', () => {
    const result = buildQueryResult({
      queryId: 'Q001',
      query: 'question',
      expectedAnswer: 'reponse attendue',
      requiredFile: ['a.pdf'],
      page: [1],
      generatedAnswer: 'reponse produite',
      status: 'completed',
      durationMs: 123,
      toolCalls: [],
      tokenUsage: { total_tokens: 300, prompt_tokens: 280, completion_tokens: 20 },
      targetTokenUsage: { total_tokens: 200, prompt_tokens: 190, completion_tokens: 10 },
      judgeTokenUsage: { total_tokens: 100, prompt_tokens: 90, completion_tokens: 10 },
    });

    expect(result.token_usage?.total_tokens).toBe(300);
    expect(result.target_token_usage).toEqual({ total_tokens: 200, prompt_tokens: 190, completion_tokens: 10 });
    expect(result.judge_token_usage).toEqual({ total_tokens: 100, prompt_tokens: 90, completion_tokens: 10 });
  });
});

describe('buildCitations', () => {
  const call = (output: string, toolName = 'smart-navigation-search_locate_answer_citations') => ({
    node_id: 'eval-target',
    iteration: 0,
    tool_name: toolName,
    output_summary: output,
  }) as unknown as Parameters<typeof buildCitations>[0][number];

  it('extracts reference, file, page and snippet from the locate output', () => {
    const output = JSON.stringify({
      citations: [
        { reference: '[1]', source: 's3://vectorstore/ws/bpce/Fiche_Produit_CAT_v1.0.pdf', page_number: 9, highlight_text: 'Création des comptes' },
        { reference: [2], source: 'other/doc.pdf', page: '10', page_content: 'Saisie CAT' },
      ],
    });
    expect(buildCitations([call(output)])).toEqual([
      { reference: 1, fileName: 'Fiche_Produit_CAT_v1.0.pdf', page: 9, snippet: 'Création des comptes', source: 's3://vectorstore/ws/bpce/Fiche_Produit_CAT_v1.0.pdf' },
      { reference: 2, fileName: 'doc.pdf', page: 10, snippet: 'Saisie CAT', source: 'other/doc.pdf' },
    ]);
  });

  it('returns an empty list without a locate tool call', () => {
    expect(buildCitations([])).toEqual([]);
  });

  it('detects the citation call when the tool name is truncated/hashed', () => {
    const output = JSON.stringify({
      citations: [{ reference: '[5]', source: 's3://vectorstore/ws/p/doc.pdf', page_number: 3, highlight_text: 'Extrait' }],
    });
    const hashedName = 'smart-navigation-search-no-document-strategy_lo_bd86f4bac10ba66a';
    expect(buildCitations([call(output, hashedName)])).toEqual([
      { reference: 5, fileName: 'doc.pdf', page: 3, snippet: 'Extrait', source: 's3://vectorstore/ws/p/doc.pdf' },
    ]);
  });
});

describe('buildRetrievalMetrics precision', () => {
  it('computes file precision on cited documents, not on search candidates', () => {
    const expected = buildExpectedSources('doc.pdf', null);
    const calls = [
      { node_id: 'eval-target', iteration: 0, tool_name: 'c_search', args: {}, output_summary: JSON.stringify({ documents: [{ file_name: 'other1.pdf' }, { file_name: 'other2.pdf' }] }) },
      { node_id: 'eval-target', iteration: 0, tool_name: 'c_lo_deadbeef', output_summary: JSON.stringify({ citations: [{ reference: '[1]', source: 's3://b/x/doc.pdf', page_number: 5, highlight_text: 'x' }] }) },
    ] as unknown as Parameters<typeof buildRetrievalMetrics>[1];

    const metrics = buildRetrievalMetrics(expected.sources, calls);
    expect(metrics.retrieved_files).toEqual(['doc.pdf']);
    expect(metrics.file_precision).toBe(1);
    expect(metrics.retrieved_candidate_count).toBe(3);
  });
});