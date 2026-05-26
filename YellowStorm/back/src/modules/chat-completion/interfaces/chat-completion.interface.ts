export type ChatMessageRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

export interface CompletionRequest {
  /** Messages to send to model */
  messages: ChatMessage[];
  /** Model ID (e.g., "gpt-4o") — required */
  modelId: string;
  /** Temperature 0-2 (default 0.7) */
  temperature?: number;
  /** System prompt — prepended to messages if set */
  systemPrompt?: string;
}

export interface CompletionOptions {
  /** Model ID — required */
  modelId: string;
  /** Temperature 0-2 (default 0.7) */
  temperature?: number;
  /** System prompt — prepended if set */
  systemPrompt?: string;
}

export interface CompletionResult {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  latencyMs: number;
}

// LiteLLM /v1/chat/completions response shape (OpenAI-compatible subset)
export interface LiteLLMChatCompletionResponse {
  id: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}
