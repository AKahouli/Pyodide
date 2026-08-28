export interface ComposerSuggestionSettings {
  enabled: boolean;
  agentId: string | null;
  debounceMs: number;
  minimumDraftLength: number;
  requestsPerMinute: number;
  maxOutputTokens: number;
}

export interface ConversationSettingsValue {
  composerSuggestions: ComposerSuggestionSettings;
  redactSensitiveText: boolean;
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
  composerSuggestions: {
    enabled: true,
    agentId: null,
    debounceMs: 400,
    minimumDraftLength: 3,
    requestsPerMinute: 60,
    maxOutputTokens: 256,
  },
};
