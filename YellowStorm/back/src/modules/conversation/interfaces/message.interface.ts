import type { ConversationLatencyMetricsV1 } from './latency.interface';

export type ConversationType = 'user' | 'ai';

export type {
  ConversationLatencyMetricsV1,
  ConversationLatencyQuality,
} from './latency.interface';

export type ComponentType =
  | 'text'
  | 'code'
  | 'agentActivity'
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
  | 'toolActivity'
  | 'choice';

export interface AgentActivityData extends Record<string, unknown> {
  summary: string;
  detail?: string;
  status: 'running' | 'completed';
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  actorId?: string;
  actorName?: string;
}

export interface ToolActivityData extends Record<string, unknown> {
  toolName: string;
  displayKey?: string;
  fallbackDisplayName?: string;
  summary: string;
  renderKind: 'run_code' | 'search' | 'read' | 'write' | 'file' | 'web' | 'generic';
  status: 'running' | 'completed' | 'failed' | 'stopped';
  paramsJson?: string;
  resultJson?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  actorId?: string;
  actorName?: string;
  primaryInput?: string;
  primaryInputLanguage?: string;
}

export interface ArtifactActivityData extends Record<string, unknown> {
  artifactId: string;
  filename: string;
  artifactKind?: string;
  mimeType?: string;
  sizeBytes?: number;
  producerToolId?: string;
  availability: 'pending' | 'ready' | 'failed';
  storagePath?: string;
}

export type FeedbackType = 'like' | 'dislike';

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

export interface ReliabilityClaimCounts {
  total: number;
  supported: number;
  partiallySupported: number;
  unsupported: number;
  contradicted: number;
}

export interface ReliabilityEvaluation {
  status: ReliabilityEvaluationStatus;
  score?: number;
  label?: ReliabilityLabel;
  summary?: string;
  claimCounts?: ReliabilityClaimCounts;
  claims?: ReliabilityFinding[];
  findings?: ReliabilityFinding[];
  evaluator?: { modelId: string; modelName: string; evaluatorVersion: string; promptVersion: string };
  requestedAt?: string;
  evaluatedAt?: string;
  durationMs?: number;
  failureCode?: string;
}

export type ResponseCorrectionStatus = 'queued' | 'correcting' | 're_evaluating' | 'corrected' | 'failed' | 'abstained' | 'human_review_required';
export type ActiveAnswerVersion = 'original' | 'corrected' | 'abstention';

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

export interface MessageReplayContext {
  requestFingerprint?: string;
  content: string;
  taskSummary?: string;
  attachedFileIds: string[];
  webSearchEnabled: boolean;
  webConnectorAccessEnabled?: boolean;
  deepSearchEnabled: boolean;
  modelId?: string;
  semanticModelId?: string;
  reasoningEffort?: string;
  agentIds: string[];
  teamId?: string;
  skillIds: string[];
  connectorRepo?: {
    connectorId: string;
    connectorName: string;
    repoId: string;
    repoName: string;
    repoUrl?: string;
  };
  clientContext?: ConversationClientContextV1;
  playbookHandoffId?: string;
  governanceOverride?: {
    runtimeMode: 'governed';
    primaryAgentId: string;
    allowedAgentIds: string[];
    workspaceIds: string[];
    revisionId: string;
    scopeId: string;
  };
}

export interface CorrectionReplayFinding {
  claim: string;
  status: 'partially_supported' | 'unsupported' | 'contradicted';
  importance: ReliabilityClaimImportance;
  explanation: string;
}

export interface CorrectionReplayContext {
  originalAnswer: string;
  findings: CorrectionReplayFinding[];
  attemptNumber: number;
  instructions: string;
}

export interface AppliedCorrection {
  claim: string;
  action: 'removed' | 'qualified' | 'replaced' | 'citation_repaired';
  explanation: string;
  evidenceIds?: string[];
}

export type CorrectionAttemptStatus = 'generating' | 'generated' | 'evaluating' | 'accepted' | 'rejected' | 'failed';
export type CorrectionAttemptDecision = 'accepted' | 'rejected' | 'failed';
export type CorrectionPolicyReason =
  | 'policy_requirements_met'
  | 'answer_empty'
  | 'evaluation_not_applicable'
  | 'evaluation_not_completed'
  | 'score_below_threshold'
  | 'score_below_original'
  | 'critical_claim_unresolved'
  | 'candidate_generation_failed'
  | 'candidate_evaluation_failed';

export interface ResponseCorrectionAttempt {
  attemptId: string;
  attemptNumber: number;
  strategy?: 'existing_evidence' | 'corrective_replay';
  status: CorrectionAttemptStatus;
  decision?: CorrectionAttemptDecision;
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
  reasoningEffort?: string;
  agentIds?: string[];
  memberIds?: string[];
  requestId?: string;
  parentMessageId?: string;
  interaction?: Record<string, unknown>;
  interactions?: Record<string, unknown>[];
  replayContext?: MessageReplayContext;
}

export interface CreateAIPlaceholderData {
  conversationId: string;
  questionMessageId: string;
  senderId?: string;
  modelId?: string;
  reasoningEffort?: string;
  requestId?: string;
}

export interface CompleteAIMessageData {
  messageId: string;
  streamExecutionLeaseId?: string;
  components: MessageComponent[];
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
  guardrailDecision?: GuardrailDecisionMetadata;
  interaction?: Record<string, unknown>;
  modelRequestTelemetry?: ModelRequestTelemetry;
  latencyMetrics?: ConversationLatencyMetricsV1;
}

export interface ModelRequestTelemetry {
  usedTokens: number;
  contextWindow: number;
  model: string;
}

export interface MessageQueryParams {
  mode?: 'legacy' | 'cursor';
  cursor?: string;
  page?: number;
  limit?: number;
  conversationType?: ConversationType;
}

export interface CursorPaginatedMessages {
  messages: MessageResponse[];
  branchesByQuestion: Record<string, MessageResponse[]>;
  pagination: { mode: 'cursor'; limit: number; hasMore: boolean; nextCursor: string | null };
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
  reasoningEffort?: string;
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
  modelRequestTelemetry?: ModelRequestTelemetry;
  durationMs?: number;
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
  latencyMetrics?: ConversationLatencyMetricsV1;
  requestId?: string;
  agentIds?: string[];
  memberIds?: string[];
  guardrailDecision?: GuardrailDecisionMetadata;
  interaction?: Record<string, unknown>;
  interactions?: Record<string, unknown>[];
  reliabilityEvaluation?: ReliabilityEvaluation;
  correctionWorkflow?: ResponseCorrectionWorkflow;
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
