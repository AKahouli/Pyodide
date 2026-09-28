/**
 * Plain shapes of the agent_evaluation.* rows (types only since the P6
 * PostgreSQL cutover). Ids are 24-hex strings; the JSON API shape is unchanged
 * (`id` instead of Mongo's `_id`, no `__v`).
 */
export type EvaluationRunMode = 'strict' | 'non_strict';
export type EvaluationRunStatus = 'processing' | 'completed' | 'failed';

export interface DatasetItem {
  question: string;
  reference_answer: string;
}

export interface DatasetRecord {
  id: string;
  name: string;
  items: DatasetItem[];
  createdBy: string;
  workspaceId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MetricResult {
  score: number;
  reasoning?: string;
}

export interface EvaluationIteration {
  iterationIndex: number;
  question?: string;
  agentAnswer?: string;
  referenceAnswer?: string;
  responseMatchScore: MetricResult;
  finalResponseMatchV2: MetricResult;
  hallucinationsV1: MetricResult;
  timestamp: string;
  runIndex: number;
}

export interface EvaluationRecord {
  id: string;
  agentId: string;
  scenarioName: string;
  datasetId?: string;
  mode: EvaluationRunMode;
  results: EvaluationIteration[];
  numRuns: number;
  completedRuns: number;
  status: EvaluationRunStatus;
  createdBy: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScenarioRecord {
  id: string;
  name: string;
  agentId: string;
  datasetId: string;
  numRuns: number;
  mode: EvaluationRunMode;
  createdAt: Date;
  updatedAt: Date;
}

/** Fields a client may set on a scenario; anything else in the body is ignored. */
export interface ScenarioInput {
  name?: string;
  agentId?: string;
  datasetId?: string;
  numRuns?: number;
  mode?: EvaluationRunMode;
}
