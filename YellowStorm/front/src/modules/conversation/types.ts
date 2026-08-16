export interface GroupMember {
  userId: string;
  joinedAt: string;
  status: 'owner' | 'member';
  name?: string;
  email?: string;
  job?: string;
  mentions?: {
    messageId: string;
    seenAt?: string;
  }[];
}

export type InvitedUserStatus = 'Confirmed' | 'Guest';

export interface InvitedUser {
  email: string;
  status: InvitedUserStatus;
  invitedAt: string;
  job?: string;
}

export interface GroupConversationMeta {
  isGroup: true;
  members: GroupMember[];
  invitedUsers: InvitedUser[];
  taggedAgents?: string[];
}

export interface Conversation {
  id: string;
  title: string;
  createdBy: string;
  ownerName?: string;
  messageCount: number;
  lastMessageAt: string;
  isArchived: boolean;
  isShared: boolean;
  workspaces?: string[];
  selectedSkills?: string[];
  /** Sticky routing agents (last @mention set); backend reuses when next turn has no tags. */
  taggedAgentIds?: string[];
  systemWorkspaceId?: string;
  createdAt: string;
  updatedAt: string;
  groupMeta?: GroupConversationMeta;
  projectId?: string | null;
  runtimeMode?: 'standard' | 'governed';
  runtimePurpose?: 'chat' | 'platform_copilot';
  pinnedAgentId?: string | null;
  governanceContext?: { programId: string; scopeId: string; deploymentId: string; revisionId: string; revisionNumber: number; pinnedAt: string; runtimeDefinition: { primaryAgentId: string; allowedAgentIds: string[]; workspaceIds: string[] } };
  branchProvenance?: { sourceConversationId: string; sourceTargetMessageId: string; branchedAt: string };
}

export interface BranchConversationPayload {
  requestId: string;
  targetMessageId: string;
  activeBranches: Record<string, string>;
}

export interface ComposerSuggestionSettings {
  enabled: boolean;
  agentId: string | null;
  debounceMs: number;
  minimumDraftLength: number;
  requestsPerMinute: number;
  maxOutputTokens: number;
}

export interface ConversationSettings {
  composerSuggestions: ComposerSuggestionSettings;
  updatedAt?: string;
}

export interface AttachedFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
}

export type ReliabilityEvaluationStatus = 'pending' | 'completed' | 'insufficient_evidence' | 'not_applicable' | 'failed';
export type ReliabilityClaimStatus = 'supported' | 'partially_supported' | 'unsupported' | 'contradicted';
export type ReliabilityClaimImportance = 'critical' | 'major' | 'minor';
export type ReliabilityLabel = 'strongly_supported' | 'mostly_supported' | 'needs_verification' | 'high_hallucination_risk';

export interface ReliabilityFinding {
  claim: string;
  status: ReliabilityClaimStatus;
  importance: ReliabilityClaimImportance;
  explanation: string;
  evidenceIds?: string[];
}

export interface ReliabilityEvaluation {
  status: ReliabilityEvaluationStatus;
  score?: number;
  label?: ReliabilityLabel;
  summary?: string;
  claimCounts?: { total: number; supported: number; partiallySupported: number; unsupported: number; contradicted: number };
  claims?: ReliabilityFinding[];
  findings?: ReliabilityFinding[];
  evaluator?: { modelId: string; modelName: string; evaluatorVersion: string; promptVersion: string };
  requestedAt?: string;
  evaluatedAt?: string;
  durationMs?: number;
  failureCode?: string;
}

export interface ReliabilityRerunResponse {
  messageId: string;
  reliabilityEvaluation: ReliabilityEvaluation;
}

export type ResponseCorrectionStatus = 'queued' | 'correcting' | 're_evaluating' | 'corrected' | 'failed' | 'abstained' | 'human_review_required';
export type ActiveAnswerVersion = 'original' | 'corrected' | 'abstention';
export type DisplayedAnswerVersion = ActiveAnswerVersion | `attempt:${string}`;

export interface AppliedCorrection {
  claim: string;
  action: 'removed' | 'qualified' | 'replaced' | 'citation_repaired';
  explanation: string;
  evidenceIds?: string[];
}

export type CorrectionPolicyReason = 'policy_requirements_met' | 'answer_empty' | 'evaluation_not_applicable' | 'evaluation_not_completed' | 'score_below_threshold' | 'score_below_original' | 'critical_claim_unresolved' | 'candidate_generation_failed' | 'candidate_evaluation_failed';
export interface ResponseCorrectionAttempt {
  attemptId: string;
  attemptNumber: number;
  strategy?: 'existing_evidence' | 'corrective_replay';
  status: 'generating' | 'generated' | 'evaluating' | 'accepted' | 'rejected' | 'failed';
  decision?: 'accepted' | 'rejected' | 'failed';
  policyReasons: CorrectionPolicyReason[];
  components?: MessageComponent[];
  evaluation?: ReliabilityEvaluation;
  appliedCorrections?: AppliedCorrection[];
  remainingUncertainties?: string[];
  failureCode?: string;
  createdAt: string;
  generatedAt?: string;
  completedAt?: string;
  correctionModel?: { modelId: string; modelName: string; correctorVersion: string; promptVersion: string };
}

