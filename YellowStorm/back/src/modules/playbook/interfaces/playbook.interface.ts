import { ExecutionStatus } from '../schemas/playbook-execution.schema';

export interface InputFileData {
  type: 'workspace' | 'document';
  id: string;
  name: string;
  workspaceId?: string;
  portId?: string;
  metadata?: {
    workspaceId?: string;
    documentId?: string;
    filename?: string;
    filepath?: string;
    language?: string;
  };
}

export interface PlaybookTaskData {
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
  taskType?: string | null;
  inputPorts?: Array<{ id: string; name: string; artifactKind: string; required: boolean; description?: string }>;
  outputPorts?: Array<{ id: string; name: string; artifactKind: string; description?: string }>;
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
  inputFiles?: InputFileData[];
  stepReplayMode?: string;
}

export interface PlaybookEdgeData {
  id: string;
  sourceId: string;
  targetId: string;
  sourceOutputPortId?: string;
  targetInputPortId?: string;
}

export type ExecutionScheduleType = 'daily' | 'weekly' | 'monthly' | 'advanced';

export interface DailySchedulePayloadData {
  timesLocal: string[];
}

export interface WeeklySlotData {
  /** 0 = dimanche … 6 = samedi */
  weekday: number;
  timeLocal: string;
}

export interface WeeklySchedulePayloadData {
  slots: WeeklySlotData[];
}

export interface MonthlySlotData {
  /** 1–12 : uniquement ce mois chaque année ; absent / null : même jour chaque mois */
  monthOfYear?: number | null;
  /** 1–31, 0 = chaque jour du mois, ou -1 pour le dernier jour du mois */
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
  /** weekend only: 1–5 (calendar week bands), null = every week */
  weekOfMonth?: number | null;
}

export interface ExecutionScheduleData {
  enabled: boolean;
  timezone: string;
  /** Présent lorsque la planification est configurée (surtout si enabled). */
  type?: ExecutionScheduleType;
  lastScheduledRunAt: string | null;
  daily: DailySchedulePayloadData | null;
  weekly: WeeklySchedulePayloadData | null;
  monthly: MonthlySchedulePayloadData | null;
  advanced: AdvancedSchedulePayloadData | null;
}

