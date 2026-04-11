/**
 * Playbook Module Types
 */

import type { MessageComponent } from '@/modules/conversation/types';

/** Playbook components extend conversation components with humanFeedback */
export type PlaybookComponent = MessageComponent | { type: 'humanFeedback'; data: Record<string, unknown> };

// ===== Typed Port & Artifact Model =====

export type ArtifactKind = 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';

export interface TaskOutputPort {
  id: string;
  name: string;
  artifactKind: ArtifactKind;
  description?: string;
}

export interface TaskInputPort {
  id: string;
  name: string;
  artifactKind: ArtifactKind;
  required: boolean;
  description?: string;
}

export interface TaskArtifact {
  portId: string;
  artifactKind: ArtifactKind;
  content?: string;
  url?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  metadata?: Record<string, unknown>;
}

export interface TaskTemplate {
  id: string;
  type: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  category: 'content' | 'generation' | 'analysis' | 'code';
  inputPorts: TaskInputPort[];
  outputPorts: TaskOutputPort[];
  promptTemplate: string;
  recommendedAgentTypeSlug: string | null;
  requiredToolNames: string[];
}

// ===== Domain Entities =====

export interface InputFile {
  type: 'workspace' | 'document';
  id: string;
  name: string;
  workspaceId?: string;
  portId?: string;
  artifactKind?: ArtifactKind;
  metadata?: {
    workspaceId?: string;
    documentId?: string;
    filename?: string;
    filepath?: string;
    language?: string;
    mimeType?: string;
  };
}

export interface PlaybookTask {
  id: string;
  title: string;
  description: string;
  assignedAgentId: string | null;
  executionOrder: number;
  positionX: number;
  positionY: number;
  interruptBefore: boolean;
  interruptAfter: boolean;
  allowClarification: boolean;
  clarificationPrompt: string;
  maxClarifications: number;
  inputKeys: string[];
  outputKey: string;
  enabled?: boolean;
  notifyOnComplete: boolean;
  notifyEmails: string[];
  hasValidatedReplay?: boolean;
  activeReplayId?: string | null;
  activeReplayVersion?: number | null;
  activeReplayIsStale?: boolean;
  activeReplayStaleReasons?: string[];
  activeReplayPreserveOutputFormat?: boolean;
  activeReplayFormatGuideStatus?: 'disabled' | 'pending' | 'ready' | 'failed';
  activeReplayFormatGuideError?: string | null;
  hasOutputFormatTemplate?: boolean;
  activeOutputFormatTemplateId?: string | null;
  activeOutputFormatTemplateVersion?: number | null;
  activeOutputFormatStatus?: 'pending' | 'ready' | 'failed' | null;
  activeOutputFormatError?: string | null;
  isSavingReplayBaseline?: boolean;
  isCapturingOutputFormat?: boolean;
  stepReplayMode?: 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';
  inputFiles: InputFile[];
  taskType?: string;
  inputPorts?: TaskInputPort[];
  outputPorts?: TaskOutputPort[];
}

export interface PlaybookEdge {
  id: string;
  sourceId: string;
  sourceOutputPortId?: string;
  targetId: string;
  targetInputPortId?: string;
}

export type ExecutionScheduleType = 'daily' | 'weekly' | 'monthly' | 'advanced';

export interface DailySchedulePayloadData {
  timesLocal: string[];
}

export interface WeeklySlotData {
  weekday: number;
  timeLocal: string;
}

export interface WeeklySchedulePayloadData {
  slots: WeeklySlotData[];
}

export interface MonthlySlotData {
  /** 1–12 = ce mois chaque année ; null/undefined = même jour chaque mois */
  monthOfYear?: number | null;
  /** 1–31, 0 = chaque jour du mois, -1 = dernier jour */
  dayOfMonth: number;
  timeLocal: string;
}

export interface MonthlySchedulePayloadData {
  slots: MonthlySlotData[];
}