export interface ResponseCorrectionWorkflow {
  mode: 'corrective_transparent';
  status: ResponseCorrectionStatus;
  activeVersion: ActiveAnswerVersion;
  originalScore?: number;
  threshold: number;
  attemptCount: number;
  maxAttempts: number;
  correctedComponents?: MessageComponent[];
  finalReliabilityEvaluation?: ReliabilityEvaluation;
  appliedCorrections?: AppliedCorrection[];
  remainingUncertainties?: string[];
  failureBehavior: 'publish_with_warning' | 'abstain' | 'require_human_review';
  failureCode?: string;
  showOriginalAnswer: boolean;
  reviewReportId?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  correctionModel?: { modelId: string; modelName: string; correctorVersion: string; promptVersion: string };
  strategy?: 'existing_evidence' | 'corrective_replay';
  attempts?: ResponseCorrectionAttempt[];
  publishedAttemptId?: string;
  correctionRunId?: string;
  leaseExpiresAt?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId?: string;
  conversationType: 'user' | 'ai';
  content?: string;
  components?: MessageComponent[];
  interaction?: ChoiceInteractionMetadata;
  attachedFileIds?: string[];
  attachedFiles?: AttachedFile[];
  modelId?: string;
  /** Agents used for this turn (mentions or sticky reuse from backend). */
  agentIds?: string[];
  memberIds?: string[];
  webSearchEnabled?: boolean;
  questionMessageId?: string;
  answerMessageId?: string;
  feedback?: 'like' | 'dislike';
  isEdited?: boolean;
  editedAt?: string;
  isStreaming?: boolean;
  isComplete?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
  parentMessageId?: string; // Reference to the message being replied to
  reliabilityEvaluation?: ReliabilityEvaluation;
  correctionWorkflow?: ResponseCorrectionWorkflow;
  createdAt: string;
}

export type ChartKind = 'line' | 'bar' | 'area' | 'pie' | 'scatter' | 'composed';

export type ChartLayout = 'horizontal' | 'vertical';

export interface ChartSeriesConfig {
  dataKey: string;
  color?: string;
  label?: string;
  kind?: ChartKind;
}

export interface ChartConfigEntry {
  label?: string;
  color?: string;
}

export type ChartConfigMap = Record<string, ChartConfigEntry>;

export interface ChartComponentData extends Record<string, unknown> {
  title?: string;
  data: Record<string, unknown>[];
  config: ChartConfigMap;
  xAxisKey: string;
  yAxisKey?: string;
  nameKey?: string;
  zAxisKey?: string;
  series: ChartSeriesConfig[];
  kind: ChartKind;
  stacked?: boolean;
  layout?: ChartLayout;
  innerRadius?: number;
  showLegend?: boolean;
  showGrid?: boolean;
}

export type ChoicePresentation = 'quick_replies' | 'list';
export type ChoiceSelectionMode = 'single' | 'multiple';
export type ChoiceSubmitBehavior = 'immediate' | 'explicit';
export type ChoiceStatus = 'ready' | 'submitted' | 'disabled';
export interface ChoiceOption { id: string; label: string; submitText: string; value?: string; description?: string; disabled?: boolean; url?: string; }
export interface ChoiceComponentData extends Record<string, unknown> {
  schemaVersion: 1; questionId: string; prompt: string; description?: string; presentation: ChoicePresentation;
  selectionMode: ChoiceSelectionMode; submitBehavior: ChoiceSubmitBehavior; options: ChoiceOption[];
  otherOption?: { enabled: boolean; label: string; placeholder?: string; maxLength: number };
  labels?: { submit?: string; dismiss?: string; other?: string };
  progress?: { current: number; total: number; label?: string }; dismissible?: boolean; fallbackText?: string; status: ChoiceStatus;
}
export interface ChoiceInteractionMetadata {
  type: 'choice'; componentId: string; questionId: string; sourceMessageId?: string; selectionMode: ChoiceSelectionMode;
  selectedOptions: Array<{ optionId: string; label: string; value?: string }>; customAnswer?: string; dismissed?: boolean; displayText?: string;
}

export interface MessageComponent {
  id?: string;
  type: 'text' | 'code' | 'reasoning' | 'plan' | 'queue' | 'checkpoint' | 'chart' | 'task' | 'error' | 'sources' | 'sandbox' | 'webPreview' | 'artifact' | 'citation' | 'toolInfo' | 'chainOfThought' | 'choice';
  data: Record<string, unknown> | ChartComponentData | ChoiceComponentData;
}

