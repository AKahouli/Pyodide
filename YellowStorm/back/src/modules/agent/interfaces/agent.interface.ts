export interface IAgentConnectorActionSelectionResponse {
  connectorId: string;
  actionKeys: string[];
}

export type AgentPermissionLevel = 'read' | 'write';

export type GuardrailMode = 'monitor' | 'balanced' | 'strict';

export interface PromptInjectionGuardrailsConfig {
  inputEnabled: boolean;
  outputEnabled: boolean;
  mode: GuardrailMode;
  inputClassifierPrompt: string;
  outputClassifierPrompt: string;
  blockMessage: string;
}

export interface ToolActionReviewConfig {
  enabled: boolean;
  mode: GuardrailMode;
  classifierPrompt: string;
  blockMessage: string;
}

export interface AgentGuardrails {
  promptInjection: PromptInjectionGuardrailsConfig;
  toolActionReview: ToolActionReviewConfig;
}

export interface AgentDeploymentSettings {
  embedEnabled: boolean;
  restEnabled: boolean;
  widget: AgentWidgetSettings;
}

export type WidgetThemePreset =
  | 'yellowstorm-modern'
  | 'public-service-light'
  | 'pold-magenta'
  | 'neutral-blue'
  | 'high-contrast-light'
  | 'dark-modern';

export type WidgetAccessibilityProfile =
  | 'standard' | 'low-vision' | 'high-contrast-light' | 'high-contrast-dark'
  | 'cognitive-comfort' | 'motor-assistance' | 'low-stimulation';

export interface WidgetAccessibilitySettings {
  enabled: boolean; showSettingsButton: boolean; defaultProfile: WidgetAccessibilityProfile; availableProfiles: WidgetAccessibilityProfile[];
  allowTextResize: boolean; allowLineSpacing: boolean; allowLetterSpacing: boolean; allowFontSelection: boolean; allowLinkUnderlining: boolean; allowHighContrast: boolean; allowCustomAccessibleColors: boolean; allowMotionControl: boolean; allowLargeTargets: boolean; allowSimplifiedMode: boolean; allowEnhancedFocus: boolean;
  enforceMinimumContrast: boolean; minimumTextContrastRatio: number; minimumUiContrastRatio: number;
  voiceInput: { enabled: boolean; language: string; continuous: boolean; interimResults: boolean; autoPunctuation: boolean; autoSend: false; stopAfterSilenceMs: number; retainAudio: false };
  readAloud: { enabled: boolean; autoPlay: false; defaultRate: number; highlightCurrentSentence: boolean; readSourcesByDefault: boolean };
  screenReader: { announceStreaming: boolean; announcementIntervalMs: number; announceChoices: boolean; announceSources: boolean; announceCompletion: boolean };
  keyboard: { shortcutsEnabled: boolean; microphoneShortcut: string; accessibilityPanelShortcut: string; readAloudShortcut: string };
}

export interface WidgetSuggestion {
  id: string;
  label: string;
  prompt: string;
  icon?: string;
  enabled: boolean;
  sortOrder: number;
}

export interface AgentWidgetSettings {
  version: 1;
  appSourceName: string;
  identity: {
    organizationName?: string;
    assistantTitle: string;
    assistantSubtitle?: string;
    avatarMode: 'initials' | 'icon' | 'none';
    avatarInitials?: string;
  };
  launcher: {
    label: string;
    mobileLabel?: string;
    variant: 'pill' | 'circle';
    position: 'bottom-right' | 'bottom-left';
    showUnreadBadge: boolean;
    showIntroTooltip: boolean;
    introTooltipText?: string;
  };
  theme: {
    preset: WidgetThemePreset;
    customEnabled: boolean;
    colors: Record<string, string | undefined>;
    radius: 'sm' | 'md' | 'lg' | 'xl';
    density: 'comfortable' | 'compact';
  };
  layout: {
    desktopWidth: 360 | 400 | 480;
    desktopHeight: 520 | 620 | 720;
  };
  content: {
    greetingTitle: string;
    greetingBody?: string;
    suggestions: WidgetSuggestion[];
    privacyNotice?: string;
    footerText?: string;
    footerLinks?: Array<{ label: string; url: string }>;
  };
  labels: {
    inputPlaceholder: string;
    sendButton: string;
    closeButton: string;
    optionsButton: string;
    newConversation: string;
    copyTranscript: string;
    copyMessage: string;
    downloadTranscript: string;
    transcriptCopied: string;
    messageCopied: string;
    transcriptDownloaded: string;
    emptyTranscript: string;
    errorGeneric: string;
    errorReset: string;
    typing: string;
    sourcesUsedSingular: string;
    sourcesUsedPlural: string;
    choiceSubmit: string;
    choiceDismiss: string;
    choiceDismissed: string;
    choiceDismissMessage: string;
    choiceOtherLabel: string;
    choiceSendError: string;
    choiceWaitForReply: string;
    accessibilitySettings: string;
    accessibilitySettingsTitle: string;
    accessibilitySettingsDescription: string;
    accessibilityProfile: string;
    accessibilityClose: string;
    accessibilityReset: string;
    microphoneStart: string;
    microphoneUnavailable: string;
    microphoneListening: string;
    readAloud: string;
    stopReading: string;
    readAloudUnavailable: string;
  };
  behavior: {
    defaultOpen: boolean;
    persistVisitorId: boolean;
    allowTranscriptCopy: boolean;
    allowTranscriptDownload: boolean;
    allowNewConversation: boolean;
    requirePrivacyNotice: boolean;
  };
  accessibility: WidgetAccessibilitySettings;
}

