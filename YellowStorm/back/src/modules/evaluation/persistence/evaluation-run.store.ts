import type {
  EvaluationIteration,
  EvaluationRecord,
  EvaluationRunMode,
  EvaluationRunStatus,
} from '../evaluation.types';

/** Store port for agent_evaluation.evaluations (roadmap P6). */

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
  /** Null when the run does not exist OR belongs to someone else — the two are indistinguishable. */
  findById(id: string, userId: string): Promise<EvaluationRecord | null>;
  /** The creator's own runs for an agent, newest first. */
  findByAgent(agentId: string, userId: string): Promise<EvaluationRecord[]>;
  /**
   * Atomically appends the iterations of one run and counts it as completed,
   * in a single statement (replaces Mongo's `$push` + `$inc`). No-op when the
   * evaluation was deleted meanwhile or belongs to someone else.
   */
  appendRunResults(id: string, userId: string, results: EvaluationIteration[]): Promise<void>;
  /** Returns the updated record, or null when it does not exist or belongs to someone else. */
  finalize(id: string, userId: string, status: Exclude<EvaluationRunStatus, 'processing'>, error?: string): Promise<EvaluationRecord | null>;
  /** No-op when the run belongs to someone else. */
  deleteById(id: string, userId: string): Promise<void>;
}
