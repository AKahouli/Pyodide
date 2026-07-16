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
}

export interface AttachedFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
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
