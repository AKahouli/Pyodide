/**
 * Store port for catalog.ai_models (plan 1B.3.1). Rows mirror the former
 * Mongo documents; the service maps rows to the public ModelResponse.
 */

export interface ModelRow {
  id: string;
  modelId: string;
  name: string;
  chef: string;
  chefSlug: string;
  litellmModel: string;
  providers: string[];
  type: string;
  types: string[];
  isActive: boolean;
  isDefault: boolean;
  isConversationV2Default: boolean;
  omitTemperature: boolean;
  inputModalities: string[];
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  inputCostPerToken: number | null;
  outputCostPerToken: number | null;
  cachedInputCostPerToken: number | null;
  supportsReasoning: boolean | null;
  reasoningEfforts: unknown[];
  defaultReasoningEffort: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Fields required for a new row; the rest fall back to column defaults. */
export type NewModelRow = Partial<Omit<ModelRow, 'id' | 'modelId' | 'name' | 'chef' | 'chefSlug' | 'createdAt' | 'updatedAt'>> &
  Pick<ModelRow, 'modelId' | 'name' | 'chef' | 'chefSlug'>;

export type ModelPatch = Partial<Omit<NewModelRow, 'providers' | 'reasoningEfforts'>> & {
  providers?: string[];
  reasoningEfforts?: unknown[];
};

export interface ModelFindOptions {
  activeOnly?: boolean;
  chatOnly?: boolean;
  chefSlug?: string;
}

export interface ModelStore {
  findByModelId(modelId: string): Promise<ModelRow | null>;
  findByIdOrLitellmModel(id: string): Promise<ModelRow | null>;
  list(options: ModelFindOptions): Promise<ModelRow[]>;
  /**
   * INSERT ... ON CONFLICT (model_id) DO NOTHING. Returns false when the model
   * already existed (e.g. a concurrent sync on another instance inserted it first),
   * so callers never hit a unique violation that would abort their savepoint.
   */
  insertIfAbsent(row: NewModelRow): Promise<boolean>;
  /** `defaultReasoningEffort: null` clears the column. */
  updateByModelId(modelId: string, patch: ModelPatch): Promise<ModelRow | null>;
  /** Deactivate every model not in `modelIds`; returns the affected count. */
  deactivateNotIn(modelIds: string[]): Promise<number>;
  /** Remove the guardrails_classifier classification from all other active models. */
  clearGuardrailsClassifierExcept(modelId: string): Promise<void>;
  /**
   * Clear the flag on its current holder and set it on `modelId` in one
   * transaction — required by uq_ai_models_single_default.
   */
  setExclusiveFlag(modelId: string, flag: 'isDefault' | 'isConversationV2Default'): Promise<ModelRow | null>;
  findDefault(): Promise<ModelRow | null>;
  findConversationV2Default(): Promise<ModelRow | null>;
  findGuardrailsClassifier(): Promise<ModelRow | null>;
}
