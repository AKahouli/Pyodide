import type {
  CompleteAIMessageData,
  CreateAIPlaceholderData,
  CreateUserMessageData,
  ConversationLatencyMetricsV1,
  FeedbackType,
  GuardrailDecisionMetadata,
  MessageComponent,
  MessageReplayContext,
  ModelRequestTelemetry,
  ReliabilityEvaluation,
  ResponseCorrectionAttempt,
  ResponseCorrectionWorkflow,
} from '../interfaces/message.interface';
import type { FrontendLatencyPatch } from '../interfaces/latency.interface';

export const MESSAGE_STORE = Symbol('MESSAGE_STORE');

export interface AiMessageComponentsRecord {
  id: string;
  components: MessageComponent[];
}

export interface ReportMessageRecord {
  id: string;
  conversationType: 'user' | 'ai';
  content: string;
  attachedFileIds?: string[];
  components: MessageComponent[];
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  isComplete: boolean;
  questionMessageId?: string;
  answerMessageId?: string;
  createdAt: Date;
  reliabilityEvaluation?: ReliabilityEvaluation;
  correctionWorkflow?: ResponseCorrectionWorkflow;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId?: string;
  parentMessageId?: string;
  conversationType: 'user' | 'ai';
  content?: string;
  components?: MessageComponent[];
  attachedFileIds?: string[];
  agentIds?: string[];
  memberIds?: string[];
  modelId?: string;
  reasoningEffort?: string;
  webSearchEnabled: boolean;
  questionMessageId?: string;
  answerMessageId?: string;
  feedback?: FeedbackType;
  feedbackAt?: Date;
  isEdited: boolean;
  editedAt?: Date;
  isStreaming: boolean;
  isComplete: boolean;
  streamExecutionLeaseId?: string;
  streamExecutionLeaseExpiresAt?: Date;
  inputTokens?: number;
  outputTokens?: number;
  modelRequestTelemetry?: ModelRequestTelemetry;
  durationMs?: number;
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
  latencyMetrics?: ConversationLatencyMetricsV1;
  requestId?: string;
  guardrailDecision?: GuardrailDecisionMetadata;
  interaction?: Record<string, unknown>;
  interactions?: Record<string, unknown>[];
  replayContext?: MessageReplayContext;
  reliabilityEvaluation?: ReliabilityEvaluation;
  correctionWorkflow?: ResponseCorrectionWorkflow;
  reliabilityEvaluationHeartbeatAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessagePageInput {
  conversationId: string;
  page: number;
  limit: number;
  conversationType?: 'user' | 'ai';
}

export interface MessageCursorInput extends Omit<MessagePageInput, 'page'> {
  cursor?: string;
}

export interface MessageStore {
  createUser(input: CreateUserMessageData): Promise<MessageRecord>;
  createAiPlaceholder(input: CreateAIPlaceholderData): Promise<MessageRecord>;
  completeAi(
    input: CompleteAIMessageData & { guardrailDecision?: GuardrailDecisionMetadata },
  ): Promise<MessageRecord | null>;
  findById(id: string): Promise<MessageRecord | null>;
  listPage(input: MessagePageInput): Promise<{ records: MessageRecord[]; total: number }>;
  listCursor(input: MessageCursorInput): Promise<{
    records: MessageRecord[];
    hasMore: boolean;
    nextCursor: string | null;
  }>;
  listByConversation(conversationId: string, limit?: number): Promise<MessageRecord[]>;
  findTurnByRequestId(
    conversationId: string,
    senderId: string,
    requestId: string,
  ): Promise<{ user: MessageRecord; aiId?: string } | null>;
  updateFeedback(
    id: string,
    feedback: FeedbackType,
    feedbackAt: Date,
  ): Promise<MessageRecord | null>;
  updateReliability(id: string, evaluation: ReliabilityEvaluation): Promise<MessageRecord | null>;
  claimStream(id: string, leaseId: string, now: Date, expiresAt: Date): Promise<boolean>;
  renewStream(id: string, leaseId: string, expiresAt: Date): Promise<boolean>;
  releaseStream(id: string, leaseId: string): Promise<void>;
  claimReliability(
    conversationId: string,
    id: string,
    manual: boolean,
    requestedAt: string,
  ): Promise<MessageRecord | null>;
  updateCorrectionWorkflow(
    id: string,
    workflow: ResponseCorrectionWorkflow,
    correctionRunId?: string,
  ): Promise<MessageRecord | null>;
  claimCorrectionRun(
    id: string,
    runId: string,
    leaseExpiresAt: string,
    now: string,
  ): Promise<boolean>;
  upsertCorrectionAttempt(
    id: string,
    attempt: ResponseCorrectionAttempt,
    correctionRunId?: string,
  ): Promise<MessageRecord | null>;
  failStaleReliability(cutoff: Date): Promise<MessageRecord[]>;
  touchPendingReliability(ids: string[], now: Date): Promise<void>;
  markStreamFailed(id: string, leaseId?: string): Promise<void>;
  /**
   * Merge the browser-reported sixth latency metric into an AI message's
   * latency_metrics JSONB. Idempotent: an already-accepted frontend paint value
   * is never overwritten. Returns null when the message does not exist, is not
   * an AI message, or the requestId does not match the persisted turn.
   */
  updateFrontendLatency(
    messageId: string,
    requestId: string,
    patch: FrontendLatencyPatch,
  ): Promise<MessageRecord | null>;
  cleanupStaleStreams(cutoff: Date): Promise<number>;
  updateUser(
    id: string,
    input: { content: string; agentIds?: string[]; memberIds?: string[]; editedAt: Date },
  ): Promise<MessageRecord | null>;
  deleteByConversation(conversationId: string): Promise<number>;
  findBranchesByQuestion(questionMessageId: string): Promise<MessageRecord[]>;
  findBranchesByQuestions(questionMessageIds: string[]): Promise<Map<string, MessageRecord[]>>;
  findAiComponents(
    conversationId: string,
    messageId: string,
  ): Promise<AiMessageComponentsRecord | null>;
  findReportMessageById(messageId: string): Promise<ReportMessageRecord | null>;
}