export type AdvancedScheduleVariant = 'weekdays' | 'weekend' | 'every_n_days';

export interface AdvancedSchedulePayloadData {
  variant: AdvancedScheduleVariant;
  intervalDays: number | null;
  timeLocal: string | null;
  /** weekend only: 1–12, null = every month */
  monthOfYear?: number | null;
  /** weekend only: 1–5, null = every week */
  weekOfMonth?: number | null;
}

export interface ExecutionScheduleData {
  enabled: boolean;
  timezone: string;
  type?: ExecutionScheduleType;
  lastScheduledRunAt: string | null;
  daily: DailySchedulePayloadData | null;
  weekly: WeeklySchedulePayloadData | null;
  monthly: MonthlySchedulePayloadData | null;
  advanced: AdvancedSchedulePayloadData | null;
}

/** Body for PUT /playbooks/:id/schedule (aligns with backend UpsertPlaybookScheduleDto). */
export interface UpsertPlaybookScheduleData {
  enabled: boolean;
  timezone?: string;
  type?: ExecutionScheduleType;
  daily?: DailySchedulePayloadData;
  weekly?: WeeklySchedulePayloadData;
  monthly?: MonthlySchedulePayloadData;
  advanced?: AdvancedSchedulePayloadData;
}

export interface PlaybookSummary {
  id: string;
  name: string;
  description: string;
  taskCount: number;
  isFavorite: boolean;
  /** True when the playbook has an enabled execution schedule (list API). */
  scheduleEnabled: boolean;
  /** Latest known execution state for the list badge. */
  executionStatus?: ExecutionStatus | null;
  integrationToken?: string | null;
  /** Full schedule data when included by the list API (optional, backend-dependent). */
  executionSchedule?: ExecutionScheduleData | null;
  lastExecutionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'name' | 'taskCount' | 'lastExecutionAt';
  sortOrder?: 'asc' | 'desc';
  minTasks?: number;
  maxTasks?: number;
  dateField?: 'createdAt' | 'updatedAt' | 'lastExecutionAt';
  dateFrom?: string;
  dateTo?: string;
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  tasks: PlaybookTask[];
  edges: PlaybookEdge[];
  workspaces: string[];
  createdBy: string;
  isFavorite: boolean;
  isActive: boolean;
  executionSchedule: ExecutionScheduleData | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloneShareResult {
  succeeded: { email: string; playbookId: string }[];
  failed: { email: string; reason: string }[];
}

export interface ToolTraceItem {
  callIndex: number;
  toolName: string;
  args: Record<string, unknown>;
  outputSummary: string | null;
}

export interface LLMPromptTraceItem {
  stage: string;
  model: string;
  prompt: string;
}

export interface SemanticMatchResult {
  matchScore: number;
  semanticSimilarityScore: number;
  evidenceConsistencyScore: number;
  judgeScore: number;
  reason: string;
  missingPoints: string[];
  changedPoints: string[];
  model: string;
  judgeUsed: boolean;
}

export interface StepEvaluationHistoryEntry {
  id: string;
  createdAt: string;
  attemptNumber: number | null;
  trigger: 'manual' | 'auto';
  baselineReplayId: string | null;
  baselineValidationVersion: number | null;
  semanticMatch: SemanticMatchResult;
}

export interface StepExecutionHistoryEntry {
  id: string;
  attemptNumber: number | null;
  status: StepStatus;
  output: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  components?: PlaybookComponent[];
  toolTrace?: ToolTraceItem[];
  llmPromptTrace?: LLMPromptTraceItem[];
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  modelName?: string | null;
  artifacts?: TaskArtifact[];
}

export interface TaskResult {
  taskId: string;
  nodeTitle: string;
  agentName: string;
  order: number;
  status: StepStatus;
  output: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  components?: PlaybookComponent[];
  toolTrace?: ToolTraceItem[];
  llmPromptTrace?: LLMPromptTraceItem[];
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  modelName?: string | null;
  semanticMatch?: SemanticMatchResult | null;
  judgeStatus?: 'idle' | 'evaluating' | 'evaluated' | 'failed';
  judgeResult?: {
    accuracyScore: number;
    completenessScore: number;
    overallScore: number;
    confidence: number;
    toolUsageScore: number;
    missingFacts: string[];
    incoherences: string[];
    unsupportedClaims: string[];
    handoffRisks: string[];
    rewriteHints: string[];
    toolSelectionIssues: string[];
    missingToolCalls: string[];
    redundantToolCalls: string[];
    toolOutputUseIssues: string[];
    toolSequencingIssues: string[];
    toolUsageStrengths: string[];
    toolUsageRecommendation: string;
    safeAutoFixType: 'optimize_step' | 'none';
    recommendation: 'none' | 'update_current_playbook' | 'generate_new_optimized_playbook';
    reason: string;
  } | null;
  judgeError?: string | null;
  judgeHistory?: Array<{
    id: string;
    createdAt: string;
    attemptNumber: number | null;
    model: string | null;
    judgeResult: {
      accuracyScore: number;
      completenessScore: number;
      overallScore: number;
      confidence: number;
      toolUsageScore: number;
      missingFacts: string[];
      incoherences: string[];
      unsupportedClaims: string[];
      handoffRisks: string[];
      rewriteHints: string[];
      toolSelectionIssues: string[];
      missingToolCalls: string[];
      redundantToolCalls: string[];
      toolOutputUseIssues: string[];
      toolSequencingIssues: string[];
      toolUsageStrengths: string[];
      toolUsageRecommendation: string;
      safeAutoFixType: 'optimize_step' | 'none';
      recommendation: 'none' | 'update_current_playbook' | 'generate_new_optimized_playbook';
      reason: string;
    };
  }>;
  evaluationHistory?: StepEvaluationHistoryEntry[];
  stepExecutions?: StepExecutionHistoryEntry[];
  advisorTurnCount?: number;
  advisorTurnHistory?: Array<{
    turn: number;
    createdAt: string;
    score: number | null;
    recommendation: string | null;
    safeAutoFixType: string | null;
    actionType: 'evaluate' | 'optimize_step' | 'stop';
    stopReason?: string | null;
  }>;
  lastAdvisorAction?: string | null;
  lastAdvisorScoreDelta?: number | null;
  advisorStopReason?: string | null;
  attemptNumber?: number | null;
  isStale?: boolean;
  staleReason?: string | null;
  invalidatedByTaskId?: string | null;
  artifacts?: TaskArtifact[];
}

export interface PlaybookExecution {
  id: string;
  playbookId: string;
  executedBy: string;
  executionNumber: number;
  currentAttemptNumber?: number;
  status: ExecutionStatus;
  executionMode?: 'live' | 'inherit' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';
  executionTrigger?: 'manual' | 'scheduled';
  reflectionEnabled?: boolean;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number;
  advisorAutopilotMaxTurns?: number;
  advisorAutopilotStatus?: 'idle' | 'running' | 'judging' | 'optimizing' | 'rerunning' | 'completed' | 'stopped' | 'failed';
  advisorAutopilotTaskId?: string | null;
  advisorAutopilotAttemptCount?: number;
  advisorAutopilotLastError?: string | null;
  judgeSummaryStatus?: 'idle' | 'evaluating' | 'evaluated' | 'failed';
  judgeSummary?: {
    overallScore: number;
    confidence: number;
    structuralIssues: string[];
    promptIssues: string[];
    contractIssues: string[];
    handoffIssues: string[];
    toolUsageIssues: string[];
    crossStepToolPatterns: string[];
    rootCauseTaskIds: string[];
    highImpactRecommendations: string[];
    recommendation: 'update_current_playbook' | 'generate_new_optimized_playbook';
    reason: string;
  } | null;
  replaySourceByTask?: Record<string, { replayId: string; validationVersion: number }> | null;
  taskResults: TaskResult[];
  attemptHistory?: Array<{
    attemptNumber: number;
    type: 'initial' | 'resume_interrupt' | 'rerun_step' | 'resume_from_step';
    taskId?: string | null;
    threadId?: string | null;
    startedAt: string;
    completedAt?: string | null;
  }>;
  threadId: string | null;
  interruptPayload: InterruptPayload | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  singleStepTaskId: string | null;
  playbookSnapshot: Record<string, unknown> | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
}

/** Summary type returned by execution list endpoint (no taskResults/playbookSnapshot) */
export interface PlaybookExecutionSummary {
  id: string;
  playbookId: string;
  executedBy: string;
  executionNumber: number;
  currentAttemptNumber?: number;
  status: ExecutionStatus;
  executionTrigger?: 'manual' | 'scheduled';
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  singleStepTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ValidatedReplayToolCall {
  callIndex: number;
  toolName: string;
  args: Record<string, unknown>;
  outputSummary: string | null;
}

export interface ValidatedTaskReplay {
  id: string;
  playbookId: string;
  taskId: string;
  taskTitle: string;
  agentName: string;
  createdBy: string;
  referenceExecutionId: string;
  referenceExecutionNumber: number;
  validationVersion: number;
  status: 'active' | 'inactive' | 'archived';
  mode: 'strict_replay';
  referenceTaskDescription?: string;
  referenceAssignedAgentId?: string | null;
  referenceWorkspaceIds?: string[];
  toolCalls: ValidatedReplayToolCall[];
  referenceOutput: string | null;
  preserveOutputFormat?: boolean;
  outputFormatGuide?: string | null;
  formatGuideStatus?: 'disabled' | 'pending' | 'ready' | 'failed';
  formatGuideError?: string | null;
  llmPromptTrace?: LLMPromptTraceItem[];
  isStale?: boolean;
  staleReasons?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OutputFormatTemplate {
  id: string;
  playbookId: string;
  taskId: string;
  sourceExecutionId: string;
  sourceExecutionNumber: number;
  templateVersion: number;
  status: 'active' | 'inactive' | 'archived';
  generationStatus: 'pending' | 'ready' | 'failed';
  generationError?: string | null;
  formatGuide?: string | null;
  llmPromptTrace?: LLMPromptTraceItem[];
  createdAt: string;
  updatedAt: string;
}

// ===== Enums =====

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'interrupted';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
export type PlaybookPageMode = 'design' | 'run';
export type PlaybookCopilotMode = 'design' | 'interrupt';

// ===== Interrupt =====

export type InterruptType = 'approval_request' | 'review_request' | 'clarification';
export type InterruptAction = 'reply' | 'approve' | 'reject' | 'skip';

export interface InterruptPayload {
  type: InterruptType | string;
  taskId: string;
  taskTitle: string;
  message: string;
  threadId: string;
  interruptId?: string;
  round?: number;
  payloadJson?: string;
  resumableActions?: string[];
  taskDescription?: string;
  result?: string;
}

export interface HumanFeedbackData {
  interruptType: InterruptType | string;
  message: string;
  status: 'pending' | 'answered';
  humanResponse?: string;
  action?: InterruptAction | string;
  replyMessage?: string;
  interruptId?: string;
  round?: number;
  payloadJson?: string;
  resumableActions?: string[];
  taskDescription?: string;
  result?: string;
  approved?: boolean;
  reason?: string;
  feedback?: string;
}

// ===== ReactFlow Node Data =====

export interface PlaybookNodeData extends PlaybookTask {
  stepStatus?: StepStatus;
  stepSemanticMatch?: SemanticMatchResult | null;
  stepJudgeStatus?: 'idle' | 'evaluating' | 'evaluated' | 'failed';
  stepJudgeResult?: TaskResult['judgeResult'];
  [key: string]: unknown;
}

// ===== SSE Events =====

export interface PlaybookExecutionStartEvent {
  executionId: string;
  playbookId: string;
  executionNumber: number;
  status: string;
  executionMode?: 'live' | 'inherit' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';
  reflectionEnabled?: boolean;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number;
  advisorAutopilotMaxTurns?: number;
  advisorAutopilotStatus?: 'idle' | 'running' | 'judging' | 'optimizing' | 'rerunning' | 'completed' | 'stopped' | 'failed';
  advisorAutopilotTaskId?: string | null;
  advisorAutopilotAttemptCount?: number;
  advisorAutopilotLastError?: string | null;
  singleStepTaskId?: string | null;
  replaySourceByTask?: Record<string, { replayId: string; validationVersion: number }> | null;
  taskResults?: TaskResult[];
}

export interface PlaybookAdvisorAutopilotUpdatedEvent {
  executionId: string;
  taskId?: string;
  advisorAutopilotStatus?: PlaybookExecution['advisorAutopilotStatus'];
  advisorAutopilotAttemptCount?: number;
  advisorAutopilotTaskId?: string | null;
  advisorAutopilotLastError?: string | null;
  advisorTurnCount?: number;
  lastAdvisorAction?: string | null;
  lastAdvisorScoreDelta?: number | null;
  advisorStopReason?: string | null;
  advisorTurnHistoryEntry?: TaskResult['advisorTurnHistory'] extends Array<infer T> ? T : never;
}

export interface PlaybookStepStartEvent {
  executionId: string;
  taskId: string;
  status: string;
}

export interface PlaybookStepUpdateEvent {
  executionId: string;
  taskId: string;
  status: string;
  output?: string;
  components?: PlaybookComponent[];
  toolTrace?: ToolTraceItem[];
  llmPromptTrace?: LLMPromptTraceItem[];
  artifacts?: TaskArtifact[];
}

export interface PlaybookStepCompleteEvent {
  executionId: string;
  taskId: string;
  status: string;
  output?: string;
  error?: string;
  durationMs?: number;
  components?: PlaybookComponent[];
  toolTrace?: ToolTraceItem[];
  llmPromptTrace?: LLMPromptTraceItem[];
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  modelName?: string;
  semanticMatch?: SemanticMatchResult | null;
  artifacts?: TaskArtifact[];
}

export interface PlaybookStepEvaluationUpdatedEvent {
  executionId: string;
  taskId: string;
  semanticMatch: SemanticMatchResult | null;
  evaluationEntry?: StepEvaluationHistoryEntry | null;
}

export interface PlaybookStepJudgeStartedEvent {
  executionId: string;
  taskId: string;
  judgeStatus: 'evaluating';
}

export interface PlaybookStepJudgeUpdatedEvent {
  executionId: string;
  taskId: string;
  judgeStatus: 'idle' | 'evaluating' | 'evaluated' | 'failed';
  judgeResult?: TaskResult['judgeResult'];
  judgeError?: string | null;
  judgeHistoryEntry?: TaskResult['judgeHistory'] extends Array<infer T> ? T : never;
}

export interface PlaybookJudgeSummaryUpdatedEvent {
  executionId: string;
  judgeSummary: NonNullable<PlaybookExecution['judgeSummary']>;
}

export interface PlaybookReplayFormatGuideUpdatedEvent {
  playbookId: string;
  taskId: string;
  replay: ValidatedTaskReplay;
}

export interface PlaybookOutputFormatTemplateUpdatedEvent {
  playbookId: string;
  taskId: string;
  template: OutputFormatTemplate;
}

export interface PlaybookExecutionCompleteEvent {
  executionId: string;
  status: string;
  durationMs?: number;
  error?: string;
  skippedTaskIds?: string[];
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalTokens?: number;
}

export interface PlaybookInterruptEvent {
  executionId: string;
  taskId: string;
  type: string;
  message: string;
  threadId: string;
  interruptId?: string;
  round?: number;
  payloadJson?: string;
  resumableActions?: string[];
  taskDescription?: string;
  result?: string;
}

// ===== DTOs =====

export interface CreatePlaybookData {
  name: string;
  description?: string;
  workspaces?: string[];
}

export interface GeneratePlaybookData {
  name: string;
  prompt: string;
  workspaces?: string[];
}

export interface RewritePlaybookPromptData {
  prompt: string;
}

export interface RewritePlaybookPromptResult {
  prompt: string;
}

export interface PlaybookSnapshot {
  tasks: PlaybookTask[];
  edges: PlaybookEdge[];
}

export interface PlaybookUndoSnapshot {
  tasks: PlaybookTask[];
  edges: PlaybookEdge[];
  name: string;
  workspaces: string[];
}

export interface DesignMessage {
  id: string;
  playbookId: string;
  userQuery: string;
  aiSummary: string;
  snapshotBefore: PlaybookSnapshot;
  status: 'completed' | 'failed' | 'reverted';
  revertedFromMessageId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesignPlaybookData {
  query: string;
}

export interface UpdatePlaybookData {
  name?: string;
  description?: string;
  tasks?: PlaybookTask[];
  edges?: PlaybookEdge[];
  workspaces?: string[];
}

export interface ExecutePlaybookData {
  singleStepTaskId?: string;
  query?: string;
  executionMode?: 'live' | 'inherit';
  stepExecutionModes?: Record<string, 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive'>;
  runEvaluation?: boolean;
  streaming?: boolean;
  runNodeReflection?: boolean;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number;
  advisorAutopilotMaxTurns?: number;
}

export interface ValidateTaskReplayData {
  executionId: string;
  preserveOutputFormat?: boolean;
}

export interface UpdateTaskReplayFormatData {
  preserveOutputFormat?: boolean;
  outputFormatGuide?: string;
}

export interface GrabOutputFormatTemplateData {
  executionId: string;
}

export interface UpdateOutputFormatTemplateData {
  formatGuide?: string;
}

export interface ResumePlaybookData {
  executionId: string;
  taskId: string;
  action?: InterruptAction;
  message?: string;
  approved?: boolean;
  reason?: string;
  feedback?: string;
}

export interface RerunStepData {
  taskId: string;
  runEvaluation?: boolean;
  executionMode?: 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';
  streaming?: boolean;
  runNodeReflection?: boolean;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number;
  advisorAutopilotMaxTurns?: number;
}

export interface ResumeFromStepData {
  taskId: string;
  streaming?: boolean;
}

export type RemediationCategory = 'structure' | 'prompt' | 'contract' | 'handoff' | 'tooling' | 'evidence' | 'outputFormat';

export interface AdvisorRemediationItem {
  id: string;
  category: RemediationCategory;
  scope: 'task' | 'playbook';
  targetTaskId: string | null;
  title: string;
  description: string;
  rationale?: string;
  editable: boolean;
  defaultSelected: boolean;
  source: {
    kind: string;
    field: string;
    index: number;
  };
}

export interface ApplyRemediationsData {
  mode?: 'update-current' | 'generate-new';
  selectedIds?: string[];
}

// ===== Store =====

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PlaybookState {
  playbooks: PlaybookSummary[];
  playbooksLoading: boolean;
  playbooksPagination: PaginationMeta | null;
  playbooksQuery: PlaybookQueryParams;
  currentPlaybook: Playbook | null;
  currentPlaybookLoading: boolean;
  isDirty: boolean;
  dirtyVersion: number;
  isSaving: boolean;
  saveRequestId: number;
  savingDirtyVersion: number | null;
  currentExecution: PlaybookExecution | null;
  currentExecutionLoading: boolean;
  executionCache: Record<string, PlaybookExecution>;
  executionHistory: PlaybookExecutionSummary[];
  executionsLoading: boolean;
  executingPlaybookIds: string[];
  isGenerating: boolean;
  generateRetryData: GeneratePlaybookData | null;
  selectedStepId: string | null;
  error: string | null;
  designMessages: DesignMessage[];
  designMessagesLoading: boolean;
  isStopping: boolean;
  isDesigning: boolean;
  designerOpen: boolean;
  copilotMode: PlaybookCopilotMode;
  executionPanelOpen: boolean;
  workspaceExplorerOpen: boolean;
  pageMode: PlaybookPageMode;
  undoStack: PlaybookUndoSnapshot[];
  redoStack: PlaybookUndoSnapshot[];
  canvasSyncVersion: number;
  /** Saving schedule (PUT/DELETE /playbooks/:id/schedule) */
  scheduleSaving: boolean;
  scheduleError: string | null;
}

export interface PlaybookActions {
  // CRUD
  fetchPlaybooks: (query?: PlaybookQueryParams) => Promise<void>;
  fetchMorePlaybooks: () => Promise<void>;
  fetchPlaybook: (id: string) => Promise<void>;
  createPlaybook: (data: CreatePlaybookData) => Promise<Playbook>;
  generatePlaybook: (data: GeneratePlaybookData) => Promise<string>;
  clearGenerateRetry: () => void;
  updatePlaybook: (id: string, data: UpdatePlaybookData) => Promise<void>;
  deletePlaybook: (id: string) => Promise<void>;
  clonePlaybook: (id: string) => Promise<Playbook>;
  toggleFavorite: (id: string) => Promise<void>;
  bulkDeletePlaybooks: (ids: string[]) => Promise<void>;
  upsertPlaybookSchedule: (playbookId: string, data: UpsertPlaybookScheduleData) => Promise<void>;
  clearPlaybookSchedule: (playbookId: string) => Promise<void>;

