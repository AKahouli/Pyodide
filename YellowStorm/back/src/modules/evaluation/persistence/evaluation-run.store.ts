import type {
  EvaluationIteration,
  EvaluationRecord,
  EvaluationRunMode,
  EvaluationRunStatus,
} from '../evaluation.types';

/** Store port for agent_evaluation.evaluations (roadmap P6). */
export const EVALUATION_RUN_STORE = Symbol('EVALUATION_RUN_STORE');

export interface CreateEvaluationData {
  agentId: string;
  scenarioName: string;
  datasetId: string;
  mode: EvaluationRunMode;
  numRuns: number;
  createdBy: string;
}

export interface EvaluationRunStore {
  create(data: CreateEvaluationData): Promise<EvaluationRecord>;
  findById(id: string): Promise<EvaluationRecord | null>;
  /** Newest first. */
  findByAgent(agentId: string): Promise<EvaluationRecord[]>;
  /**
   * Atomically appends the iterations of one run and counts it as completed,
   * in a single statement (replaces Mongo's `$push` + `$inc`). No-op when the
   * evaluation was deleted meanwhile.
   */
  appendRunResults(id: string, results: EvaluationIteration[]): Promise<void>;
  /** Returns the updated record, or null when it does not exist. */
  finalize(id: string, status: Exclude<EvaluationRunStatus, 'processing'>, error?: string): Promise<EvaluationRecord | null>;
  deleteById(id: string): Promise<void>;
}
