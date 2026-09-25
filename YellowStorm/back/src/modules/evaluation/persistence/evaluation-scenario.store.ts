import type { ScenarioInput, ScenarioRecord } from '../evaluation.types';

/** Store port for agent_evaluation.scenarios (roadmap P6). */
export const EVALUATION_SCENARIO_STORE = Symbol('EVALUATION_SCENARIO_STORE');

export type CreateScenarioData = Required<Pick<ScenarioInput, 'name' | 'agentId' | 'datasetId'>>
  & Pick<ScenarioInput, 'numRuns' | 'mode'>;

export interface EvaluationScenarioStore {
  create(data: CreateScenarioData): Promise<ScenarioRecord>;
  findByAgent(agentId: string): Promise<ScenarioRecord[]>;
  findById(id: string): Promise<ScenarioRecord | null>;
  /** Returns the updated record, or null when it does not exist. */
  update(id: string, patch: ScenarioInput): Promise<ScenarioRecord | null>;
  deleteById(id: string): Promise<void>;
}