  // Canvas
  updateTasks: (tasks: PlaybookTask[]) => void;
  updateEdges: (edges: PlaybookEdge[]) => void;
  updateWorkspaces: (workspaces: string[]) => void;
  setDirty: (dirty: boolean) => void;
  saveCurrentPlaybook: () => Promise<void>;

  // Execution
  executePlaybook: (id: string, data?: ExecutePlaybookData) => Promise<string>;
  resumeExecution: (id: string, data: ResumePlaybookData) => Promise<void>;
  rerunStepInExecution: (
    playbookId: string,
    executionId: string,
    taskId: string,
    runEvaluation?: boolean,
    executionMode?: 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive',
    streaming?: boolean,
    runNodeReflection?: boolean,
    advisorAutopilotEnabled?: boolean,
    advisorAutopilotTargetScore?: number,
    advisorAutopilotMaxTurns?: number,
  ) => Promise<void>;
  resumeFromStep: (playbookId: string, executionId: string, taskId: string, streaming?: boolean) => Promise<void>;
  skipExecutionStep: (playbookId: string, executionId: string, taskId: string) => Promise<void>;
  stopExecution: (playbookId: string, executionId: string) => Promise<void>;
  deleteExecution: (playbookId: string, executionId: string) => Promise<void>;
  deleteStepExecution: (playbookId: string, executionId: string, taskId: string, stepExecutionId: string) => Promise<void>;
  deleteAllExecutions: (playbookId: string) => Promise<void>;
  validateTaskReplay: (
    playbookId: string,
    taskId: string,
    executionId: string,
    options?: { preserveOutputFormat?: boolean },
  ) => Promise<ValidatedTaskReplay>;
  updateTaskReplayFormatGuide: (
    playbookId: string,
    taskId: string,
    replayId: string,
    data: UpdateTaskReplayFormatData,
  ) => Promise<ValidatedTaskReplay>;
  fetchTaskReplays: (playbookId: string, taskId: string) => Promise<ValidatedTaskReplay[]>;
  activateTaskReplay: (playbookId: string, taskId: string, replayId: string) => Promise<ValidatedTaskReplay>;
  grabOutputFormatTemplate: (
    playbookId: string,
    taskId: string,
    data: GrabOutputFormatTemplateData,
  ) => Promise<OutputFormatTemplate>;
  fetchOutputFormatTemplate: (playbookId: string, taskId: string) => Promise<OutputFormatTemplate | null>;
  updateOutputFormatTemplate: (
    playbookId: string,
    taskId: string,
    data: UpdateOutputFormatTemplateData,
  ) => Promise<OutputFormatTemplate>;
  updatePlaybookFromJudge: (playbookId: string, executionId: string) => Promise<Playbook>;
  generatePlaybookFromJudge: (playbookId: string, executionId: string) => Promise<Playbook>;
  optimizeStepFromJudge: (playbookId: string, executionId: string, taskId: string) => Promise<Playbook>;
  fetchAdvisorRemediations: (playbookId: string, executionId: string, taskId?: string) => Promise<AdvisorRemediationItem[]>;
  applyAdvisorRemediations: (playbookId: string, executionId: string, data: ApplyRemediationsData) => Promise<Playbook>;

