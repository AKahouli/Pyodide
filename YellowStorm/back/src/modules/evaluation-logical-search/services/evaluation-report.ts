import type { EvaluationQueryResult, EvaluationRunSummary } from './evaluation-metrics';

/**
 * Deterministic, LLM-free digest of a completed run. It is the only source of
 * numbers handed to the interpreter agent; the agent must not recompute or
 * invent values.
 */
export interface EvaluationReportModel {
  query_count: number;
  completed_queries: number;
  failed_queries: number;
  evaluated_queries: number;
  failed_queries_detail: { query_id: string; error: string | null }[];
  missing_judge_score_ids: string[];
  durations_ms: { mean_total: number; mean_target: number; mean_judge: number };
  tokens: {
    total: number;
    mean_per_query: number;
    prompt: number;
    completion: number;
    prompt_share: number;
    completion_share: number;
  };
  judge: { mean_score: number; zero_score_count: number; mean_faithfulness: number };
  answer: {
    correctness: number;
    f1: number;
    semantic_similarity: number;
    fact_recall: number;
    fact_precision: number;
    answer_quality: number;
    token_recall: number;
    token_precision: number;
    exact_match_rate: number;
  };
  retrieval: {
    recall: number;
    precision: number;
    page_hit_mean: number;
    success_rate: number;
    exact_match_rate: number;
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function numbers(values: (number | undefined)[]): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

export interface EvaluationNarrativeSections {
  overview: string;
  performance: string;
  retrieval: string;
  tokens: string;
  strengths: string[];
  improvements: string[];
  caveats: string[];
}

export interface EvaluationNarrative {
  generatedAt: string;
  agentId: string;
  interpreterTokens?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  } | null;
  sections: EvaluationNarrativeSections;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Parses the interpreter agent output into fixed sections. Tolerates Markdown
 * code fences; if the output is not JSON, the raw text is surfaced as overview.
 */
export function parseNarrativeSections(raw: string): EvaluationNarrativeSections {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      overview: asString(parsed.overview),
      performance: asString(parsed.performance),
      retrieval: asString(parsed.retrieval),
      tokens: asString(parsed.tokens),
      strengths: asStringList(parsed.strengths),
      improvements: asStringList(parsed.improvements),
      caveats: asStringList(parsed.caveats),
    };
  } catch {
    return { overview: cleaned, performance: '', retrieval: '', tokens: '', strengths: [], improvements: [], caveats: [] };
  }
}

export function buildReportModel(
  results: EvaluationQueryResult[],
  summary: EvaluationRunSummary,
): EvaluationReportModel {
  const completed = results.filter((r) => r.status === 'completed');
  const failed = results.filter((r) => r.status !== 'completed');
  const evaluated = results.filter((r) => typeof r.judge_score === 'number');

  const tokenized = results.filter((r) => typeof r.token_usage?.total_tokens === 'number');
  const totalTokens = tokenized.reduce((sum, r) => sum + (r.token_usage?.total_tokens ?? 0), 0);
  const promptTokens = tokenized.reduce((sum, r) => sum + (r.token_usage?.prompt_tokens ?? 0), 0);
  const completionTokens = tokenized.reduce((sum, r) => sum + (r.token_usage?.completion_tokens ?? 0), 0);

  return {
    query_count: results.length,
    completed_queries: completed.length,
    failed_queries: failed.length,
    evaluated_queries: evaluated.length,
    failed_queries_detail: failed.map((r) => ({ query_id: r.query_id, error: r.error ?? null })),
    missing_judge_score_ids: completed
      .filter((r) => typeof r.judge_score !== 'number')
      .map((r) => r.query_id),
    durations_ms: {
      mean_total: Math.round(mean(numbers(results.map((r) => r.duration_ms)))),
      mean_target: Math.round(mean(numbers(results.map((r) => r.target_duration_ms)))),
      mean_judge: Math.round(mean(numbers(results.map((r) => r.judge_duration_ms)))),
    },
    tokens: {
      total: totalTokens,
      mean_per_query: tokenized.length > 0 ? Math.round(totalTokens / tokenized.length) : 0,
      prompt: promptTokens,
      completion: completionTokens,
      prompt_share: totalTokens > 0 ? Number((promptTokens / totalTokens).toFixed(4)) : 0,
      completion_share: totalTokens > 0 ? Number((completionTokens / totalTokens).toFixed(4)) : 0,
    },
    judge: {
      mean_score: mean(numbers(results.map((r) => r.judge_score))),
      zero_score_count: results.filter((r) => r.judge_score === 0).length,
      mean_faithfulness: mean(numbers(results.map((r) => r.judge_faithfulness_score))),
    },
    answer: {
      correctness: summary.mean_answer_correctness,
      f1: summary.mean_answer_f1,
      semantic_similarity: summary.mean_semantic_similarity,
      fact_recall: summary.mean_fact_recall,
      fact_precision: summary.mean_fact_precision,
      answer_quality: summary.mean_answer_quality,
      token_recall: summary.mean_answer_token_recall,
      token_precision: summary.mean_answer_token_precision,
      exact_match_rate: summary.answer_exact_match_rate,
    },
    retrieval: {
      recall: summary.mean_file_recall,
      precision: summary.mean_file_precision,
      page_hit_mean: summary.mean_page_hit,
      success_rate: summary.retrieval_success_rate,
      exact_match_rate: summary.retrieval_exact_match_rate,
    },
  };
}
