import type { EvaluationQueryResult, EvaluationRunSummary } from './evaluation-metrics';

/**
 * Deterministic, LLM-free payload handed to the interpreter agent. Keys mirror
 * the placeholders of the interpreter template so the agent only copies values
 * (no recomputation). Only metrics allowed by the template are exposed.
 */
export interface EvaluationReportModel {
  nb_total: number;
  nb_succes: number;
  pct_succes: number;
  nb_echecs: number;
  pct_echecs: number;
  nb_evaluees: number;
  nb_scores_manquants: number;
  failed_queries: { query_id: string; error: string | null }[];
  missing_judge_score_ids: string[];

  duree_totale_s: number;
  duree_target_s: number;
  duree_juge_s: number;
  pct_target_latence: number;
  pct_juge_latence: number;

  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  pct_prompt_tokens: number;
  pct_completion_tokens: number;
  ratio_prompt_completion: number;

  score_moyen_juge: number;
  nb_scores_zero: number;
  nb_validees: number;
  faithfulness_pct: number;

  f1_score: number;
  fact_recall: number;
  answer_quality: number;

  retrieval_recall: number;
}

export interface EvaluationNarrative {
  generatedAt: string;
  agentId: string;
  interpreterTokens?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  } | null;
  content: string;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function numbers(values: (number | undefined)[]): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function pct(part: number, total: number): number {
  return total > 0 ? Number(((part / total) * 100).toFixed(2)) : 0;
}

function seconds(ms: number): number {
  return Number((ms / 1000).toFixed(1));
}

export function buildReportModel(
  results: EvaluationQueryResult[],
  summary: EvaluationRunSummary,
): EvaluationReportModel {
  const total = results.length;
  const completed = results.filter((r) => r.status === 'completed');
  const failed = results.filter((r) => r.status !== 'completed');
  const evaluated = results.filter((r) => typeof r.judge_score === 'number');
  const missingJudge = completed.filter((r) => typeof r.judge_score !== 'number');

  const tokenized = results.filter((r) => typeof r.token_usage?.total_tokens === 'number');
  const totalTokens = tokenized.reduce((sum, r) => sum + (r.token_usage?.total_tokens ?? 0), 0);
  const promptTokens = tokenized.reduce((sum, r) => sum + (r.token_usage?.prompt_tokens ?? 0), 0);
  const completionTokens = tokenized.reduce((sum, r) => sum + (r.token_usage?.completion_tokens ?? 0), 0);

  const meanTotalMs = mean(numbers(results.map((r) => r.duration_ms)));
  const meanTargetMs = mean(numbers(results.map((r) => r.target_duration_ms)));
  const meanJudgeMs = mean(numbers(results.map((r) => r.judge_duration_ms)));

  return {
    nb_total: total,
    nb_succes: completed.length,
    pct_succes: pct(completed.length, total),
    nb_echecs: failed.length,
    pct_echecs: pct(failed.length, total),
    nb_evaluees: evaluated.length,
    nb_scores_manquants: missingJudge.length,
    failed_queries: failed.map((r) => ({ query_id: r.query_id, error: r.error ?? null })),
    missing_judge_score_ids: missingJudge.map((r) => r.query_id),

    duree_totale_s: seconds(meanTotalMs),
    duree_target_s: seconds(meanTargetMs),
    duree_juge_s: seconds(meanJudgeMs),
    pct_target_latence: pct(meanTargetMs, meanTotalMs),
    pct_juge_latence: pct(meanJudgeMs, meanTotalMs),

    total_tokens: totalTokens,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    pct_prompt_tokens: pct(promptTokens, totalTokens),
    pct_completion_tokens: pct(completionTokens, totalTokens),
    ratio_prompt_completion: completionTokens > 0 ? Number((promptTokens / completionTokens).toFixed(1)) : 0,

    score_moyen_juge: mean(numbers(results.map((r) => r.judge_score))),
    nb_scores_zero: results.filter((r) => r.judge_score === 0).length,
    nb_validees: results.filter((r) => r.judge_score === 1).length,
    faithfulness_pct: Number((mean(numbers(results.map((r) => r.judge_faithfulness_score))) * 100).toFixed(2)),

    f1_score: summary.mean_answer_f1,
    fact_recall: summary.mean_fact_recall,
    answer_quality: summary.mean_answer_quality,

    retrieval_recall: summary.mean_file_recall,
  };
}