export interface PlaybookSummaryResponse {
  id: string;
  name: string;
  description: string;
  taskCount: number;
  isFavorite: boolean;
  /** True when embedded `executionSchedule` exists and is enabled (scheduled runs). */
  scheduleEnabled: boolean;
  /** Latest execution status for the list badge. */
  executionStatus?: ExecutionStatus | null;
  integrationToken?: string | null;
  lastExecutionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookIntegrationLinkResponse {
  token: string;
}

export interface PaginatedPlaybookSummaries {
  playbooks: PlaybookSummaryResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PlaybookResponse {
  id: string;
  name: string;
  description: string;
  tasks: PlaybookTaskData[];
  edges: PlaybookEdgeData[];
  workspaces: string[];
  createdBy: string;
  isFavorite: boolean;
  isActive: boolean;
  executionSchedule: ExecutionScheduleData | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedPlaybooks {
  playbooks: PlaybookResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PlaybookExecutionResponse {
  id: string;
  playbookId: string;
  executedBy: string;
  executionNumber: number;
  currentAttemptNumber: number;
  status: string;
  executionMode: string;
  executionTrigger: 'manual' | 'scheduled';
  reflectionEnabled: boolean;
  judgeSummaryStatus: 'idle' | 'evaluating' | 'evaluated' | 'failed';
  judgeSummary: PlaybookJudgeSummary | null;
  replaySourceByTask: Record<string, { replayId: string; validationVersion: number }> | null;
  taskResults: TaskResultData[];
  threadId: string | null;
  interruptPayload: Record<string, unknown> | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  singleStepTaskId: string | null;
  playbookSnapshot: Record<string, unknown> | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  attemptHistory: Array<{
    attemptNumber: number;
    type: 'initial' | 'resume_interrupt' | 'rerun_step' | 'resume_from_step';
    taskId?: string | null;
    threadId?: string | null;
    startedAt: string;
    completedAt?: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface TaskResultData {
  taskId: string;
  nodeTitle: string;
  agentName: string;
  order: number;
  status: string;
  output: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  components?: Array<{ id: string; type: string; data: Record<string, unknown> }>;
  toolTrace?: Array<{
    callIndex: number;
    toolName: string;
    args: Record<string, unknown>;
    outputSummary: string | null;
  }>;
  llmPromptTrace?: Array<{
    stage: string;
    model: string;
    prompt: string;
  }>;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  modelName: string | null;
  attemptNumber?: number | null;
  isStale?: boolean;
  staleReason?: string | null;
  invalidatedByTaskId?: string | null;
  semanticMatch?: {
    matchScore: number;
    semanticSimilarityScore: number;
    evidenceConsistencyScore: number;
    judgeScore: number;
    reason: string;
    missingPoints: string[];
    changedPoints: string[];
    model: string;
    judgeUsed: boolean;
  } | null;
  judgeStatus?: 'idle' | 'evaluating' | 'evaluated' | 'failed';
  judgeResult?: {
    accuracyScore: number;
    completenessScore: number;
    overallScore: number;
    missingFacts: string[];
    incoherences: string[];
    unsupportedClaims: string[];
    handoffRisks: string[];
    rewriteHints: string[];
    recommendation: 'none' | 'update_current_playbook' | 'generate_new_optimized_playbook';
    reason: string;
  } | null;
  judgeError?: string | null;
  judgeHistory?: Array<{
    id: string;
    createdAt: string;
    model: string | null;
    judgeResult: {
      accuracyScore: number;
      completenessScore: number;
      overallScore: number;
      missingFacts: string[];
      incoherences: string[];
      unsupportedClaims: string[];
      handoffRisks: string[];
      rewriteHints: string[];
      recommendation: 'none' | 'update_current_playbook' | 'generate_new_optimized_playbook';
      reason: string;
    };
  }>;
  evaluationHistory?: Array<{
    id: string;
    createdAt: string;
    attemptNumber: number | null;
    trigger: 'manual' | 'auto';
    baselineReplayId: string | null;
    baselineValidationVersion: number | null;
    semanticMatch: {
      matchScore: number;
      semanticSimilarityScore: number;
      evidenceConsistencyScore: number;
      judgeScore: number;
      reason: string;
      missingPoints: string[];
      changedPoints: string[];
      model: string;
      judgeUsed: boolean;
    };
  }>;
  stepExecutions?: Array<{
    id: string;
    attemptNumber: number | null;
    status: string;
    output: string | null;
    error: string | null;
    durationMs: number | null;
    startedAt: string | null;
    completedAt: string | null;
    components?: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    toolTrace?: Array<{
      callIndex: number;
      toolName: string;
      args: Record<string, unknown>;
      outputSummary: string | null;
    }>;
    llmPromptTrace?: Array<{
      stage: string;
      model: string;
      prompt: string;
    }>;
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    modelName?: string | null;
    artifacts?: Array<{
      portId: string;
      artifactKind: string;
      content?: string;
      url?: string;
      filename?: string;
      mimeType?: string;
      size?: number;
      metadata?: Record<string, unknown>;
    }>;
  }>;
}

export interface PlaybookExecutionSummaryResponse {
  id: string;
  playbookId: string;
  executedBy: string;
  executionNumber: number;
  currentAttemptNumber: number;
  status: string;
  executionTrigger: 'manual' | 'scheduled';
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  singleStepTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookJudgeSummary {
  overallScore: number;
  structuralIssues: string[];
  promptIssues: string[];
  contractIssues: string[];
  handoffIssues: string[];
  recommendation: 'update_current_playbook' | 'generate_new_optimized_playbook';
  reason: string;
}

export interface PaginatedExecutions {
  executions: PlaybookExecutionSummaryResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PlaybookDesignMessageResponse {
  id: string;
  playbookId: string;
  userQuery: string;
  aiSummary: string;
  snapshotBefore: { tasks: PlaybookTaskData[]; edges: PlaybookEdgeData[] };
  status: string;
  revertedFromMessageId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
