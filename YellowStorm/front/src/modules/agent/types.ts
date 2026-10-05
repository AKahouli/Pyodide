/**
 * Agent Module Types
 */

export type RootConfigurationMode = 'native' | 'root_constrained';

export interface RootDelegateModeOverride {
  agentId: string;
  configurationMode: RootConfigurationMode;
}

/** Mirrors the backend RootExecutionPolicyV1 (WP01); version 1 only. */
export interface RootExecutionPolicy {
  version: 1;
  delegation: { enabled: boolean; defaultConfigurationMode: RootConfigurationMode };
  temporaryWorkers: { enabled: boolean; maxPerWorkGroup: number };
  fanout: { enabled: boolean; maxItems: number; allowBackground: boolean };
  background: {
    enabled: boolean;
    maxOutstandingPerConversation: number;
    taskTimeoutSeconds: number;
    maxAttempts: number;
  };
  limits: {
    maxDepth: 1;
    maxParallelWorkers: number;
    maxChildExecutionsPerWorkGroup: number;
    maxWorkGroupDurationSeconds: number;
  };
  perAgentModeOverrides?: RootDelegateModeOverride[];
}

export interface Agent {
  id: string;
  name: string;
  slug: string;
  agentType: { id: string; name: string; slug?: string };
  role: string;
  description: string;
  temperature: number;
  model?: string;
  reasoning_effort?: string;
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];
  tools: string[];
  skills?: string[];
  disabledSkills?: string[];
  connectors?: string[];
  connectorActionSelections?: AgentConnectorActionSelection[];
  guardrails?: AgentGuardrails;
  deploymentSettings?: AgentDeploymentSettings;
  enable_temporary_child_agents?: boolean;
  max_temporary_child_agents?: number;
  /** Root-delegation policy; present only when the agent is enrolled as a root. */
  rootExecutionPolicy?: RootExecutionPolicy;
  delegateAgentIds?: string[];
  delegateTeamIds?: string[];
  /** True when the agent has the "smart-memory" connector. */
  hasSmartMemory?: boolean;
  isDefault: boolean;
  isDefaultForType: boolean;
  isActive: boolean;
  /** Whether this agent has been published over the A2A protocol. */
  a2aPublished?: boolean;
  /** A2A agent-card URL, absolute (only present once published). */
  a2aAgentCardUrl?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Present when the agent was shared with the current user (non-owner). */
  shareInfo?: SharedAgentInfo;
}

export interface PromptInjectionGuardrailsConfig {
  inputEnabled: boolean;
  outputEnabled: boolean;
  mode: GuardrailMode;
  inputClassifierPrompt: string;
  outputClassifierPrompt: string;
  blockMessage: string;
}

export type GuardrailMode = 'monitor' | 'balanced' | 'strict';

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
  | 'standard'
  | 'low-vision'
  | 'high-contrast-light'
  | 'high-contrast-dark'
  | 'cognitive-comfort'
  | 'motor-assistance'
  | 'low-stimulation';