export interface StreamingComponent extends MessageComponent {
  id: string;
}

export interface ConversationListParams {
  page?: number;
  limit?: number;
  search?: string;
  isArchived?: boolean;
  projectId?: string | 'none';
  searchScope?: 'title' | 'fulltext';
  runtimePurpose?: 'chat' | 'platform_copilot';
  sortBy?: 'lastMessageAt' | 'createdAt' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export interface CreateConversationPayload {
  title?: string;
  workspaces?: string[];
  participantEmails?: string[];
  participants?: Array<{ email: string; job?: string }>;
  ownerJob?: string;
  projectId?: string;
  runtimePurpose?: 'chat' | 'platform_copilot';
  creationRequestId?: string;
}

export interface MessageListParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SendMessagePayload {
  requestId?: string;
  content: string;
  attachedFileIds?: string[];
  attachedFiles?: AttachedFile[];
  webSearchEnabled?: boolean;
  deepSearchEnabled?: boolean;
  modelId?: string;
  agentIds?: string[];
  memberIds?: string[];
  /** Mentioned team IDs; the backend expands each into its agents at send time. */
  teamIds?: string[];
  parentMessageId?: string;
  connectorRepo?: { connectorId: string; connectorName: string; repoId: string; repoName: string; repoUrl?: string };
  skillIds?: string[];
  interaction?: ChoiceInteractionMetadata;
  clientContext?: ConversationClientContextV1;
}

export interface ConversationClientContextV1 {
  contextVersion: 1;
  route: string;
  module: 'playbooks' | 'executions' | 'other';
  surface: string;
  entity?: { type: 'playbook' | 'execution' | 'task'; id: string };
  selection?: { type: 'playbook' | 'execution' | 'task'; id: string };
  availableActions: string[];
  hasUnsavedChanges: boolean;
  locale: string;
}

export interface CreateReportPayload {
  reason: 'inaccurate' | 'wrong_information' | 'offensive' | 'out_of_context' | 'hallucination' | 'other';
  description: string;
}

// SSE Stream Events
export interface StreamStartEvent {
  conversationId: string;
  messageId: string;
}

export interface StreamChunkEvent {
  conversationId: string;
  action: 'add' | 'update' | 'delete';
  component: StreamingComponent;
  metadata?: Record<string, unknown>;
}

export interface StreamCompleteEvent {
  conversationId: string;
  messageId: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  };
}

export interface StreamErrorEvent {
  conversationId: string;
  errorCode: string;
  message: string;
}

export interface MessageCreatedEvent {
  conversationId: string;
  message: Message;
}

export interface MessageUpdatedEvent {
  conversationId: string;
  messageId: string;
  message: Partial<Message>;
}

export interface ConversationNameGeneratedEvent {
  conversationId: string;
  name: string;
}

export type SSEConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed';

export type StreamSSEEvent =
  | { type: 'connected'; data: { connectionId: string } }
  | { type: 'heartbeat'; data: { timestamp: number } }
  | { type: 'stream_start'; data: StreamStartEvent }
  | { type: 'stream_chunk'; data: StreamChunkEvent }
  | { type: 'stream_complete'; data: StreamCompleteEvent }
  | { type: 'stream_error'; data: StreamErrorEvent }
  | { type: 'conversation_name_generated'; data: ConversationNameGeneratedEvent }
  | { type: 'message_created'; data: MessageCreatedEvent }
  | { type: 'message_updated'; data: MessageUpdatedEvent }
  | { type: 'mention_created'; data: { conversationId: string; messageId: string; userId: string } }
  | { type: 'connection_failed'; data: { reason: string } }
  | { type: 'error'; data: { code?: string; message?: string } };

// ===== Share Types =====

export type ShareType = 'public' | 'private';

export interface CreateSharePayload {
  shareType: ShareType;
  title?: string;
  recipientEmails?: string[]; // For private shares
  expiresInDays?: number; // For public shares (1-365, default 30)
}

export interface ShareResponse {
  id: string;
  originalConversationId: string;
  sharedBy: string;
  shareType: ShareType;
  title: string;
  accessToken?: string; // For public shares
  recipientEmails?: string[]; // For private shares
  forkedConversationIds?: string[];
  expiresAt?: string;
  viewCount: number;
  isRevoked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicShareViewResponse {
  id: string;
  title: string;
  sharedBy: string;
  messages: PublicShareMessage[];
  viewCount: number;
  createdAt: string;
}

export interface PublicShareMessage {
  conversationType: 'user' | 'ai';
  content?: string;
  components?: MessageComponent[];
  modelId?: string;
  createdAt: string;
}
