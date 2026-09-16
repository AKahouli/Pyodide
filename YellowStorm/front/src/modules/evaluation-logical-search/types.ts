export interface BenchmarkQuery {
  query_id: string;
  query: string;
  answer: string;
  required_file: string[];
  page: number[];
}

export interface LogicalSearchEvaluation {
  id: string;
  ownerId: string;
  name: string;
  status: 'dataset_ready' | 'prepared' | 'running' | 'completed' | 'failed';
  sourceFileName: string;
  queryCount: number;
  queries: { queries: BenchmarkQuery[] };
  agentId: string | null;
  flowId: string | null;
  workspaceId: string | null;
  executionId: string | null;
  modelId: string | null;
  answerNodeId: string | null;
  summary: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdhocConfig {
  agentId: string;
  workspaceId?: string;
  modelId?: string;
  fileScope?: string[];
  evaluatorAgentId: string;
  evaluatorModelId?: string;
}

export interface UploadResult {
  evaluationId: string;
  fileName: string;
  sheetName: string;
  queryCount: number;
  skippedRows: number;
  preview: BenchmarkQuery[];
}

export interface PrepareResult {
  evaluationId: string;
  runDir: string;
  answerNodeId: string;
  targetNodeId: string;
  flowId: string;
  files: string[];
  status: string;
}

export interface EvaluationQueryResult {
  query_id: string;
  query: string;
  expected_answer: string;
  required_file: string[];
  page: number[];
  generated_answer: string;
  status: string;
  duration_ms: number;
  error?: string | null;
  metrics: {
    retrieval: {
      expected_files: string[];
      expected_sources: { file: string; page: number | null }[];
      retrieved_files: string[];
      retrieved_count: number;
      retrieved_pages: number[];
      retrieved_sources: { file: string; page: number }[];
      required_files_found: string[];
      matched_sources: { file: string; page: number | null }[];
      file_recall: number;
      file_precision: number;
      page_hit_count: number;
      page_hit: boolean;
      retrieval_success: boolean;
      exact_match: boolean;
    };
    answer: {
      token_recall: number;
      token_precision: number;
      f1: number;
      semantic_similarity: number;
      fact_recall: number;
      fact_precision: number;
      expected_facts: string[];
      generated_facts: string[];
      matched_facts: string[];
      answer_correctness: number;
      answer_quality: number;
      exact_match: boolean;
      expected_answer_clean: string;
      generated_answer_clean: string;
    };
  };
  retrieved_files: string[];
  retrieved_pages: number[];
  retrieved_sources: { file: string; page: number }[];
  judge_score?: number;
  judge_reasoning?: string;
}
