export interface AiProxyErrorBody {
  error: {
    message: string;
    type: string;
    param?: string;
    code?: string;
  };
}

export interface LiteLlmErrorResponse {
  error?: {
    message?: string;
  };
}

export interface LiteLlmTokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export type AiProxyResolvedTokens =
  | { status: 'known'; promptTokens: number; completionTokens: number; totalTokens?: number }
  | { status: 'unknown' };

export interface AiProxyModelPricing {
  inputCostPerToken: number | null;
  outputCostPerToken: number | null;
  cachedInputCostPerToken?: number | null;
  provider?: string;
  version?: string;
}

export interface AiProxyUsageMetadata {
  tokensStatus: 'known' | 'unknown';
  streaming: boolean;
  litellmRequestId?: string;
  error?: string;
  pricing?: AiProxyModelPricing;
  estimatedCost?: number | null;
}
