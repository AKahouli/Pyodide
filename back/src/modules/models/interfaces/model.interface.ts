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

// Internal types
export interface ModelResponse {
  id: string;
  name: string;
  chef: string;
  chefSlug: string;
  litellmModel: string;
  providers: string[];
  isActive: boolean;
  isDefault: boolean;
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