  // SSE handlers
  onExecutionStart: (data: PlaybookExecutionStartEvent) => void;
  onStepStart: (data: PlaybookStepStartEvent) => void;
  onStepUpdate: (data: PlaybookStepUpdateEvent) => void;
  onStepComplete: (data: PlaybookStepCompleteEvent) => void;
  onStepEvaluationUpdated: (data: PlaybookStepEvaluationUpdatedEvent) => void;
  onStepJudgeStarted: (data: PlaybookStepJudgeStartedEvent) => void;
  onStepJudgeUpdated: (data: PlaybookStepJudgeUpdatedEvent) => void;
  onJudgeSummaryUpdated: (data: PlaybookJudgeSummaryUpdatedEvent) => void;
  onAdvisorAutopilotUpdated: (data: PlaybookAdvisorAutopilotUpdatedEvent) => void;
  onReplayFormatGuideUpdated: (data: PlaybookReplayFormatGuideUpdatedEvent) => void;
  onOutputFormatTemplateUpdated: (data: PlaybookOutputFormatTemplateUpdatedEvent) => void;
  onExecutionComplete: (data: PlaybookExecutionCompleteEvent) => void;
  onInterrupt: (data: PlaybookInterruptEvent) => void;

  // Catch-up
  hydrateActiveExecutions: (executions: PlaybookExecution[]) => void;

  // History
  fetchExecutions: (playbookId: string) => Promise<void>;
  fetchExecution: (playbookId: string, execId: string) => Promise<void>;
  selectStep: (taskId: string | null) => void;
  setPageMode: (mode: PlaybookPageMode) => void;

  // Designer
  fetchDesignMessages: (playbookId: string) => Promise<void>;
  designPlaybook: (playbookId: string, data: DesignPlaybookData) => Promise<void>;
  revertToSnapshot: (playbookId: string, messageId: string) => Promise<void>;
  setDesignerOpen: (open: boolean) => void;
  setCopilotMode: (mode: PlaybookCopilotMode) => void;
  setExecutionPanelOpen: (open: boolean) => void;
  viewExecutionInPanel: (executionId: string) => void;

  // Workspace Explorer
  setWorkspaceExplorerOpen: (open: boolean) => void;
  addInputFileToTask: (taskId: string, inputFile: InputFile) => void;
  removeInputFileFromTask: (taskId: string, inputFileId: string) => void;

  // Cleanup
  reset: () => void;

  // Undo/Redo
  captureSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  clearUndoHistory: () => void;
}

export type PlaybookStore = PlaybookState & PlaybookActions;
