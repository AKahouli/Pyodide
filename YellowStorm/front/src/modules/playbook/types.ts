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
  nodeType: PlaybookNodeType;
  title: string;
  description: string;
  icon: string;
  color: string;
  category: 'content' | 'generation' | 'analysis' | 'code' | 'evaluation';
  inputPorts: TaskInputPort[];
  outputPorts: TaskOutputPort[];
  promptTemplate: string;
  recommendedAgentTypeSlug: string | null;
  requiredToolNames: string[];
  executionMode?: TaskExecutionMode;
  assignedAgentId?: string | null;
  selectedAction?: SelectedAction;
  iteratorConfig?: PlaybookIteratorConfig | null;
  routerConfig?: RouterConfig | null;
  humanApprovalConfig?: HumanApprovalConfig | null;
  retryPolicy?: RetryPolicy | null;
  modelId?: string | null;
}

// ===== Domain Entities =====

export type PlaybookResourceKind = 'document' | 'folder' | 'workspace';

export interface PlaybookResourceReference {
  kind: PlaybookResourceKind;
  id: string;
  name: string;
  workspaceId: string;
  path?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export interface InputFile {
  type: 'workspace' | 'document' | 'folder';
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

export type TaskExecutionMode = 'agent' | 'action';
export type SelectedAction = 'index' | 'delete' | 'read';
export type PlaybookNodeType = 'agent' | 'action' | 'evaluation' | 'iterator' | 'router' | 'human_approval';
export type FlowNodeKind = 'step' | 'router' | 'iterator' | 'human_approval';
export type ControlEdgeKind = 'sequential' | 'conditional';
export type DataBindingSourceKind = 'node-output' | 'trigger' | 'state' | 'constant' | 'expression';
export type DataBindingIterationRef = 'current' | 'previous';
export type RouterConditionOperator = 'equals' | 'not_equals' | 'contains' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';
export type AdvisorScoringMode = 'llm' | 'heuristic';
export type HitlMode = 'auto' | 'manual' | 'off';
export type HitlSensitivity = 'minimal' | 'balanced' | 'strict';
export type HitlFeedbackScope =
  | 'step_only'
  | 'downstream_run'
  | 'entire_run'
  | 'future_node_runs'
  | 'future_workflow_runs';
export type HitlBlockerKind =
  | 'missing_required_input'
  | 'missing_document'
  | 'ambiguous_instruction'
  | 'destructive_action'
  | 'external_send'
  | 'workspace_write'
  | 'sensitive_domain'
  | 'low_confidence'
  | 'cost_or_runtime_risk'
  | 'explicit_user_instruction'
  | 'custom';
export type HitlBlockerAction = 'clarify' | 'approve' | 'review' | 'stop';
export type HitlRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type HitlBlockerMatcherType =
  | 'deterministic'
  | 'tool_action'
  | 'input_binding'
  | 'llm_judge'
  | 'custom_expression';

export interface HitlPolicy {
  mode: HitlMode;
  sensitivity: HitlSensitivity;
  clarificationEnabled: boolean;
  approvalEnabled: boolean;
  reviewEnabled: boolean;
  propagateFeedbackDefault: boolean;
  defaultFeedbackScope: HitlFeedbackScope;
  inheritedFromWorkflow?: boolean;
  disabledReason?: string | null;
}

export interface HitlBlockerRule {
  id: string;
  scope: 'workflow' | 'node';
  nodeId?: string | null;
  enabled: boolean;
  kind: HitlBlockerKind;
  label: string;
  description: string;
  action: HitlBlockerAction;
  riskLevel: HitlRiskLevel;
  sensitivity: HitlSensitivity;
  matcherType: HitlBlockerMatcherType;
  matcherConfig: Record<string, unknown>;
  promptTemplate?: string | null;
  appliesToToolNames?: string[];
  appliesToConnectorActions?: string[];
  createdBy: 'system' | 'user' | 'assistant';
  createdAt: string;
  updatedAt: string;
}

export interface HitlMemory {
  id: string;
  ownerId: string;
  flowId: string;
  nodeId?: string | null;
  memoryType: 'semantic' | 'episodic' | 'procedural' | 'approval_policy';
  source: 'hitl_feedback' | 'blocker_rule' | 'replay_validation' | 'manual';
  title: string;
  content: string;
  normalizedInstruction: string;
  appliesTo: 'node' | 'workflow' | 'agent' | 'workspace';
  status: 'active' | 'draft' | 'archived';
  sensitivity: 'normal' | 'sensitive';
  createdFromExecutionId?: string;
  createdFromInterruptId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HitlEventLog {
  id: string;
  nodeId: string;
  iteration: number;
  interruptId: string;
  type: InterruptType | string;
  blockerRuleId?: string | null;
  blockerKind?: HitlBlockerKind | string | null;
  reasonCode: string;
  riskLevel: HitlRiskLevel;
  prompt: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'answered' | 'expired' | 'cancelled';
  response?: {
    action: string;
    message?: string | null;
    approved?: boolean | null;
    reason?: string | null;
    feedback?: string | null;
    scope?: HitlFeedbackScope;
    remember?: boolean;
  } | null;
  downstreamNodeIds: string[];
  createdAt: string;
  respondedAt?: string | null;
}

export type IteratorMode = 'item' | 'batch';
export type IteratorErrorStrategy = 'stop' | 'continue';

export interface PlaybookIteratorConfig {
  source: string;
  mode: IteratorMode;
  batchSize?: number | null;
  itemVariable?: string | null;
  outputVariable?: string | null;
  errorStrategy?: IteratorErrorStrategy;
}

export interface PlaybookContainerConfig {
  parentIteratorId?: string | null;
}

export interface PlaybookIteratorLayout {
  width?: number;
  height?: number;
}

export interface PlaybookEvaluationRubricWeights {
  semanticMatch: number;
  referenceMatch: number;
  artifactRequirements: number;
  formatCompliance: number;
  evidenceConsistency: number;
  executionHealth: number;
}

export interface PlaybookEvaluationConfig {
  expectation: string;
  referenceBaselineId?: string | null;
  passThreshold: number;
  warningThreshold: number;
  weight: number;
  rubricVersion: string;
  weights: PlaybookEvaluationRubricWeights;
}

export interface PlaybookEvaluationBaselineArtifactSnapshot {
  id?: string | null;
  kind: ArtifactKind;
  name?: string | null;
  mimeType?: string | null;
  uri?: string | null;
  textPreview?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PlaybookEvaluationBaselineInputSnapshot {
  sourceTaskId: string;
  sourceOutputPortId?: string | null;
  targetInputPortId?: string | null;
  output?: string | null;
  artifacts: PlaybookEvaluationBaselineArtifactSnapshot[];
}

export interface PlaybookEvaluationBaseline {
  id: string;
  playbookId: string;
  evaluationTaskId: string;
  sourceExecutionId: string;
  sourceMode: 'selected_execution' | 'current_inputs';
  inputSnapshots: PlaybookEvaluationBaselineInputSnapshot[];
  createdAt: string;
  updatedAt: string;
  replacedAt?: string | null;
}

export interface PlaybookEvaluationExecutionFinding {
  severity: 'info' | 'warning' | 'error';
  category: 'semantic' | 'reference' | 'artifact' | 'format' | 'evidence' | 'execution';
  sourceTaskId?: string | null;
  message: string;
}

export interface PlaybookEvaluationExecution {
  id: string;
  playbookId: string;
  executionId: string;
  evaluationTaskId: string;
  evaluationTaskTitle: string;
  baselineId?: string | null;
  mode: 'semantic' | 'reference' | 'hybrid';
  status: 'running' | 'completed' | 'failed';
  score?: number | null;
  verdict?: 'pass' | 'warning' | 'fail' | null;
  expectation?: string;
  summary?: string | null;
  findings: PlaybookEvaluationExecutionFinding[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface PlaybookTask {
  id: string;
  title: string;
  description: string;
  assignedAgentId: string | null;
  executionMode?: TaskExecutionMode;
  selectedAction?: SelectedAction;
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
  activeReplayLabel?: string | null;
  activeReplayOverallScore?: number | null;
  activeReplayReplayConfig?: {
    replayOutputFormat: boolean;
    replayToolTrace: boolean;
    replayReasoningChain: boolean;
  };
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
  nodeType?: PlaybookNodeType | null;
  templateType?: string | null;
  inputPorts?: TaskInputPort[];
  outputPorts?: TaskOutputPort[];
  toolBindings?: ToolBinding[];
  evaluationConfig?: PlaybookEvaluationConfig | null;
  iteratorConfig?: PlaybookIteratorConfig | null;
  iteratorLayout?: PlaybookIteratorLayout | null;
  containerConfig?: PlaybookContainerConfig | null;
  routerConfig?: RouterConfig | null;
  humanApprovalConfig?: HumanApprovalConfig | null;
  retryPolicy?: RetryPolicy | null;
  modelId?: string | null;
  hitlPolicy?: HitlPolicy | null;
  expectedResult?: string | null;
  disableAdvisorEvaluation?: boolean;
  advisorOptimizedAt?: string | null;
}

export type PlaybookSuggestionMode = 'inherit' | 'auto' | 'manual';

export type PlaybookNodeAdvisorSuggestionType =
  | 'task_title'
  | 'task_description'
  | 'agent_selection'
  | 'datasource_connection'
  | 'input_contract'
  | 'output_contract'
  | 'general';

export interface RequestPlaybookNodeAdvisorData {
  intent?: string;
  suggestionTypes?: PlaybookNodeAdvisorSuggestionType[];
  includeGraphContext?: boolean;
  title?: string;
  description?: string;
}

export interface PlaybookNodeAdvisorPortSuggestion {
  id: string;
  name: string;
  artifactKind: string;
  description?: string;
}

export interface PlaybookNodeAdvisorDatasourceSuggestion {
  sourceTaskId?: string | null;
  sourceOutputPortId?: string | null;
  targetInputPortId?: string | null;
  datasourceType?: string | null;
  datasourceId?: string | null;
  datasourceName?: string | null;
  rationale: string;
}

export interface PlaybookNodeAdvisorPatch {
  taskTitle?: string;
  taskDescription?: string;
  assignedAgentId?: string;
  inputPorts?: PlaybookNodeAdvisorPortSuggestion[];
  outputPorts?: PlaybookNodeAdvisorPortSuggestion[];
  datasourceSuggestions?: PlaybookNodeAdvisorDatasourceSuggestion[];
}

export interface PlaybookNodeAdvisorSuggestion {
  id: string;
  type: PlaybookNodeAdvisorSuggestionType;
  title: string;
  summary: string;
  rationale: string;
  confidence: number;
  patch?: PlaybookNodeAdvisorPatch;
  warnings?: string[];
}

export interface PlaybookNodeAdvisorResponse {
  playbookId: string;
  taskId: string;
  suggestions: PlaybookNodeAdvisorSuggestion[];
}

export interface PlaybookDesignSettings {
  inferenceModelId: string | null;
  nodeSuggestionsMode: PlaybookSuggestionMode;
  approvalSuggestionMode: PlaybookSuggestionMode;
}

export interface EffectivePlaybookDesignSettings {
  inferenceModelId: string | null;
  resolvedInferenceModelId: string | null;
  nodeSuggestionsMode: 'auto' | 'manual';
  approvalSuggestionMode: 'auto' | 'manual';
}

export type PlaybookIntentOperationType =
  | 'create_node'
  | 'insert_before'
  | 'insert_after'
  | 'update_node'
  | 'delete_node'
  | 'update_hitl_policy'
  | 'create_blocker_rule'
  | 'update_blocker_rule'
  | 'delete_blocker_rule'
  | 'create_hitl_memory';

export type PlaybookIntentSuggestionKind = 'single_change' | 'workflow_plan';

export interface PlaybookIntentTaskDraft {
  title: string;
  description: string;
  agentSlug?: string | null;
  templateType?: string | null;
  inputPorts?: Array<{
    id: string;
    name?: string | null;
    artifactKind: ArtifactKind;
    required?: boolean;
  }>;
  outputPorts?: Array<{
    id: string;
    name?: string | null;
    artifactKind: ArtifactKind;
  }>;
  iteratorBody?: {
    steps: Array<{
      nodeRef: string;
      title: string;
      description: string;
      agentSlug?: string | null;
      templateType?: string | null;
      inputPorts?: Array<{
        id: string;
        name?: string | null;
        artifactKind: ArtifactKind;
        required?: boolean;
      }>;
      outputPorts?: Array<{
        id: string;
        name?: string | null;
        artifactKind: ArtifactKind;
      }>;
    }>;
    edges: Array<{
      sourceNodeRef: string;
      targetNodeRef: string;
      sourceOutputPortId?: string | null;
      targetInputPortId?: string | null;
    }>;
  };
}

export interface PlaybookIntentSingleChangeSuggestion {
  id: string;
  kind: 'single_change';
  label: string;
  summary: string;
  reason: string;
  confidence: number;
  operationType: PlaybookIntentOperationType;
  task: PlaybookIntentTaskDraft | Partial<PlaybookIntentTaskDraft> | null;
  targetTaskId: string | null;
  isDirectIntentFallback: boolean;
}

export type PlaybookIntentWorkflowAnchorMode = 'append' | 'before' | 'after' | 'as_input';

export interface PlaybookIntentWorkflowAnchor {
  mode: PlaybookIntentWorkflowAnchorMode;
  targetTaskId: string | null;
  nodeRef: string | null;
  targetTaskIds?: string[];
  nodeRefs?: string[];
  sourceOutputPortId?: string | null;
  targetInputPortId?: string | null;
}

export type PlaybookIntentWorkflowChange =
  | {
      type: 'create_node';
      nodeRef: string;
      anchor: PlaybookIntentWorkflowAnchor;
      task: PlaybookIntentTaskDraft;
    }
  | {
      type: 'update_node';
      targetTaskId: string;
      task: Partial<PlaybookIntentTaskDraft>;
    }
  | {
      type: 'delete_node';
      targetTaskId: string;
    }
  | {
      type: 'create_edge' | 'delete_edge';
      sourceTaskId: string | null;
      sourceNodeRef: string | null;
      targetTaskId: string | null;
      targetNodeRef: string | null;
      sourceOutputPortId?: string | null;
      targetInputPortId?: string | null;
    }
  | {
      type: 'create_data_binding';
      targetTaskId: string | null;
      targetNodeRef: string | null;
      targetPort: string;
      sourceKind: 'node-output';
      sourceTaskId: string | null;
      sourceNodeRef: string | null;
      sourcePort: string | null;
      iteration?: 'current' | 'previous';
    }
  | {
      type: 'delete_data_binding';
      targetTaskId: string | null;
      targetNodeRef: string | null;
      targetPort: string;
      sourceTaskId?: string | null;
      sourceNodeRef?: string | null;
      sourcePort?: string | null;
    };

export interface PlaybookIntentWorkflowImpact {
  nodesToCreate: number;
  nodesToUpdate: number;
  nodesToDelete: number;
  edgesToCreate: number;
  edgesToDelete: number;
  dataBindingsToCreate: number;
  dataBindingsToDelete: number;
  affectedTaskIds: string[];
  businessOutcome: string;
}

export interface PlaybookIntentWorkflowPlanSuggestion {
  id: string;
  kind: 'workflow_plan';
  label: string;
  summary: string;
  reason: string;
  confidence: number;
  impact: PlaybookIntentWorkflowImpact;
  changes: PlaybookIntentWorkflowChange[];
  isDirectIntentFallback: false;
}

export type PlaybookIntentSuggestion = PlaybookIntentSingleChangeSuggestion | PlaybookIntentWorkflowPlanSuggestion;

export interface IntentSuggestionHistoryEntry {
  id: string;
  suggestion: PlaybookIntentSuggestion;
  appliedAt: number;
  intent: string;
  playbookId: string;
  playbookName: string;
}

export interface RequestPlaybookIntentData {
  intent: string;
  selectedTaskId?: string;
}

export interface PlaybookIntentResponse {
  suggestions: PlaybookIntentSuggestion[];
  model: string;
  settings: EffectivePlaybookDesignSettings;
}

export interface ToolBindingAction {
  actionKey: string;
  isEnabled?: boolean;
}

export interface ToolBinding {
  id: string;
  connectorId: string;
  connectorName?: string;
  actions: ToolBindingAction[];
  credentialId?: string | null;
  fixedParams?: Record<string, unknown>;
  disableAutoSkills?: boolean;
  isEnabled?: boolean;
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

export interface PlaybookManualTrigger {
  type: 'manual';
  enabled: true;
}

export interface PlaybookScheduleTrigger {
  type: 'schedule';
  enabled: boolean;
  schedule: ExecutionScheduleData | null;
}

export interface MailAttachmentWorkspaceImport {
  workspaceDocumentId: string | null;
  filename: string;
  finalFilename: string | null;
  mimeType: string | null;
  size: number | null;
  sourcePath: string | null;
  collisionResolved: boolean;
  error: string | null;
}

export interface MailMessageAttachment {
  providerAttachmentId: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
  isInline: boolean;
  workspaceImport: MailAttachmentWorkspaceImport | null;
}

export interface MailTriggerRuntimePayload {
  provider: 'm365';
  mailboxAppKey: string;
  providerMessageId: string;
  providerThreadId: string | null;
  receivedAt: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  from: { name: string | null; address: string };
  to: Array<{ name: string | null; address: string }>;
  cc: Array<{ name: string | null; address: string }>;
  hasAttachments: boolean;
  attachments: MailMessageAttachment[];
}

export interface PlaybookMailTriggerNodeInput {
  trigger: {
    type: 'mail';
    occurredAt: string;
  };
  message: MailTriggerRuntimePayload;
}

export interface PlaybookMailTrigger {
  type: 'mail';
  enabled: boolean;
  available: boolean;
  config: {
    enabled: boolean;
    mailboxAppKey: string | null;
    notificationUrl: string | null;
    autoRenewUntil: string | null;
    attachmentImportEnabled: boolean;
    allowedAttachmentExtensions: string[];
    filters: {
      from: string[];
      subjectContains: string[];
      bodyContains: string[];
      hasAttachments: boolean | null;
    };
    runtimeEnabled: boolean;
    subscriptionId: string | null;
    subscriptionClientState: string | null;
    subscriptionExpiresAt: string | null;
    runtimePayloadSchema: PlaybookMailTriggerNodeInput | null;
  } | null;
}

export type PlaybookTrigger = PlaybookManualTrigger | PlaybookScheduleTrigger | PlaybookMailTrigger;

export interface PlaybookTriggersData {
  automatedTriggerType: 'schedule' | 'mail' | null;
  triggers: PlaybookTrigger[];
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

export interface UpsertPlaybookMailTriggerData {
  enabled: boolean;
  mailboxAppKey?: string;
  autoRenewUntil?: string | null;
  attachmentImportEnabled?: boolean;
  allowedAttachmentExtensions?: string[];
  filters?: {
    from?: string[];
    subjectContains?: string[];
    bodyContains?: string[];
    hasAttachments?: boolean | null;
  };
}

export interface SyncPlaybookMailSubscriptionData {
  notificationUrl?: string;
  autoRenewUntil?: string | null;
}

export interface PlaybookSummary {
  id: string;
  name: string;
  description: string;
  taskCount: number;
  isFavorite: boolean;
  /** True when the playbook has an enabled execution schedule (list API). */
  scheduleEnabled: boolean;
  automatedTriggerType?: 'schedule' | 'mail' | null;
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
  designSettings: PlaybookDesignSettings;
  effectiveDesignSettings: EffectivePlaybookDesignSettings;
  tasks: PlaybookTask[];
  edges: PlaybookEdge[];
  reflectionEnabled: boolean;
  advisorScoringMode?: AdvisorScoringMode;
  workspaces: string[];
  createdBy: string;
  isFavorite: boolean;
  isActive: boolean;
  executionSchedule: ExecutionScheduleData | null;
  triggers: PlaybookTrigger[];
  automatedTriggerType: 'schedule' | 'mail' | null;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number | null;
  advisorAutopilotMaxTurns?: number | null;
  createdAt: string;
  updatedAt: string;
  nodes?: FlowNode[];
  controlEdges?: ControlEdge[];
  dataBindings?: DataBinding[];
  settings?: FlowSettings;
}

export interface CloneShareResult {
  succeeded: { email: string; playbookId: string }[];
  failed: { email: string; reason: string }[];
}

export interface PublicReasoningTraceItem {
  id: string;
  type: string;
  label: string;
  description: string;
  confidence?: number | null;
}

export interface ToolTraceItem {
  callIndex: number;
  toolName: string;
  args: Record<string, unknown>;
  outputSummary: string | null;
  purpose?: string | null;
}

export interface ReplayContextMappingEntry {
  variableKey: string;
  key: string;
  label: string;
  source: 'task' | 'input_context' | 'tool_args' | 'unknown' | 'task_title' | 'task_description' | 'task_text';
  valueType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';
  required: boolean;
  baselineValue: string | null;
  currentValue: string | number | boolean | Record<string, unknown> | unknown[] | null;
  confidence: number;
  reason: string;
  value: string | number | boolean | Record<string, unknown> | unknown[] | null;
  matched: boolean;
}

export interface ReplayPlanToolStep {
  stepIndex: number;
  toolName: string;
  purpose: string;
  required: boolean;
  argumentShape: Record<string, unknown>;
  argumentShapeKeys: string[];
  expectedArgs: Record<string, unknown>;
  sourceCallIndex?: number | null;
}

export interface ReplayToolCallComparison {
  expectedStepIndex: number | null;
  expectedToolName: string | null;
  expectedPurpose: string | null;
  expectedArgs: Record<string, unknown>;
  observedCallIndex: number | null;
  observedToolName: string | null;
  observedPurpose?: string | null;
  observedArgs: Record<string, unknown>;
  status: 'matched' | 'warning' | 'failed' | 'missing' | 'extra';
  reasons: string[];
}

export interface ReplaySemanticChecklistItem {
  key: string;
  description: string;
  variables: string[];
  severity: 'info' | 'warning' | 'fail';
  source: 'intent' | 'reasoning' | 'quality_check' | 'output_contract' | 'context';
}

export interface ReplaySemanticFinding {
  key?: string | null;
  expected?: string | null;
  observed?: string | null;
  severity: 'info' | 'warning' | 'fail';
}

export interface ReplayExecutionPlan {
  taskId: string;
  replayId: string;
  validationVersion: number;
  intentKey: string | null;
  intentLabel: string | null;
  matchedContextCount: number;
  missingRequiredContextCount: number;
  requiredStageLabels: string[];
  requiredOutputChecks: string[];
  plannedToolSteps: ReplayPlanToolStep[];
  semanticChecklist: ReplaySemanticChecklistItem[];
}

export interface ReplayPlanningSummary {
  replayId: string;
  validationVersion: number;
  intentKey: string | null;
  intentLabel: string | null;
  contextMapping: ReplayContextMappingEntry[];
  executionPlan: ReplayExecutionPlan;
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
  preservedPoints?: string[];
  missingPointFindings?: ReplaySemanticFinding[];
  changedPointFindings?: ReplaySemanticFinding[];
  extraPointFindings?: ReplaySemanticFinding[];
  staleContextReferenceFindings?: ReplaySemanticFinding[];
  unsupportedClaimFindings?: ReplaySemanticFinding[];
  evaluationSource?: 'instantiated_replay' | 'runtime' | 'unknown' | null;
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
  displayText?: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  components?: PlaybookComponent[];
  toolTrace?: ToolTraceItem[];
  reasoningChain?: PublicReasoningTraceItem[];
  llmPromptTrace?: LLMPromptTraceItem[];
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  modelName?: string | null;
  artifacts?: TaskArtifact[];
}

export interface IteratorChildResult {
  taskId: string;
  taskTitle: string;
  status: StepStatus;
  output?: string | null;
  error?: string | null;
  components?: PlaybookComponent[];
  toolTrace?: ToolTraceItem[];
  reasoningChain?: PublicReasoningTraceItem[];
  llmPromptTrace?: LLMPromptTraceItem[];
  artifacts?: TaskArtifact[];
}

export interface IteratorIterationResult {
  index: number;
  status: StepStatus;
  itemPreview?: string | null;
  output?: string | null;
  error?: string | null;
  childResults: IteratorChildResult[];
  artifacts?: TaskArtifact[];
}

export interface TaskResult {
  taskId: string;
  nodeTitle: string;
  agentName: string;
  order: number;
  iteration?: number;
  status: StepStatus;
  output: string | null;
  displayText?: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  components?: PlaybookComponent[];
  toolTrace?: ToolTraceItem[];
  reasoningChain?: PublicReasoningTraceItem[];
  llmPromptTrace?: LLMPromptTraceItem[];
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  modelName?: string | null;
  semanticMatch?: SemanticMatchResult | null;
  traceMetadata?: Record<string, unknown> | null;
  judgeStatus?: 'idle' | 'evaluating' | 'evaluated' | 'failed';
  judgeScoringMode?: AdvisorScoringMode | null;
  judgeResult?: {
    accuracyScore: number;
    completenessScore: number;
    resultMatchingScore: number;
    overallScore: number;
    confidence: number;
    toolUsageScore: number;
    expectedResultSource: 'node_field' | 'golden_baseline' | 'none';
    expectedResultType: 'exact_value' | 'semantic_description' | 'numeric_presentation' | 'document_generation' | 'baseline_comparison' | 'none';
    expectedResultMatched: boolean;
    expectedResultReason: string;
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
    scoringMode: AdvisorScoringMode;
    usage?: {
      inputTokens?: number | null;
      outputTokens?: number | null;
      totalTokens?: number | null;
      model?: string | null;
    } | null;
    llmPromptTrace?: LLMPromptTraceItem[];
    judgeResult: {
      accuracyScore: number;
      completenessScore: number;
      resultMatchingScore: number;
      overallScore: number;
      confidence: number;
      toolUsageScore: number;
      expectedResultSource: 'node_field' | 'golden_baseline' | 'none';
      expectedResultType: 'exact_value' | 'semantic_description' | 'numeric_presentation' | 'document_generation' | 'baseline_comparison' | 'none';
      expectedResultMatched: boolean;
      expectedResultReason: string;
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
  advisorOptimizationHistory?: Array<{
    turn: number;
    createdAt: string;
    changedFields: string[];
    beforeTask: Record<string, unknown>;
    afterTask: Record<string, unknown>;
  }>;
  lastAdvisorAction?: string | null;
  lastAdvisorScoreDelta?: number | null;
  advisorStopReason?: string | null;
  attemptNumber?: number | null;
  isStale?: boolean;
  staleReason?: string | null;
  invalidatedByTaskId?: string | null;
  iteratorIterations?: IteratorIterationResult[];
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
  advisorScoringMode?: AdvisorScoringMode;
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
  replaySource?: {
    executionId: string;
    taskId: string;
    iteration?: number;
  } | null;
  replaySourceByTask?: Record<string, { replayId: string; validationVersion: number }> | null;
  replayPlanningByTask?: Record<string, ReplayPlanningSummary> | null;
  stepExecutionModes?: Record<string, 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive'>;
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
  pendingInterrupts?: InterruptPayload[];
  waitingForHumanInput?: boolean;
  currentInterruptId?: string | null;
  currentInterruptTaskId?: string | null;
  hitlHistory?: HitlHistoryEntry[];
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  singleStepTaskId: string | null;
  playbookSnapshot: Record<string, unknown> | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  queuePosition?: number | null;
  totalQueueSize?: number | null;
  recursionBudgetUsed?: number | null;
  recursionBudgetMax?: number | null;
  routerDecisions?: RouterDecision[];
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

export type ReplayMode = 'replay_strict' | 'replay_flex' | 'replay_adaptive';

export type ReplayRunVerdict = 'pass' | 'warning' | 'fail' | 'skipped' | 'unknown';
export type ReplaySignalEvaluationStatus = 'not_evaluated' | 'not_applicable' | 'passed' | 'warning' | 'failed';

export type ReplayPostRunVerdict = 'match' | 'minor_drift' | 'major_drift' | 'not_comparable';
export type ReplayPostRunRecommendedAction = 'accept' | 'review' | 'reject';

export interface ReplayPostRunEvaluation {
  judgeUsed: boolean;
  judgeModel: string | null;
  evaluatedAt: string;
  verdict: ReplayPostRunVerdict;
  overallScore: number | null;
  semanticMatchScore: number | null;
  outputFormatScore: number | null;
  toolSequenceScore: number | null;
  toolDefinitionScore: number | null;
  reasoningScore: number | null;
  summary: string;
  missingPoints: string[];
  changedPoints: string[];
  preservedPoints: string[];
  recommendedAction: ReplayPostRunRecommendedAction;
  rawJudgeResponse: Record<string, unknown> | null;
  failureReason: string | null;
}

export interface ReplayDriftFinding {
  category: 'context' | 'reasoning' | 'tool_sequence' | 'argument_shape' | 'output_contract' | 'semantic';
  severity: 'info' | 'warning' | 'fail';
  reason: string;
}

export interface ReplaySignalStatus {
  status: ReplaySignalEvaluationStatus;
  reason?: string | null;
}

export interface ReplayHitlSummary {
  baselineHitlCount: number;
  runtimeHitlCount: number;
  reusedMemoryCount: number;
  newClarificationCount: number;
  approvalReaskedCount: number;
  hitlContextDrift: boolean;
  findings: Array<{
    severity: 'info' | 'warning' | 'fail';
    message: string;
    nodeId: string;
  }>;
}

export interface ReplayRunReport {
  id: string;
  executionId: string;
  flowId: string;
  taskId: string;
  iteration: number;
  replayId: string;
  validationVersion: number;
  mode: ReplayMode;
  applied: boolean;
  confidenceScore: number;
  appliedSections: string[];
  skippedSections: string[];
  invalidationReasons: string[];
  confidenceFactors: Record<string, number>;
  outputContractEvaluated: boolean;
  outputContractPassed: boolean;
  structuralDriftScore: number | null;
  toolPolicyScore: number | null;
  verdict?: ReplayRunVerdict | null;
  overallScore?: number | null;
  verdictReasons?: string[];
  structuralDriftReasons: string[];
  semanticMatch?: SemanticMatchResult | null;
  matchedBaselineId?: string | null;
  matchedBaselineVersion?: number | null;
  intentKey?: string | null;
  replayConfidence?: number | null;
  toolSequenceMatch?: number | null;
  argumentShapeMatch?: number | null;
  reasoningMatch?: number | null;
  outputFormatMatch?: number | null;
  contextDrift?: number | null;
  dataDrift?: number | null;
  driftFindings?: ReplayDriftFinding[];
  blockedBy?: string[];
  expectedToolSteps?: ReplayPlanToolStep[];
  observedToolCalls?: ToolTraceItem[];
  toolCallComparisons?: ReplayToolCallComparison[];
  instantiatedSemanticChecklist?: ReplaySemanticChecklistItem[];
  intentStatus?: ReplaySignalStatus;
  reasoningStatus?: ReplaySignalStatus;
  toolSequenceStatus?: ReplaySignalStatus;
  argumentShapeStatus?: ReplaySignalStatus;
  outputContractStatus?: ReplaySignalStatus;
  semanticStatus?: ReplaySignalStatus;
  contextSubstitutionStatus?: ReplaySignalStatus;
  postRunEvaluation?: ReplayPostRunEvaluation | null;
  hitlSummary?: ReplayHitlSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface ValidatedReplayToolCall {
  callIndex: number;
  toolName: string;
  args: Record<string, unknown>;
  outputSummary: string | null;
}

export interface ReplayReasoningStage {
  stageKey: string;
  stageType: string;
  label: string;
  description: string;
  confidence?: number | null;
}

export interface ReplayContextVariable {
  key: string;
  label: string;
  source: 'task' | 'input_context' | 'tool_args' | 'unknown';
  valueType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';
  required: boolean;
  exampleValue?: string | null;
}

export interface ReplayToolTraceTemplateItem {
  stepIndex: number;
  toolName: string;
  purpose: string;
  argumentShape: Record<string, unknown>;
  required: boolean;
}

export interface ReplayDriftPolicy {
  requireSameIntent: boolean;
  requireSameReasoningStages: boolean;
  requireSameToolOrder: boolean;
  allowAdditionalTools: boolean;
  allowArgumentValueChanges: boolean;
  enforceOutputContract: boolean;
}

export interface ReplayAcceptedExample {
  referenceExecutionId: string;
  referenceExecutionNumber: number;
  summary: string;
  outputPreview?: string | null;
}

export interface ReplayHitlMemorySnapshot {
  interruptId: string;
  nodeId: string;
  iteration: number;
  type: 'clarification' | 'approval_request' | 'review_request';
  blockerKind?: string | null;
  reasonCode: string;
  prompt: string;
  responseAction: string;
  responseMessage?: string | null;
  responseScope: HitlFeedbackScope;
  downstreamNodeIds: string[];
  reusableInReplay: boolean;
  contextFingerprint: string;
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
  mode: ReplayMode | 'strict_replay';
  referenceTaskDescription?: string;
  referenceAssignedAgentId?: string | null;
  referenceWorkspaceIds?: string[];
  toolCalls: ValidatedReplayToolCall[];
  referenceOutput: string | null;
  outputContract?: {
    type: 'freeform' | 'markdown_sections' | 'json_schema';
    requiredSections: string[];
    forbiddenSections: string[];
    jsonSchema?: Record<string, unknown> | null;
    citationPolicy: 'required' | 'optional' | 'forbidden';
  } | null;
  preserveOutputFormat?: boolean;
  outputFormatGuide?: string | null;
  formatGuideStatus?: 'disabled' | 'pending' | 'ready' | 'failed';
  formatGuideError?: string | null;
  llmPromptTrace?: LLMPromptTraceItem[];
  reasoningChain?: PublicReasoningTraceItem[];
  intentKey?: string | null;
  intentLabel?: string | null;
  reasoningOutline?: ReplayReasoningStage[];
  stableReasoningRules?: string[];
  contextVariableSchema?: ReplayContextVariable[];
  toolTraceTemplate?: ReplayToolTraceTemplateItem[];
  driftPolicy?: ReplayDriftPolicy | null;
  acceptedExamples?: ReplayAcceptedExample[];
  hitlMemorySnapshots?: ReplayHitlMemorySnapshot[];
  referenceUsage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    model?: string | null;
  } | null;
  referenceSemanticMatch?: SemanticMatchResult | null;
  fingerprints?: {
    inputContextHash?: string | null;
    flowSnapshotHash?: string | null;
    nodeSnapshotHash?: string | null;
    agentConfigHash?: string | null;
    modelConfigHash?: string | null;
    toolConfigHash?: string | null;
    outputContractHash?: string | null;
  } | null;
  traceMetadata?: Record<string, unknown>;
  referenceFlowRevision?: number;
  referenceNodeSnapshot?: Record<string, unknown> | null;
  isStale?: boolean;
  staleReasons?: string[];
  label?: string | null;
  replayConfig?: {
    replayOutputFormat: boolean;
    replayToolTrace: boolean;
    replayReasoningChain: boolean;
  };
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

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'interrupted' | 'cancelled' | 'queued' | 'pending_approval';
export type ExecutionStatus = 'queued' | 'pending' | 'running' | 'pending_approval' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
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
  blockerRuleId?: string | null;
  blockerKind?: HitlBlockerKind | string | null;
  reasonCode?: string | null;
  riskLevel?: HitlRiskLevel | string | null;
  confidence?: number | null;
  downstreamNodeIds?: string[];
  feedbackScopeDefault?: HitlFeedbackScope;
  suggestedChoices?: string[];
  memoryCandidate?: boolean;
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
  scope?: HitlFeedbackScope;
  remember?: boolean;
  blockerRuleId?: string | null;
  blockerKind?: HitlBlockerKind | string | null;
  reasonCode?: string | null;
  riskLevel?: HitlRiskLevel | string | null;
  downstreamNodeIds?: string[];
  feedbackScopeDefault?: HitlFeedbackScope;
  memoryCandidate?: boolean;
}

export interface HitlHistoryEntry {
  interruptId: string;
  taskId: string;
  type: InterruptType | string;
  taskTitle: string;
  message: string;
  taskDescription: string;
  result: string;
  round: number;
  payloadJson: string;
  resumableActions: string[];
  status: 'pending' | 'answered';
  responseAction: InterruptAction | string | null;
  responseMessage: string | null;
  responseApproved: boolean | null;
  responseReason: string | null;
  responseFeedback: string | null;
  responseScope?: HitlFeedbackScope | null;
  responseRemember?: boolean | null;
  blockerRuleId?: string | null;
  blockerKind?: HitlBlockerKind | string | null;
  reasonCode?: string | null;
  riskLevel?: HitlRiskLevel | string | null;
  downstreamNodeIds?: string[];
  feedbackScopeDefault?: HitlFeedbackScope;
  memoryCandidate?: boolean;
  respondedBy: string | null;
  respondedAt: string | null;
  createdAt: string;
}

// ===== ReactFlow Node Data =====

export interface PlaybookNodeData extends PlaybookTask {
  stepStatus?: StepStatus;
  stepSemanticMatch?: SemanticMatchResult | null;
  stepJudgeStatus?: 'idle' | 'evaluating' | 'evaluated' | 'failed';
  stepJudgeResult?: TaskResult['judgeResult'];
  activeRouterLabel?: string;
  [key: string]: unknown;
}

// ===== SSE Events =====

export interface PlaybookExecutionStartEvent {
  executionId: string;
  playbookId: string;
  executionNumber: number;
  status: string;
  executionMode?: 'live' | 'inherit' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';
  stepExecutionModes?: Record<string, 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive'>;
  reflectionEnabled?: boolean;
  advisorScoringMode?: AdvisorScoringMode;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number;
  advisorAutopilotMaxTurns?: number;
  advisorAutopilotStatus?: 'idle' | 'running' | 'judging' | 'optimizing' | 'rerunning' | 'completed' | 'stopped' | 'failed';
  advisorAutopilotTaskId?: string | null;
  advisorAutopilotAttemptCount?: number;
  advisorAutopilotLastError?: string | null;
  singleStepTaskId?: string | null;
  replaySourceByTask?: Record<string, { replayId: string; validationVersion: number }> | null;
  replayPlanningByTask?: Record<string, ReplayPlanningSummary> | null;
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
  advisorOptimizationHistoryEntry?: TaskResult['advisorOptimizationHistory'] extends Array<infer T> ? T : never;
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
  iteration?: number;
  status: string;
  output?: string;
  error?: string;
  durationMs?: number;
  components?: PlaybookComponent[];
  toolTrace?: ToolTraceItem[];
  reasoningChain?: PublicReasoningTraceItem[];
  llmPromptTrace?: LLMPromptTraceItem[];
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  modelName?: string;
  semanticMatch?: SemanticMatchResult | null;
  traceMetadata?: Record<string, unknown>;
  iteratorIterations?: IteratorIterationResult[];
  artifacts?: TaskArtifact[];
}

export interface PlaybookIteratorChildStepStartEvent {
  executionId: string;
  parentIteratorId: string;
  iterationIndex: number;
  taskId: string;
  taskTitle?: string;
  status: string;
}

export interface PlaybookIteratorChildStepUpdateEvent {
  executionId: string;
  parentIteratorId: string;
  iterationIndex: number;
  taskId: string;
  taskTitle?: string;
  status: string;
  output?: string;
  components?: PlaybookComponent[];
  toolTrace?: ToolTraceItem[];
  llmPromptTrace?: LLMPromptTraceItem[];
  artifacts?: TaskArtifact[];
}

export interface PlaybookIteratorChildStepCompleteEvent {
  executionId: string;
  parentIteratorId: string;
  iterationIndex: number;
  taskId: string;
  taskTitle?: string;
  status: string;
  output?: string;
  error?: string;
  durationMs?: number;
  components?: PlaybookComponent[];
  toolTrace?: ToolTraceItem[];
  reasoningChain?: PublicReasoningTraceItem[];
  llmPromptTrace?: LLMPromptTraceItem[];
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
  iteration?: number;
  advisorScoringMode?: AdvisorScoringMode;
  judgeStatus: 'evaluating';
}

export interface PlaybookStepJudgeUpdatedEvent {
  executionId: string;
  taskId: string;
  iteration?: number;
  advisorScoringMode?: AdvisorScoringMode;
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
  blockerRuleId?: string;
  blockerKind?: string;
  reasonCode?: string;
  riskLevel?: string;
  downstreamNodeIds?: string[];
  feedbackScopeDefault?: HitlFeedbackScope;
  memoryCandidate?: boolean;
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
  dataBindings: DataBinding[];
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

export type DesignOperationStatus = 'queued' | 'running' | 'applying' | 'completed' | 'failed' | 'cancelled';

export interface DesignOperation {
  id: string;
  flowId: string;
  ownerId: string;
  query: string;
  status: DesignOperationStatus;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  resultPreview: Record<string, unknown> | null;
  appliedMessageId: string | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePlaybookData {
  name?: string;
  description?: string;
  designSettings?: Partial<PlaybookDesignSettings>;
  tasks?: PlaybookTask[];
  edges?: PlaybookEdge[];
  nodes?: FlowNode[];
  controlEdges?: ControlEdge[];
  dataBindings?: DataBinding[];
  settings?: FlowSettings;
  workspaces?: string[];
  reflectionEnabled?: boolean;
  advisorScoringMode?: AdvisorScoringMode;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number;
  advisorAutopilotMaxTurns?: number;
  expectedUpdatedAt?: string;
  clientMutationId?: string;
}

export interface ExecutePlaybookData {
  singleStepTaskId?: string;
  query?: string;
  executionMode?: 'live' | 'inherit' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';
  stepExecutionModes?: Record<string, 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive'>;
  runEvaluation?: boolean;
  streaming?: boolean;
  runNodeReflection?: boolean;
  advisorScoringMode?: AdvisorScoringMode;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number;
  advisorAutopilotMaxTurns?: number;
  modelIdOverride?: string;
}

export interface ValidateTaskReplayData {
  executionId: string;
  iteration?: number;
  mode?: 'replay_strict' | 'replay_flex' | 'replay_adaptive' | 'strict_replay';
  preserveOutputFormat?: boolean;
  replayConfig?: {
    replayOutputFormat?: boolean;
    replayToolTrace?: boolean;
    replayReasoningChain?: boolean;
  };
}

export interface UpdateTaskReplayFormatData {
  preserveOutputFormat?: boolean;
  outputFormatGuide?: string;
  replayConfig?: {
    replayOutputFormat?: boolean;
    replayToolTrace?: boolean;
    replayReasoningChain?: boolean;
  };
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
  interruptId?: string;
  action?: InterruptAction;
  message?: string;
  approved?: boolean;
  reason?: string;
  feedback?: string;
  scope?: HitlFeedbackScope;
  remember?: boolean;
  blockerRuleId?: string | null;
  blockerKind?: HitlBlockerKind | string | null;
  reasonCode?: string | null;
  riskLevel?: HitlRiskLevel | string | null;
  downstreamNodeIds?: string[];
}

export interface RerunStepData {
  taskId: string;
  runEvaluation?: boolean;
  executionMode?: 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';
  streaming?: boolean;
  runNodeReflection?: boolean;
  advisorScoringMode?: AdvisorScoringMode;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number;
  advisorAutopilotMaxTurns?: number;
  skipStepExecution?: boolean;
}

export interface ResumeFromStepData {
  taskId: string;
  streaming?: boolean;
  action?: 'reply' | 'approve' | 'reject' | 'skip';
  interruptId?: string;
  iteration?: number;
  message?: string;
  approved?: boolean;
  reason?: string;
  feedback?: string;
  scope?: HitlFeedbackScope;
  remember?: boolean;
  payload?: Record<string, unknown>;
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

export type AdvisorRemediationMode = 'optimize-step' | 'update-current' | 'generate-new';

export interface AdvisorIntentApplyRequest {
  intent: string;
  selectedTaskId?: string;
}

// ===== Store =====

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PortInspection {
  nodeId: string;
  portId: string;
  portName: string;
  portKind: ArtifactKind;
  isInput: boolean;
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
  lastSavedPayloadHashByPlaybookId: Record<string, string>;
  lastSavedRequestBodyByPlaybookId: Record<string, UpdateFlowData>;
  lastAutosaveDurationMs: number | null;
  pendingAutosaveAfterCurrent: boolean;
  autosaveBackoffUntil: number | null;
  lastSaveReason: 'autosave' | 'manual' | 'route-leave' | null;
  currentExecution: PlaybookExecution | null;
  currentExecutionLoading: boolean;
  executionCache: Record<string, PlaybookExecution>;
  executionHistory: PlaybookExecutionSummary[];
  executionHistoryByPlaybook: Record<string, PlaybookExecutionSummary[]>;
  executionsLoading: boolean;
  executingPlaybookIds: string[];
  isGenerating: boolean;
  generateRetryData: GeneratePlaybookData | null;
  selectedStepId: string | null;
  selectedIterationIndex: number;
  pendingRerunTaskId: string | null;
  error: string | null;
  designMessages: DesignMessage[];
  designMessagesLoading: boolean;
  isStopping: boolean;
  isDesigning: boolean;
  designerOpen: boolean;
  copilotMode: PlaybookCopilotMode;
  executionPanelOpen: boolean;
  executionDetailTab: string;
  workspaceExplorerOpen: boolean;
  connectorSidebarOpen: boolean;
  nodeEditorOpen: boolean;
  pageMode: PlaybookPageMode;
  undoStack: PlaybookUndoSnapshot[];
  redoStack: PlaybookUndoSnapshot[];
  perPlaybookUndoHistory: Record<string, { undoStack: PlaybookUndoSnapshot[]; redoStack: PlaybookUndoSnapshot[] }>;
  canvasSyncVersion: number;
  /** Saving automated trigger configuration */
  triggerSaving: boolean;
  triggerError: string | null;
  /** Node templates for canvas toolbar */
  nodeTemplates: TaskTemplate[];
  nodeTemplatesLoading: boolean;
  nodeTemplatesLoadedAt: number;
  evaluationExecutionsByTask: Record<string, PlaybookEvaluationExecution[]>;
  evaluationBaselinesByTask: Record<string, PlaybookEvaluationBaseline | null>;
  repeatability: PlaybookRepeatabilitySummary | null;
  repeatabilityLoading: boolean;
  intentSuggestionHistory: Record<string, IntentSuggestionHistoryEntry[]>;
  /** Flow model fields (Phase 4) */
  flowNodeTemplates: TaskTemplate[];
  flowNodeTemplatesLoading: boolean;
  flowNodeTemplatesLoadedAt: number;
  flowNodeKinds: Array<{ kind: string; label: string }>;
  flowNodeKindsLoading: boolean;
  idempotencyKeyCounters: Record<string, number>;
  portInspection: PortInspection | null;
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
  upsertPlaybookTriggerSchedule: (playbookId: string, data: UpsertPlaybookScheduleData) => Promise<void>;
  clearPlaybookTriggerSchedule: (playbookId: string) => Promise<void>;
  upsertPlaybookTriggerMail: (playbookId: string, data: UpsertPlaybookMailTriggerData) => Promise<void>;
  clearPlaybookTriggerMail: (playbookId: string) => Promise<void>;
  syncPlaybookTriggerMailSubscription: (playbookId: string, data: SyncPlaybookMailSubscriptionData) => Promise<void>;

  // Canvas
  updateTasks: (tasks: PlaybookTask[]) => void;
  updateEdges: (edges: PlaybookEdge[]) => void;
  updateControlEdges: (controlEdges: ControlEdge[]) => void;
  updateDataBindings: (dataBindings: DataBinding[]) => void;
  updateWorkspaces: (workspaces: string[]) => void;
  setDirty: (dirty: boolean) => void;
  setPendingAutosaveAfterCurrent: (pending: boolean) => void;
  saveCurrentPlaybook: (options?: SavePlaybookOptions) => Promise<void>;

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
    skipStepExecution?: boolean,
  ) => Promise<void>;
  runFromStep: (
    playbookId: string,
    executionId: string,
    taskId: string,
    iteration?: number,
  ) => Promise<void>;
  resumeFromStep: (
    playbookId: string,
    executionId: string,
    taskId: string,
    options?: {
      streaming?: boolean;
      action?: 'reply' | 'approve' | 'reject' | 'skip';
      interruptId?: string;
      iteration?: number;
      message?: string;
      approved?: boolean;
      reason?: string;
      feedback?: string;
      scope?: HitlFeedbackScope;
      remember?: boolean;
      payload?: Record<string, unknown>;
    },
  ) => Promise<void>;
  disableHitlBlocker: (executionId: string, interruptId: string) => Promise<void>;
  skipExecutionStep: (playbookId: string, executionId: string, taskId: string) => Promise<void>;
  stopExecution: (playbookId: string, executionId: string) => Promise<void>;
  deleteExecution: (playbookId: string, executionId: string) => Promise<void>;
  deleteStepExecution: (playbookId: string, executionId: string, taskId: string, stepExecutionId: string) => Promise<void>;
  deleteAllExecutions: (playbookId: string) => Promise<void>;
  validateTaskReplay: (
    playbookId: string,
    taskId: string,
    executionId: string,
    options?: { preserveOutputFormat?: boolean; replayConfig?: { replayOutputFormat?: boolean; replayToolTrace?: boolean; replayReasoningChain?: boolean } },
  ) => Promise<ValidatedTaskReplay>;
  updateTaskReplayFormatGuide: (
    playbookId: string,
    taskId: string,
    replayId: string,
    data: UpdateTaskReplayFormatData,
  ) => Promise<ValidatedTaskReplay>;
  fetchTaskReplays: (playbookId: string, taskId: string) => Promise<ValidatedTaskReplay[]>;
  activateTaskReplay: (playbookId: string, taskId: string, replayId: string) => Promise<ValidatedTaskReplay>;
  deleteTaskReplay: (playbookId: string, taskId: string, replayId: string) => Promise<{ removed: boolean; wasActive: boolean }>;
  renameTaskReplay: (playbookId: string, taskId: string, replayId: string, label: string | null) => Promise<ValidatedTaskReplay>;
  traceReplayExecution: (executionId: string) => Promise<any>;
  reExecuteExecution: (executionId: string) => Promise<any>;
  fetchEvaluationExecutions: (playbookId: string, taskId?: string) => Promise<PlaybookEvaluationExecution[]>;
  fetchEvaluationBaseline: (playbookId: string, taskId: string) => Promise<PlaybookEvaluationBaseline | null>;
  createEvaluationBaselineFromExecution: (playbookId: string, taskId: string, executionId: string) => Promise<PlaybookEvaluationBaseline>;
  createEvaluationBaselineFromCurrentExecution: (playbookId: string, taskId: string, executionId: string, evaluationExecutionId: string) => Promise<PlaybookEvaluationBaseline>;
  deleteEvaluationBaseline: (playbookId: string, taskId: string) => Promise<{ removed: boolean }>;
  fetchRepeatability: (playbookId: string, limit?: number, offset?: number) => Promise<PlaybookRepeatabilitySummary>;
  clearRepeatability: () => void;
  grabOutputFormatTemplate: (
    playbookId: string,
    taskId: string,
    data: GrabOutputFormatTemplateData,
  ) => Promise<OutputFormatTemplate>;
  fetchOutputFormatTemplate: (playbookId: string, taskId: string) => Promise<OutputFormatTemplate | null>;
  refreshOutputFormatStatus: (playbookId: string, taskId: string) => Promise<void>;
  updateOutputFormatTemplate: (
    playbookId: string,
    taskId: string,
    data: UpdateOutputFormatTemplateData,
  ) => Promise<OutputFormatTemplate>;
  deleteOutputFormatTemplate: (playbookId: string, taskId: string) => Promise<{ removed: boolean }>;
  runAdvisorEvaluation: (executionId: string, taskId: string, iteration?: number) => Promise<void>;
  fetchAdvisorRemediations: (playbookId: string, executionId: string, taskId?: string) => Promise<AdvisorRemediationItem[]>;
  reapplyOptimization: (playbookId: string, executionId: string, taskId: string, historyIndex: number, direction: 'after' | 'before') => Promise<Playbook>;
  pendingRerunTaskId: string | null;
  setPendingRerunTaskId: (taskId: string | null) => void;

  // SSE handlers
  onExecutionStart: (data: PlaybookExecutionStartEvent) => void;
  onStepStart: (data: PlaybookStepStartEvent) => void;
  onStepUpdate: (data: PlaybookStepUpdateEvent) => void;
  onStepComplete: (data: PlaybookStepCompleteEvent) => void;
  onIteratorChildStepStart: (data: PlaybookIteratorChildStepStartEvent) => void;
  onIteratorChildStepUpdate: (data: PlaybookIteratorChildStepUpdateEvent) => void;
  onIteratorChildStepComplete: (data: PlaybookIteratorChildStepCompleteEvent) => void;
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
  selectStep: (taskId: string | null, iterationIndex?: number) => void;
  setPageMode: (mode: PlaybookPageMode) => void;

  // Designer
  fetchDesignMessages: (playbookId: string) => Promise<void>;
  designPlaybook: (playbookId: string, data: DesignPlaybookData) => Promise<void>;
  requestPlaybookIntent: (playbookId: string, data: RequestPlaybookIntentData) => Promise<PlaybookIntentResponse>;
  revertToSnapshot: (playbookId: string, messageId: string) => Promise<void>;
  setDesignerOpen: (open: boolean) => void;
  setCopilotMode: (mode: PlaybookCopilotMode) => void;
  setExecutionPanelOpen: (open: boolean) => void;
  setExecutionDetailTab: (tab: string) => void;
  openExecutionDetailTab: (tab: string, taskId?: string) => void;
  viewExecutionInPanel: (executionId: string) => void;

  // Node Editor
  nodeEditorOpen: boolean;
  setNodeEditorOpen: (open: boolean) => void;

  // Workspace Explorer
  setWorkspaceExplorerOpen: (open: boolean) => void;
  addInputFileToTask: (taskId: string, inputFile: InputFile) => void;
  removeInputFileFromTask: (taskId: string, inputFileId: string) => void;
  bindResourceToInputPort: (taskId: string, portId: string, resource: PlaybookResourceReference) => void;
  removeResourceBinding: (taskId: string, portId: string) => void;

  // Node Templates
  fetchNodeTemplates: () => Promise<void>;
  invalidateNodeTemplates: () => void;

  // Connector Bindings
  connectorSidebarOpen: boolean;
  setConnectorSidebarOpen: (open: boolean) => void;
  addToolBindingToTask: (taskId: string, binding: ToolBinding) => void;
  removeToolBindingFromTask: (taskId: string, bindingId: string) => void;

  // Cleanup
  reset: () => void;

  // Undo/Redo
  captureSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  clearUndoHistory: () => void;

  // Intent Suggestion History
  addIntentSuggestionHistoryEntry: (playbookId: string, playbookName: string, suggestion: PlaybookIntentSuggestion, intent: string) => void;

  // Flow model actions (Phase 4)
  fetchFlowNodeTemplates: () => Promise<void>;
  fetchFlowNodeKinds: () => Promise<void>;
  invalidateFlowNodeTemplates: () => void;
  generateIdempotencyKey: (flowId: string) => string;

  // Flow evaluation/repeatability/trigger actions (Phase 5)
  fetchFlowEvaluationExecutions: (flowId: string, taskId?: string) => Promise<any>;
  fetchFlowEvaluationBaseline: (flowId: string, taskId: string) => Promise<any>;
  createFlowEvaluationBaseline: (flowId: string, taskId: string, executionId: string, iteration?: number) => Promise<any>;
  createFlowEvaluationBaselineFromCurrentExecution: (flowId: string, taskId: string, executionId: string, evaluationExecutionId: string, iteration?: number) => Promise<any>;
  deleteFlowEvaluationBaseline: (flowId: string, taskId: string) => Promise<void>;
  fetchFlowRepeatability: (flowId: string) => Promise<any>;
  fetchFlowTaskRepeatability: (flowId: string, taskId: string) => Promise<any>;
  fetchFlowTriggers: (flowId: string) => Promise<any>;
  upsertFlowTriggerSchedule: (flowId: string, data: Record<string, unknown>) => Promise<any>;
  upsertFlowTriggerMail: (flowId: string, data: Record<string, unknown>) => Promise<any>;
  syncFlowMailSubscription: (flowId: string, data: Record<string, unknown>) => Promise<any>;

  // Flow CRUD/Execution/Replay/OutputFormat actions (Phase 6c)
  fetchFlow: (id: string) => Promise<any>;
  fetchFlows: (query?: PlaybookQueryParams) => Promise<any>;
  createFlow: (data: any) => Promise<any>;
  updateFlow: (id: string, data: any, idempotencyKey?: string) => Promise<any>;
  deleteFlow: (id: string) => Promise<void>;
  cloneFlow: (id: string) => Promise<any>;
  startFlowExecutionAction: (flowId: string, inputContext?: Record<string, unknown>, idempotencyKey?: string) => Promise<any>;
  fetchFlowExecutions: (flowId: string) => Promise<any>;
  fetchFlowExecution: (executionId: string) => Promise<any>;
  cancelFlowExecutionAction: (executionId: string) => Promise<void>;
  validateFlowTaskReplay: (flowId: string, taskId: string, data: { executionId: string; iteration?: number; preserveOutputFormat?: boolean }) => Promise<any>;
  fetchFlowTaskReplays: (flowId: string, taskId: string) => Promise<any>;
  activateFlowTaskReplay: (flowId: string, taskId: string, replayId: string) => Promise<any>;
  updateFlowTaskReplayFormatGuide: (flowId: string, taskId: string, replayId: string, data: { preserveOutputFormat?: boolean; outputFormatGuide?: string }) => Promise<any>;
  renameFlowTaskReplay: (flowId: string, taskId: string, replayId: string, label: string) => Promise<any>;
  deleteFlowTaskReplay: (flowId: string, taskId: string, replayId: string) => Promise<void>;
  grabFlowOutputFormatTemplate: (flowId: string, taskId: string, data: { executionId: string }) => Promise<any>;
  fetchFlowOutputFormatTemplate: (flowId: string, taskId: string) => Promise<any>;
  updateFlowOutputFormatTemplate: (flowId: string, taskId: string, data: { formatGuide?: string; preserveOutputFormat?: boolean }) => Promise<any>;
  deleteFlowOutputFormatTemplate: (flowId: string, taskId: string) => Promise<void>;
  generateFlow: (data: { name: string; prompt: string; workspaceIds?: string[] }) => Promise<any>;
  designFlow: (id: string, data: { query: string }) => Promise<any>;

  // Port inspection
  openPortInspection: (inspection: PortInspection) => void;
  closePortInspection: () => void;

  // Import/Export
  importPlaybookDefinition: (definition: PlaybookDefinitionExport) => void;
}

export type PlaybookStore = PlaybookState & PlaybookActions;

export type ExpectedResultSource = 'node_field' | 'golden_baseline' | 'none';
export type RepeatabilityMatchState = 'matched' | 'not_matched' | 'not_evaluated';

export interface RepeatabilityTaskExecutionSummary {
  taskId: string;
  taskTitle: string;
  output: string | null;
  completedAt: string | null;
  expectedResult: string | null;
  expectedResultSource: ExpectedResultSource;
  expectedResultType: string | null;
  expectedResultMatched: boolean | null;
  expectedResultReason: string | null;
  matchScore: number | null;
  matchState: RepeatabilityMatchState;
  passed: boolean;
  evaluated: boolean;
  advisorPassed: boolean;
  advisorEvaluated: boolean;
  judgeResult: TaskResult['judgeResult'];
}

export interface RepeatabilityIterationSummary {
  executionId: string;
  executionNumber: number;
  completedAt: string | null;
  taskCount: number;
  evaluatedTasks: number;
  passedTasks: number;
  averageMatchScore: number | null;
  passed: boolean;
  tasks: RepeatabilityTaskExecutionSummary[];
}

export interface PlaybookRepeatabilitySummary {
  playbookId: string;
  totalIterations: number;
  evaluatedIterations: number;
  passedIterations: number;
  overallAverageMatchScore: number | null;
  overallAdvisorScore: number | null;
  generatedAt: string;
  iterations: RepeatabilityIterationSummary[];
}

// ===== Phase 4: Flow Model Types =====

export interface FlowNodePort {
  id: string;
  label?: string;
  type?: string;
  required?: boolean;
}

export interface FlowNodeInput {
  raw?: string;
  ports?: FlowNodePort[];
}

export interface FlowNodeOutput {
  raw?: string;
  ports?: FlowNodePort[];
}

export interface RouterCondition {
  label: string;
  sourceNode?: string;
  sourcePort?: string;
  path?: string;
  operator: RouterConditionOperator;
  value?: unknown;
}

export interface RouterConfig {
  outputLabels: string[];
  maxIterations: number;
  conditions?: RouterCondition[];
  defaultLabel?: string;
}

export interface FlowIteratorConfig {
  collectionPath: string;
  maxItems?: number;
}

export interface HumanApprovalConfig {
  promptTemplate: string;
  timeoutSeconds?: number | null;
}

export interface RetryPolicy {
  maxRetries: number;
  delayMs?: number;
}

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  label?: string;
  taskTemplateId?: string;
  promptTemplateId?: string;
  outputFormatId?: string;
  input?: FlowNodeInput;
  output?: FlowNodeOutput;
  routerConfig?: RouterConfig;
  iteratorConfig?: FlowIteratorConfig;
  humanApprovalConfig?: HumanApprovalConfig;
  retryPolicy?: RetryPolicy;
  hitlPolicy?: HitlPolicy;
  modelId?: string;
  metadata?: Record<string, unknown>;
}

export interface ControlEdge {
  id: string;
  kind: ControlEdgeKind;
  source: string;
  target: string;
  routerLabel?: string;
  sourceOutputPortId?: string;
  targetInputPortId?: string;
  priority?: number;
}

export interface DataBinding {
  id: string;
  targetNode: string;
  targetPort: string;
  sourceKind: DataBindingSourceKind;
  sourceNode?: string;
  sourcePort?: string;
  iteration?: DataBindingIterationRef;
  triggerPath?: string;
  statePath?: string;
  constantValue?: unknown;
  expression?: string;
}

export interface RouterDecision {
  nodeId: string;
  label: string;
  iteration: number;
  createdAt?: string;
}

export interface FlowTriggerConfig {
  kind?: string;
  params?: Record<string, unknown>;
}

export interface FlowSettings {
  recursionLimit: number;
  maxParallelism: number;
}

export interface Flow {
  id: string;
  ownerId: string;
  schemaVersion: number;
  name: string;
  description?: string;
  triggerConfig?: FlowTriggerConfig;
  settings: FlowSettings;
  hitlPolicy?: HitlPolicy;
  hitlBlockers?: HitlBlockerRule[];
  nodes: FlowNode[];
  controlEdges: ControlEdge[];
  dataBindings: DataBinding[];
  workspaces: string[];
  designSettings?: Record<string, unknown>;
  reflectionEnabled?: boolean;
  advisorScoringMode?: AdvisorScoringMode;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number | null;
  advisorAutopilotMaxTurns?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FlowSummary {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  scheduleEnabled: boolean;
  executionStatus?: ExecutionStatus | null;
  lastExecutionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFlowData {
  name: string;
  description?: string;
  triggerConfig?: FlowTriggerConfig;
  settings?: Partial<FlowSettings>;
  hitlPolicy?: HitlPolicy;
  hitlBlockers?: HitlBlockerRule[];
  nodes?: FlowNode[];
  controlEdges?: ControlEdge[];
  dataBindings?: DataBinding[];
}

export interface UpdateFlowData {
  name?: string;
  description?: string;
  triggerConfig?: FlowTriggerConfig;
  settings?: Partial<FlowSettings>;
  hitlPolicy?: HitlPolicy;
  hitlBlockers?: HitlBlockerRule[];
  nodes?: FlowNode[];
  controlEdges?: ControlEdge[];
  dataBindings?: DataBinding[];
  workspaces?: string[];
  designSettings?: Record<string, unknown>;
  reflectionEnabled?: boolean;
  advisorScoringMode?: AdvisorScoringMode;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number;
  advisorAutopilotMaxTurns?: number;
  expectedUpdatedAt?: string;
  clientMutationId?: string;
}

export interface PlaybookDeltaNodePositionUpdate {
  id: string;
  positionX: number;
  positionY: number;
}

export interface PlaybookDeltaNodePatch {
  positionUpdates?: PlaybookDeltaNodePositionUpdate[];
  upserts?: FlowNode[];
  deleteIds?: string[];
}

export interface PlaybookDeltaPatchFields {
  name?: string;
  description?: string;
  designSettings?: Record<string, unknown>;
  settings?: Partial<FlowSettings>;
  reflectionEnabled?: boolean;
  advisorScoringMode?: AdvisorScoringMode;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number;
  advisorAutopilotMaxTurns?: number;
  workspaces?: string[];
}

export interface PatchPlaybookFlowDeltaData {
  expectedUpdatedAt: string;
  payloadHash?: string;
  basePayloadHash?: string;
  clientMutationId?: string;
  patch: {
    fields?: PlaybookDeltaPatchFields;
    nodes?: PlaybookDeltaNodePatch;
    controlEdges?: ControlEdge[];
    dataBindings?: DataBinding[];
  };
}

export interface PatchPlaybookFlowDeltaResult {
  id: string;
  updatedAt: string;
  payloadHash?: string;
  applied: true;
  patchSummary: {
    scalarFields: number;
    nodesUpserted: number;
    nodesDeleted: number;
    edgeChanges: number;
    dataBindingChanges: number;
    positionUpdates: number;
  };
}

export interface SavePlaybookOptions {
  expectedUpdatedAt?: string;
  clientMutationId?: string;
  reason?: 'autosave' | 'manual' | 'route-leave';
}

export const PLAYBOOK_DEFINITION_VERSION = 1;

export interface PlaybookDefinitionExport {
  version: typeof PLAYBOOK_DEFINITION_VERSION;
  exportedAt: string;
  name: string;
  description: string;
  tasks: PlaybookTask[];
  edges: PlaybookEdge[];
  nodes?: FlowNode[];
  controlEdges?: ControlEdge[];
  dataBindings?: DataBinding[];
  settings?: FlowSettings;
  designSettings?: PlaybookDesignSettings;
  reflectionEnabled?: boolean;
  advisorScoringMode?: AdvisorScoringMode;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number | null;
  advisorAutopilotMaxTurns?: number | null;
}
