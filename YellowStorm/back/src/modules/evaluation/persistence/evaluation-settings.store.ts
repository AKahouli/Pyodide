import type { AdminEvaluationSettings } from '../services/evaluation-settings.service';

/**
 * Store port for agent_evaluation.settings (roadmap P6), the singleton row.
 * Values are the raw persisted columns; the service applies defaults.
 */
export const EVALUATION_SETTINGS_STORE = Symbol('EVALUATION_SETTINGS_STORE');

export type EvaluationSettingsRow = Partial<AdminEvaluationSettings>;

export interface EvaluationSettingsStore {
  find(): Promise<EvaluationSettingsRow | null>;
  upsert(next: AdminEvaluationSettings): Promise<void>;
}
