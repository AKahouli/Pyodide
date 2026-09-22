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

/** ADK context-compaction defaults. Sent on each chat request; token_threshold is
 *  derived engine-side as tokenFraction * model context window. */
export interface CompactionSettings {
  enabled: boolean;
  /** Sliding window: new invocations between compactions (0 = sliding window off). */
  compactionInterval: number;
  /** Sliding window: prior invocations re-summarized for continuity. */
  overlapSize: number;
  /** Token trigger: threshold = tokenFraction * context window, 0..1 (0 = token trigger off). */
  tokenFraction: number;
  /** Token trigger: recent raw events kept un-compacted. */
  eventRetentionSize: number;
  /** LiteLLM model used to summarize; empty = fall back to the chat model. */
  summarizerModel: string;
}

export interface AttachmentIntelligenceSettings {
  enabled: boolean;
  /** CSV/XLS/XLSX files with more non-empty rows than this are never indexed (CODE_ONLY). */
  maxIndexedTabularRows: number;
}

export interface ConversationSettingsValue {
  composerSuggestions: ComposerSuggestionSettings;
  conversationName: ConversationNameSettings;
  redactSensitiveText: boolean;
  /** End-to-end latency instrumentation for the classic Conversation flow. */
  latencyInstrumentationEnabled: boolean;
  compaction: CompactionSettings;
  attachmentIntelligence: AttachmentIntelligenceSettings;
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
  compaction: {
    enabled: true,
    compactionInterval: 10,
    overlapSize: 2,
    tokenFraction: 0.75,
    eventRetentionSize: 6,
    summarizerModel: '',
  },
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
  attachmentIntelligence: {
    enabled: false,
    maxIndexedTabularRows: 5000,
  },
};
