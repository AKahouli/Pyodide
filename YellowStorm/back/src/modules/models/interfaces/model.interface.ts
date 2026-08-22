// LiteLLM /v1/model/info response types
export interface LiteLLMModelInfoEntry {
  model_name: string;
  litellm_params: {
    model: string;
    [key: string]: unknown;
  };
  model_info: {
    id: string;
    litellm_provider: string;
    mode: string;
    max_tokens: number | null;
    max_input_tokens: number | null;
    max_output_tokens: number | null;
    input_cost_per_token: number | null;
    output_cost_per_token: number | null;
    supports_vision: boolean | null;
    supports_function_calling: boolean | null;
    supports_reasoning: boolean | null;
    [key: string]: unknown;
  };
}

export interface LiteLLMModelInfoResponse {
  data: LiteLLMModelInfoEntry[];
}

// Supported model classification types (mirrors LiteLLM model_info.mode values).
// Kept as a single source of truth used by the schema default, the update DTO
// validation and the admin UI.
export const MODEL_TYPES = [
  'chat',
  'completion',
  'embedding',
  'image_generation',
  'audio_transcription',
  'audio_speech',
  'moderation',
  'guardrails_classifier',
  'search',
] as const;

export type ModelType = (typeof MODEL_TYPES)[number];

export const MODEL_INPUT_MODALITIES = ['text', 'image'] as const;
export type ModelInputModality = (typeof MODEL_INPUT_MODALITIES)[number];

export interface ReasoningEffortOption {
  id: string;
  name: string;
  description?: string;
}

// Internal types
export interface ModelResponse {
  id: string;
  name: string;
  chef: string;
  chefSlug: string;
  litellmModel: string;
  providers: string[];
  type: string;
  types: string[];
  isActive: boolean;
  isDefault: boolean;
  omitTemperature: boolean;
  inputModalities: ModelInputModality[];
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  supportsReasoning: boolean | null;
  reasoning: {
    efforts: ReasoningEffortOption[];
    defaultEffort?: string;
  };
}

export interface ModelsListResponse {
  models: ModelResponse[];
  total: number;
}

// Health status (extended with reconnection info)
export interface LiteLLMHealthStatus {
  available: boolean;
  connected: boolean;
  error: string | null;
  lastCheckedAt?: Date;
  reconnectAttempts?: number;
  isReconnecting?: boolean;
}
