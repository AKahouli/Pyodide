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
  | 'chainOfThought'
  | 'choice';

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

export interface MessageReplayContext {
  content: string;
  taskSummary?: string;
  attachedFileIds: string[];
  webSearchEnabled: boolean;
  deepSearchEnabled: boolean;
  modelId?: string;
  agentIds: string[];
  skillIds: string[];
  connectorRepo?: {
    connectorId: string;
    connectorName: string;
    repoId: string;
    repoName: string;
    repoUrl?: string;
  };
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
  agentIds?: string[];
  memberIds?: string[];
  requestId?: string;
  parentMessageId?: string;
  interaction?: Record<string, unknown>;
  replayContext?: MessageReplayContext;
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
  interaction?: Record<string, unknown>;
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
  interaction?: Record<string, unknown>;
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
