export type ConversationType = 'user' | 'ai';

export type ComponentType =
  | 'text'
  | 'code'
  | 'reasoning'
  | 'plan'
  | 'queue'
  | 'checkpoint'
  | 'chart'
  | 'task'
  | 'error'
  | 'sources'
  | 'sandbox'
  | 'webPreview'
  | 'artifact'
  | 'citation'
  | 'toolInfo'
  | 'chainOfThought';

export type FeedbackType = 'like' | 'dislike';

export interface MessageComponent {
  id: string;
  type: ComponentType;
  data: Record<string, unknown>;
}

export interface GuardrailDecisionMetadata {
  phase: 'input' | 'output' | 'tool_call';
  source: 'agent' | 'admin_forced' | string;
  decision: 'allow' | 'sanitize' | 'block';
  confidence: number;
  attackType: string;
  target: string;
  reason?: string;
  safeRewrite?: string | null;
}

export interface CreateUserMessageData {
  conversationId: string;
  senderId: string;
  content: string;
  attachedFileIds?: string[];
  webSearchEnabled?: boolean;
  modelId?: string;
  agentIds?: string[];
  memberIds?: string[];
  requestId?: string;
  parentMessageId?: string;
}

export interface CreateAIPlaceholderData {
  conversationId: string;
  questionMessageId: string;
  modelId?: string;
  requestId?: string;
}

export interface CompleteAIMessageData {
  messageId: string;
  components: MessageComponent[];
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
  guardrailDecision?: GuardrailDecisionMetadata;
}

export interface MessageQueryParams {
  page?: number;
  limit?: number;
  conversationType?: ConversationType;
}

export interface AttachedFileResponse {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
}

export interface MessageResponse {
  id: string;
  conversationId: string;
  senderId?: string;
  parentMessageId?: string;
  conversationType: ConversationType;
  content?: string;
  components?: MessageComponent[];
  attachedFileIds?: string[];
  attachedFiles?: AttachedFileResponse[];
  modelId?: string;
  webSearchEnabled: boolean;
  questionMessageId?: string;
  answerMessageId?: string;
  feedback?: FeedbackType;
  feedbackAt?: string;
  isEdited?: boolean;
  editedAt?: string;
  isStreaming: boolean;
  isComplete: boolean;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
  requestId?: string;
  agentIds?: string[];
  memberIds?: string[];
  guardrailDecision?: GuardrailDecisionMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedMessages {
  messages: MessageResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
