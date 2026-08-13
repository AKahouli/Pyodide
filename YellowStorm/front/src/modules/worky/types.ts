/**
 * Worky module type definitions.
 *
 * Mirrors canonical §3.1 + §3.2 + §3.3 + §11.4 (frontend). Wire
 * shapes match the backend's `IWorky*Response` interfaces. Part 2
 * adds the message, board, plan-delta, and interaction types used by
 * the live planning surface.
 */

import type { MessageComponent } from '@/modules/conversation/types';
export type { MessageComponent };

export type WorkyStreamStatus =
  | 'created'
  | 'planning'
  | 'start_requested'
  | 'start_validation_failed'
  | 'active'
  | 'partially_blocked'
  | 'waiting_for_owner'
  | 'waiting_for_human'
  | 'waiting_for_budget_decision'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'archived';

export type WorkyControlState =
  | 'active'
  | 'pause_requested'
  | 'paused'
  | 'resume_requested'
  | 'stop_requested'
  | 'stopped';

export type WorkyBoardLane =
  | 'backlog'
  | 'ready'
  | 'running'
  | 'review'
  | 'blocked'
  | 'failed'
  | 'done';

export type WorkyAssigneeType = 'ephemeral_ai_agent' | 'human_agent' | 'unassigned';

export type WorkyPriority = 'low' | 'medium' | 'high' | 'critical';

export type WorkyActionCategory =
  | 'internal_analysis'
  | 'research'
  | 'drafting'
  | 'internal_artifact_write'
  | 'internal_platform_notification'
  | 'external_send'
  | 'customer_facing_release'
  | 'external_comms'
  | 'budget_overrun'
  | 'cancel_human_task'
  | 'replanning';

export interface WorkyStreamBudget {
  limitUsd: number;
  limitTokens: number;
  spendUsd: number;
  tokensUsed: number;
  enforcement: 'hard_stop' | 'notify';
}

/**
 * Minimal identity for a humain agent resolved by id. Used to render task
 * assignees that are *other users'* humain agents delegated into a stream —
 * they aren't in the current user's own agent roster.
 */
