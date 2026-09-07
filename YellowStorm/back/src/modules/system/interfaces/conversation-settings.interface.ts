export interface ComposerSuggestionSettings {
  enabled: boolean;
  agentId: string | null;
  debounceMs: number;
  minimumDraftLength: number;
  requestsPerMinute: number;
  maxOutputTokens: number;
}

export interface ConversationNameSettings {
  /** Model id (from the models catalog) used to generate conversation titles. Null = platform default model. */
  modelId: string | null;
}

export interface ConversationSettingsValue {
  composerSuggestions: ComposerSuggestionSettings;
  conversationName: ConversationNameSettings;
  redactSensitiveText: boolean;
  /** End-to-end latency instrumentation for the classic Conversation flow. */
  latencyInstrumentationEnabled: boolean;
}

export interface ConversationSettings extends ConversationSettingsValue {
  updatedAt?: Date;
}

export interface ConversationSettingsAgentOption {
  id: string;
  name: string;
  description?: string;
  agentTypeName?: string;
  model?: string;
}

export const DEFAULT_CONVERSATION_SETTINGS: ConversationSettingsValue = {
  redactSensitiveText: true,
  latencyInstrumentationEnabled: true,
  conversationName: {
    modelId: null,
  },
  composerSuggestions: {
    enabled: true,
    agentId: null,
    debounceMs: 400,
    minimumDraftLength: 3,
    requestsPerMinute: 60,
    maxOutputTokens: 256,
  },
};
