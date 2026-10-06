import { buildReportModel } from './evaluation-report';
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
  judge_exact_match_rate: 0.4,
  mean_file_recall: 0.93,
  mean_file_precision: 0.63,
  mean_page_hit: 2.5,
  retrieval_success_rate: 0.9,
  retrieval_exact_match_rate: 0.4,
};

describe('buildReportModel', () => {
  it('exposes template-ready values without recomputation by the agent', () => {
    const model = buildReportModel(
      [
        result({ query_id: 'Q1', duration_ms: 100_000, target_duration_ms: 60_000, judge_duration_ms: 40_000, judge_score: 1, judge_faithfulness_score: 0.6, token_usage: { total_tokens: 100, prompt_tokens: 90, completion_tokens: 10 } }),
        result({ query_id: 'Q2', duration_ms: 300_000, target_duration_ms: 200_000, judge_duration_ms: 100_000, token_usage: { total_tokens: 300, prompt_tokens: 280, completion_tokens: 20 } }),
        result({ query_id: 'Q3', status: 'failed', duration_ms: 200_000, error: 'network', token_usage: { total_tokens: 200, prompt_tokens: 190, completion_tokens: 10 } }),
      ],
      summary,
    );

    expect(model.nb_total).toBe(3);
    expect(model.nb_succes).toBe(2);
    expect(model.pct_succes).toBe(66.67);
    expect(model.nb_echecs).toBe(1);
    expect(model.nb_evaluees).toBe(1);
    expect(model.nb_scores_manquants).toBe(1);
    expect(model.failed_queries).toEqual([{ query_id: 'Q3', error: 'network' }]);
    expect(model.missing_judge_score_ids).toEqual(['Q2']);

    expect(model.duree_totale_s).toBe(200);
    expect(model.duree_target_s).toBe(130);
    expect(model.pct_target_latence).toBe(65);

    expect(model.total_tokens).toBe(600);
    expect(model.pct_prompt_tokens).toBe(93.33);
    expect(model.pct_completion_tokens).toBe(6.67);
    expect(model.ratio_prompt_completion).toBe(14);

    expect(model.score_moyen_juge).toBe(1);
    expect(model.nb_validees).toBe(1);
    expect(model.faithfulness_pct).toBe(60);

    expect(model.f1_score).toBe(0.25);
    expect(model.retrieval_recall).toBe(0.93);
  });
});