export interface WidgetAccessibilitySettings {
  enabled: boolean;
  showSettingsButton: boolean;
  defaultProfile: WidgetAccessibilityProfile;
  availableProfiles: WidgetAccessibilityProfile[];
  allowTextResize: boolean;
  allowLineSpacing: boolean;
  allowLetterSpacing: boolean;
  allowFontSelection: boolean;
  allowLinkUnderlining: boolean;
  allowHighContrast: boolean;
  allowCustomAccessibleColors: boolean;
  allowMotionControl: boolean;
  allowLargeTargets: boolean;
  allowSimplifiedMode: boolean;
  allowEnhancedFocus: boolean;
  enforceMinimumContrast: boolean;
  minimumTextContrastRatio: number;
  minimumUiContrastRatio: number;
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
    organizationName: string;
    assistantTitle: string;
    assistantSubtitle: string;
    avatarMode: 'initials' | 'icon' | 'none';
    avatarInitials: string;
  };
  launcher: {
    label: string;
    mobileLabel: string;
    variant: 'pill' | 'circle';
    position: 'bottom-right' | 'bottom-left';
    showUnreadBadge: boolean;
    showIntroTooltip: boolean;
    introTooltipText: string;
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
    greetingBody: string;
    suggestions: WidgetSuggestion[];
    privacyNotice: string;
    footerText: string;
    footerLinks: Array<{ label: string; url: string }>;
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

export type AgentPermissionLevel = 'read' | 'write';

/** Info about an agent shared with the current user (non-owner). */
export interface SharedAgentInfo {
  shareId: string;
  permission: AgentPermissionLevel;
  sharedBy: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
}

export interface ShareAgentData {
  emails: string[];
  permission: AgentPermissionLevel;
}

/** A single share entry on an agent (owner's view of who it's shared with). */
export interface AgentShareEntry {
  shareId: string;
  permission: AgentPermissionLevel;
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
  createdAt: string;
}

/** A user returned by the autocomplete search when sharing an agent. */
export interface UserSearchResult {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Credentials returned (once) when publishing an agent over A2A or rotating its
 * key. The `apiKey` is shown to the user a single time and is never persisted.
 */
export interface A2APublishResult {
  agentId: string;
  agentCardUrl: string;
  apiKey: string;
  apiKeyHeader: string;
}

export interface A2ARotateKeyResult {
  agentId: string;
  agentCardUrl: string;
  apiKey: string;
  apiKeyHeader: string;
}

export interface A2ARevokeResult {
  agentId: string;
  revoked: boolean;
}

/** Plain widget token returned once on creation for embed deployment. */
export interface WidgetTokenResponse {
  id: string;
  token: string;
  agentId: string;
}

/**
 * Read-side representation of a Telegram integration for an agent.
 * The bot token is never returned by the backend; `hasToken` only signals
 * whether a token is already stored so the UI can preserve it.
 */
export interface AgentTelegramIntegration {
  enabled: boolean;
  hasToken: boolean;
  botUsername?: string;
  status?: 'pending' | 'active' | 'error';
  webhookRegistered?: boolean;
  messageKey?: 'webhook_success' | 'webhook_failed' | 'polling' | 'disabled' | 'saved';
  errorMessage?: string;
  linkCode?: string;
  linkCodeExpiresAt?: string;
  updatedAt?: string;
}

export interface AgentTelegramIntegrationInput {
  enabled: boolean;
  botToken?: string;
}

export interface AgentType {
  id: string;
  name: string;
  slug: string;
  prePrompt: string;
  skills?: string[];
  isActive: boolean;
}

export interface SkillOption {
  id: string;
  name: string;
  description: string;
  /** Presentation + category metadata returned by GET /skills/active (optional for backward compat). */
  icon?: string;
  color?: string;
  iconColor?: 'light' | 'dark';
  categoryId?: string | null;
  /** Resolved category name; used to exclude "System" skills. */
  categoryName?: string | null;
}

export interface ConnectorActionOption {
  workerAccess?: 'inherit' | 'allow' | 'block';
  executionKind?: 'inherit' | 'leaf' | 'orchestration' | 'unknown';
  key: string;
  label: string;
  description: string;
  isEnabled: boolean;
}

export interface AgentConnectorActionSelection {
  connectorId: string;
  actionKeys: string[];
}

export interface AgentState {
  agents: Agent[];
  agentTypes: AgentType[];
  datasets: Dataset[];
  evaluations: Evaluation[];
  scenarios: Scenario[];
  isLoading: boolean;
  isEvaluationLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  lastFetchedAt: Date | null;
}

export interface MetricResult {
  score: number;
  reasoning?: string;
}

export interface EvaluationIteration {
  iterationIndex: number;
  question?: string;
  referenceAnswer?: string;
  agentAnswer?: string;
  responseMatchScore: MetricResult;
  finalResponseMatchV2: MetricResult;
  hallucinationsV1: MetricResult;
  timestamp: string;
  runIndex: number;
  status?: 'success' | 'failed';
  error?: string;
}

export interface Evaluation {
  id: string;
  agentId: string;
  scenarioName: string;
  mode: 'strict' | 'non_strict';
  status: 'processing' | 'completed' | 'failed';
  numRuns?: number;
  completedRuns?: number;
  datasetId?: string;
  results: EvaluationIteration[];
  error?: string;
  createdAt: string;
}

export interface DatasetItem {
  question: string;
  reference_answer: string;
}

export interface Dataset {
  id: string;
  name: string;
  items: DatasetItem[];
}

export interface Scenario {
  id: string;
  name: string;
  agentId: string;
  datasetId?: string;
  numRuns: number;
  mode: string;
}

export interface LaunchEvaluationData {
  agentId: string;
  datasetId: string;
  numRuns: number;
  mode: string;
  scenarioName: string;
  judgeModel?: string;
  threshold?: number;
}

export interface RunEvaluationParams {
  agentId: string;
  datasetId: string;
  numRuns: number;
  mode: string;
  scenarioName: string;
  judgeModel?: string;
  threshold?: number;
}

export interface BulkDeleteError {
  id: string;
  name?: string;
  error: Error;
}

export interface BulkDeleteResult {
  deletedIds: string[];
  errors: BulkDeleteError[];
}

export interface AgentActions {
  fetchAgents: () => Promise<void>;
  fetchAgentTypes: () => Promise<void>;
  createAgent: (data: CreateAgentData) => Promise<Agent>;
  updateAgent: (id: string, data: UpdateAgentData) => Promise<Agent>;
  deleteAgent: (id: string) => Promise<void>;
  /** Remove an agent shared with the current user from their own list. */
  unshareAgent: (id: string) => Promise<void>;
  bulkDeleteAgents: (
    ids: string[],
    onProgress?: (done: number, total: number) => void,
  ) => Promise<BulkDeleteResult>;
  getPersonalAgents: () => Agent[];
  getDefaultAgents: () => Agent[];
  getAgentById: (id: string) => Agent | undefined;
  refreshAgents: () => Promise<void>;
  publishAgentToA2A: (id: string) => Promise<A2APublishResult>;
  rotateAgentA2AKey: (id: string) => Promise<A2ARotateKeyResult>;
  revokeAgentA2A: (id: string) => Promise<A2ARevokeResult>;

  // Evaluation Actions
  fetchDatasets: () => Promise<void>;
  createDataset: (name: string, items: DatasetItem[]) => Promise<Dataset>;
  deleteDataset: (id: string) => Promise<void>;
  fetchScenarios: (agentId: string) => Promise<void>;
  createScenario: (data: Partial<Scenario>) => Promise<Scenario>;
  updateScenario: (id: string, data: Partial<Scenario>) => Promise<Scenario>;
  deleteScenario: (id: string) => Promise<void>;
  fetchEvaluations: (agentId: string) => Promise<void>;
  updateEvaluation: (id: string, data: Partial<Evaluation>) => void;
  deleteEvaluation: (id: string) => Promise<void>;
  runEvaluation: (params: RunEvaluationParams) => void;

  reset: () => void;
}

export type AgentStore = AgentState & AgentActions;

export interface CreateAgentData {
  name: string;
  slug: string;
  agentType: string;
  role: string;
  description?: string;
  temperature?: number;
  model?: string;
  reasoning_effort?: string;
  instruction?: string;
  ignorePrePrompt?: boolean;
  knowledgeBases?: string[];
  tools?: string[];
  skills?: string[];
  disabledSkills?: string[];
  connectors?: string[];
  connectorActionSelections?: AgentConnectorActionSelection[];
  isActive?: boolean;
  isDefaultForType?: boolean;
  deploymentSettings?: AgentDeploymentSettings;
  enable_temporary_child_agents?: boolean;
  max_temporary_child_agents?: number;
  rootExecutionPolicy?: RootExecutionPolicy;
  delegateAgentIds?: string[];
  delegateTeamIds?: string[];
}

export interface UpdateAgentData {
  name?: string;
  slug?: string;
  agentType?: string;
  role?: string;
  description?: string;
  temperature?: number;
  model?: string;
  reasoning_effort?: string;
  instruction?: string;
  ignorePrePrompt?: boolean;
  knowledgeBases?: string[];
  tools?: string[];
  skills?: string[];
  disabledSkills?: string[];
  connectors?: string[];
  connectorActionSelections?: AgentConnectorActionSelection[];
  isActive?: boolean;
  isDefaultForType?: boolean;
  guardrails?: AgentGuardrails;
  deploymentSettings?: AgentDeploymentSettings;
  enable_temporary_child_agents?: boolean;
  max_temporary_child_agents?: number;
  rootExecutionPolicy?: RootExecutionPolicy;
  delegateAgentIds?: string[];
  delegateTeamIds?: string[];
}
