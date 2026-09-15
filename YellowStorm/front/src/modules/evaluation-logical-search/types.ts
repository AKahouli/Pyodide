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
  flowId: string;
  files: string[];
  status: string;
}