export interface WorkyHumainRef {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface WorkyStream {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  /** Legacy: null for streams created after the workspace/agent removal. */
  artifactWorkspaceId: string | null;
  /** Legacy: null for streams created after the workspace/agent removal. */
  managerAgentId: string | null;
  /**
   * Per-stream Manager model. LiteLLM model identifier
   * (e.g. `gpt-4o-mini`) — the value `LiteLlm(model=...)` expects.
   * `null` = use the admin default.
   */
  managerModelId?: string | null;
  /** Per-stream worker model. Same semantics as `managerModelId`. */
  workerModelId?: string | null;
  governancePolicyRef?: string | null;
  title: string;
  status: WorkyStreamStatus;
  controlState: WorkyControlState;
  schedulerEnabled: boolean;
  currentPlanVersion: number;
  executionPlanVersion?: string | null;
  budget: WorkyStreamBudget;
  startedAt?: string | null;
  completedAt?: string | null;
  activeDurationMinutes: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface WorkyStreamQueryParams {
  search?: string;
}

export interface CreateWorkyStreamData {
  title: string;
  workspaceId?: string;
}

export interface UpdateWorkyStreamData {
  title?: string;
  /**
   * LiteLLM model identifier for the Manager agent. Pass `null`
   * to clear the persistent override and fall back to the admin
   * default. Omit to leave the current value unchanged.
   */
  managerModelId?: string | null;
  /** Same semantics as `managerModelId`, for ephemeral workers. */
  workerModelId?: string | null;
}

/**
 * Body for `POST /worky/streams/{id}/messages`. Per-turn model
 * overrides are forwarded to the backend, which resolves the full
 * chain (override → stream field → admin default) and passes the
 * resolved LiteLLM identifier to the runtime.
 */
export interface SendWorkyMessageData {
  content: string;
  managerModelId?: string;
  workerModelId?: string;
}

// --- Planning surface (Part 2) ---

export type WorkyMessageRole = 'owner' | 'manager' | 'system';

export interface WorkyMessage {
  id: string;
  role: WorkyMessageRole;
  content: string;
  planDeltaRef: string | null;
  createdAt: string;
  /** Manager-message components (Electric message_components). Absent/empty → render plain `content`. */
  components?: MessageComponent[];
}

export interface WorkyTask {
  id: string;
  streamId: string;
  /** plan_steps.step_id (Electric source) — what `dependsOnStepIds` entries refer to. */
  externalId: string | null;
  title: string;
  description: string;
  lane: WorkyBoardLane;
  planningStatus: 'pending' | 'confirmed' | 'rejected';
  executionState: string;
  priority: WorkyPriority;
  assigneeType: WorkyAssigneeType;
  assigneeId: string | null;
  /** Executor sub-agent that handled this task (Electric plan_steps.assignee). Null when unattributed. */
  assigneeKey?: string | null;
  actionCategory: WorkyActionCategory;
  dependsOn: string[];
  /** Parallel wave index (plan_steps.wave via Electric); null outside a plan. */
  wave: number | null;
  /** step_ids this step depends on (plan_steps.depends_on via Electric) — match
   *  against other tasks' `externalId`, not their `id`. */
  dependsOnStepIds: string[];
  blockerReason: string | null;
  /** The step's output / manager answer (plan_steps.result via Electric). */
  result: string | null;
  /** Why the step is blocked (plan_steps.blocked_reason via Electric). */
  blockedReason: string | null;
  theoreticalDeadlineAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export interface WorkyTaskResult {
  id: string;
  taskId: string;
  version: number;
  status: string;
  summary: string;
  payload: Record<string, unknown> | null;
  contentArtifactId: string | null;
  createdByWorkerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkyArtifact {
  id: string;
  filePath: string;
  filename: string;
  artifactKind: string | null;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
}

/** Lazy step-result payload from GET /worky/tasks/:id/result-content. */
export interface WorkyTaskResultContent {
  components: MessageComponent[];
  artifacts: WorkyArtifact[];
}

export interface WorkyBoardResponse {
  streamId: string;
  lanes: Record<WorkyBoardLane, WorkyTask[]>;
  pendingClarifications: WorkyPendingClarification[];
}

export interface WorkyPendingClarification {
  id: string;
  type: string;
  question: string;
  options: string[];
  taskId: string | null;
  blocksTaskIds: string[];
  createdAt?: string;
}

export interface WorkyStartValidationIssue {
  code: string;
  message: string;
  taskIds?: string[];
}

export type WorkyStartOutcome = 'fully_executable' | 'partially_executable' | 'globally_blocked';

export interface WorkyStartValidation {
  outcome: WorkyStartOutcome;
  readyTaskIds: string[];
  blockedTaskIds: string[];
  issues: WorkyStartValidationIssue[];
  snapshotId: string | null;
  executionPlanVersion: number | null;
}

export type WorkyGovernanceLevel = 'off' | 'notify' | 'approval' | 'hard_block';

export interface WorkyGovernancePolicy {
  workspaceId: string;
  scope: 'workspace';
  defaultLevel: WorkyGovernanceLevel;
  categories: Array<{ category: string; level: WorkyGovernanceLevel }>;
  allowStreamOwnerOverride: boolean;
  maxOwnerRelaxLevel: WorkyGovernanceLevel;
}

export interface WorkyPlanDelta {
  planDeltaId: string;
  basePlanVersion: number;
  resultPlanVersion: number;
  createdTaskIds: string[];
  updatedTaskIds: string[];
  cancelledTaskIds: string[];
  clarificationIds: string[];
}

// --- SSE event types (canonical §11.4) ---

export type WorkyEventType =
  | 'stream.updated'
  | 'plan.delta.applied'
  | 'plan.version.created'
  | 'task.updated'
  | 'message.appended'
  | 'message.component.appended'
  | 'task.component.appended'
  | 'task.artifact.appended'
  | 'assistant_token'
  | 'interaction.requested'
  | 'interaction.responded'
  | 'governance.evaluated'
  | 'budget.updated'
  | 'cost.recorded'
  | 'artifact.persisted'
  | 'worker.spawned'
  | 'task.completed'
  | 'stream.started'
  | 'stream.paused'
  | 'stream.resumed'
  | 'stream.stopped'
  | 'stream.terminal'
  | 'human_task.assigned'
  | 'human_task.feedback_submitted'
  | 'human_task.reminder'
  | 'human_task.deadline'
  | 'human_task.completed'
  | 'budget.reserved'
  | 'budget.exhausted'
  | 'budget_decision.requested'
  | 'report.generated'
  | 'memory.proposed'
  | 'memory.confirmed'
  | 'memory.rejected'
  | 'replan.required'
  | 'replan.applied'
  | 'replan.approval_required'
  | 'heartbeat';

export interface WorkyEvent {
  type: WorkyEventType;
  data: Record<string, unknown>;
}

// =================================================================
// Part 4 — budget, reports, memory
// =================================================================

export interface WorkyBudgetSnapshot {
  streamId: string;
  limitUsd: number;
  limitTokens: number;
  spendUsd: number;
  tokensUsed: number;
  enforcement: 'hard_stop' | 'notify';
  remainingUsd: number;
  remainingTokens: number;
  exhausted: boolean;
}

export type WorkyHumanUpdateKind =
  | 'in_progress'
  | 'feedback'
  | 'request_changes'
  | 'blocked'
  | 'done';

export interface WorkyExecutionReport {
  id: string;
  streamId: string;
  type: 'rich' | 'lightweight' | 'summary';
  status: 'generating' | 'ready' | 'failed';
  summary: string;
  markdown: string;
  metadata: Record<string, unknown>;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WorkyMemoryCategory =
  | 'stream_summary'
  | 'preference'
  | 'person'
  | 'decision_history'
  | 'role_clarification';

export interface WorkyMemoryProposal {
  id: string;
  ownerUserId: string;
  sourceStreamId: string | null;
  category: WorkyMemoryCategory;
  title: string;
  content: string;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
}

export interface WorkyMemoryEntry {
  id: string;
  ownerUserId: string;
  category: WorkyMemoryCategory;
  title: string;
  content: string;
  sourceStreamId: string | null;
  sourceProposalId: string | null;
  createdAt: string;
}

export type WorkyWhatsAppIntegrationStatus =
  | 'PAIRING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'FAILED';

export interface WorkyWhatsAppIntegration {
  status: WorkyWhatsAppIntegrationStatus;
  sessionId?: string;
  phoneNumber?: string;
  expectedPairingPhone?: string;
  displayName?: string;
  lastActivityAt?: string;
  errorMessage?: string;
  updatedAt?: string;
}

export interface WorkyWhatsAppConnectResponse {
  sessionId: string;
  status: 'PAIRING';
  qrCode?: string;
  pairingCode?: string;
}

export interface WorkyWhatsAppPairingResponse {
  qrCode?: string;
  pairingCode?: string;
}
