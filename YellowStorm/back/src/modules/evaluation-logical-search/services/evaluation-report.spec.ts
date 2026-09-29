import { buildReportModel, parseNarrativeSections } from './evaluation-report';
import type { EvaluationQueryResult, EvaluationRunSummary } from './evaluation-metrics';

function result(over: Partial<EvaluationQueryResult>): EvaluationQueryResult {
  return {
    query_id: 'Q1',
    query: 'q',
    expected_answer: '',
    required_file: null,
    page: null,
    generated_answer: '',
    status: 'completed',
    duration_ms: 0,
    metrics: {} as EvaluationQueryResult['metrics'],
    retrieved_files: [],
    retrieved_pages: [],
    retrieved_sources: [],
    ...over,
  };
}

const summary: EvaluationRunSummary = {
  query_count: 3,
  completed_queries: 2,
  failed_queries: 1,
  mean_answer_correctness: 0.9,
  mean_answer_token_recall: 0.74,
  mean_answer_token_precision: 0.16,
  mean_answer_f1: 0.25,
  mean_semantic_similarity: 0.8,
  mean_fact_recall: 0.94,
  mean_fact_precision: 0.5,
  mean_answer_quality: 0.72,
  answer_exact_match_rate: 0.45,
  mean_file_recall: 0.93,
  mean_file_precision: 0.63,
  mean_page_hit: 2.5,
  retrieval_success_rate: 0.9,
  retrieval_exact_match_rate: 0.4,
};

describe('buildReportModel', () => {
  it('aggregates counts, failures, durations and tokens from the results', () => {
    const model = buildReportModel(
      [
        result({ query_id: 'Q1', duration_ms: 100, target_duration_ms: 60, judge_duration_ms: 40, judge_score: 1, judge_faithfulness_score: 0.6, token_usage: { total_tokens: 100, prompt_tokens: 90, completion_tokens: 10 } }),
        result({ query_id: 'Q2', duration_ms: 300, target_duration_ms: 200, judge_duration_ms: 100, token_usage: { total_tokens: 300, prompt_tokens: 280, completion_tokens: 20 } }),
        result({ query_id: 'Q3', status: 'failed', duration_ms: 200, error: 'network', token_usage: { total_tokens: 200, prompt_tokens: 190, completion_tokens: 10 } }),
      ],
      summary,
    );

    expect(model.query_count).toBe(3);
    expect(model.completed_queries).toBe(2);
    expect(model.failed_queries).toBe(1);
    expect(model.evaluated_queries).toBe(1);
    expect(model.failed_queries_detail).toEqual([{ query_id: 'Q3', error: 'network' }]);
    expect(model.missing_judge_score_ids).toEqual(['Q2']);

    expect(model.durations_ms).toEqual({ mean_total: 200, mean_target: 130, mean_judge: 70 });
    expect(model.tokens).toEqual({
      total: 600,
      mean_per_query: 200,
      prompt: 560,
      completion: 40,
      prompt_share: 0.9333,
      completion_share: 0.0667,
    });
    expect(model.judge).toEqual({ mean_score: 1, zero_score_count: 0, mean_faithfulness: 0.6 });
    expect(model.retrieval.recall).toBe(0.93);
  });
});

describe('parseNarrativeSections', () => {
  it('parses fenced JSON into fixed sections', () => {
    const raw = '```json\n{"overview":"Vue","performance":"Perf","retrieval":"Ret","tokens":"Tok","strengths":["a"],"improvements":["b"],"caveats":[]}\n```';
    expect(parseNarrativeSections(raw)).toEqual({
      overview: 'Vue',
      performance: 'Perf',
      retrieval: 'Ret',
      tokens: 'Tok',
      strengths: ['a'],
      improvements: ['b'],
      caveats: [],
    });
  });

  it('falls back to overview when the output is not JSON', () => {
    const sections = parseNarrativeSections('Texte libre non-JSON');
    expect(sections.overview).toBe('Texte libre non-JSON');
    expect(sections.strengths).toEqual([]);
  });
});