/** A single share entry on an agent (owner's view of who it's shared with). */
export interface IAgentShareEntry {
  shareId: string;
  permission: AgentPermissionLevel;
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
  createdAt: Date;
}

/** Info about an agent shared with the current user (populated for non-owners). */
export interface ISharedAgentInfo {
  shareId: string;
  permission: AgentPermissionLevel;
  sharedBy: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
}

export interface IAgentResponse {
  id: string;
  name: string;
  slug: string;
  agentType: { id: string; name: string; slug: string };
  role: string;
  description: string;
  temperature: number;
  model?: string;
  reasoning_effort?: string;
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];
  tools: string[];
  connectors?: string[];
  connectorActionSelections?: IAgentConnectorActionSelectionResponse[];
  guardrails: AgentGuardrails;
  deploymentSettings: AgentDeploymentSettings;
  enable_temporary_child_agents: boolean;
  max_temporary_child_agents: number;
  /** True when the agent has the "smart-memory" connector (slug === 'smart-memory'). */
  hasSmartMemory?: boolean;
  skills?: string[];
  disabledSkills?: string[];
  isDefault: boolean;
  isDefaultForType: boolean;
  isActive: boolean;
  // A2A publishing state (non-secret). The API key is never returned here; it is
  // only surfaced once by the dedicated publish/rotate endpoints.
  a2aPublished: boolean;
  a2aAgentCardUrl?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  // Present when the agent was shared with the current user (non-owner).
  shareInfo?: ISharedAgentInfo;
}

export interface IAgentForStream {
  id: string;
  name: string;
  agentTypeName: string;
  agentTypeSlug: string;
  agentTypeId: string;
  role: string;
  description: string;
  temperature: number;
  model?: string;
  reasoningEffort?: string;
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];
  toolIds: string[];
  connectorIds?: string[];
  connectorActionSelections?: IAgentConnectorActionSelectionResponse[];
  guardrails: AgentGuardrails;
  connectorSkillIds?: string[];
  skillIds?: string[];
  disabledSkillIds?: string[];
  agentTypeSkillIds?: string[];
  enable_temporary_child_agents: boolean;
  max_temporary_child_agents: number;
  isDefault: boolean;
  isDefaultForType: boolean;
}

export interface IGrpcWorkspaceContext {
  workspace_id: string;
  workspace_name?: string;
  chunks?: number;
  hybrid_search?: boolean;
  instruction?: string;
  tag?: string;
  workspace_documents: Array<{
    _id: string;
    filename: string;
    filepath: string;
    in_memory: boolean;
    language: string;
    indexing_token: number;
    workspace_id: string;
    workspace_name?: string;
    file_name?: string;
    createdAt: string;
  }>;
}

/** Proto-shaped (snake_case) compaction config carried on the gRPC Chatbot message. */
export interface IGrpcCompaction {
  enabled: boolean;
  compaction_interval: number;
  overlap_size: number;
  token_fraction: number;
  event_retention_size: number;
  summarizer_model: string;
}

export interface IGrpcAgent {
  id: string;
  name: string;
  description: string;
  prompt: string;
  agent_type: string;
  save_memory: boolean;
  tools: Record<string, unknown>[];
  skills?: Array<Record<string, unknown>>;
  brain_context: IGrpcWorkspaceContext[];
  chatbot: {
    model: string;
    input_modalities: string[];
    reasoning_effort?: string;
    context_window_tokens?: number;
    compaction?: IGrpcCompaction;
  };
  agent_params?: {
    params: Record<string, string>;
  };
  connector_bindings?: Record<string, unknown>[];
  connectorIds?: string[];
}
