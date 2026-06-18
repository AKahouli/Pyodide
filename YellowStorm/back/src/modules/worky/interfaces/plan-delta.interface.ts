/**
 * Wire shape for a Plan Delta submitted by the runtime (canonical §6.2
 * `plan-delta` callback). The runtime emits an opaque body that maps to
 * this interface after `class-validator` runs. Persisted as-is on
 * `WorkyPlanDelta.body`; the projection source of truth is the
 * per-task / per-interaction documents.
 */
export type PlanDeltaActionCategory =
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

export type PlanDeltaTaskLane =
  | 'backlog'
  | 'ready'
  | 'running'
  | 'review'
  | 'blocked'
  | 'done';

export type PlanDeltaTaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type PlanDeltaTaskAssigneeType = 'ephemeral_ai_agent' | 'human_agent' | 'unassigned';

/**
 * Explicit owner hint that a task is for a specific human. Part 4 §3.1
 * — the only way to set `assigneeType='human_agent'` is via this hint.
 * The reference is matched against the workspace's user pool; a
 * unique match creates the human task, ambiguous / no-match raises a
 * clarification. Heuristics, role-based defaults, and auto-assignment
 * are explicitly forbidden (canonical §14.2).
 */
export interface IPlanDeltaAssigneeHint {
  kind: 'human';
  /** Display name, email, or slug. The resolver picks the closest match. */
  reference: string;
  /** Optional ISO-8601 deadline; triggers T-6h reminder + deadline escalation. */
  dueAt?: string;
}

export interface IPlanDeltaCreateTask {
  /** Server-generated id; used by the runtime to keep dependency refs stable. */
  clientTaskId?: string;
  title: string;
  description?: string;
  lane: PlanDeltaTaskLane;
  planningStatus?: 'pending' | 'confirmed';
  priority?: PlanDeltaTaskPriority;
  assigneeType?: PlanDeltaTaskAssigneeType;
  /**
   * Explicit human-assignment hint (Part 4 §3.1). Ignored unless
   * `assigneeType === 'human_agent'`. The resolver runs after the
   * task row is created and mutates it (assigneeId, theoreticalDeadlineAt,
   * workspace share, reminders) or rolls back to `unassigned` + raises
   * a clarification.
   */
  assigneeHint?: IPlanDeltaAssigneeHint;
  /** `clientTaskId` values from this delta (preferred) or the stream's existing tasks. */
  dependsOn?: string[];
  requiredTools?: string[];
  actionCategory: PlanDeltaActionCategory;
  acceptanceCriteria?: string[];
  budgetEstimateUsd?: number;
  tokensEstimate?: number;
}

export interface IPlanDeltaUpdateTask {
  taskId: string;
  title?: string;
  description?: string;
  lane?: PlanDeltaTaskLane;
  priority?: PlanDeltaTaskPriority;
  dependsOn?: string[];
  actionCategory?: PlanDeltaActionCategory;
  acceptanceCriteria?: string[];
}

export interface IPlanDeltaCancelTask {
  taskId: string;
  reason?: string;
}

export interface IPlanDeltaClarificationRequest {
  question: string;
  options?: string[];
  /** `clientTaskId` values from this delta; the backend resolves to real ids at apply time. */
  blocksTaskClientIds?: string[];
  /** Optional explicit list of existing taskIds this clarification blocks. */
  blocksTaskIds?: string[];
  type?: 'clarification' | 'assignment_disambiguation';
}

export interface IPlanDeltaBody {
  create_tasks?: IPlanDeltaCreateTask[];
  update_tasks?: IPlanDeltaUpdateTask[];
  cancel_tasks?: IPlanDeltaCancelTask[];
  clarification_requests?: IPlanDeltaClarificationRequest[];
}

/**
 * Result of a successful apply. The runtime re-receives this via the
 * `planning.delta.applied` SSE frame, and the backend uses it to log and
 * to update the projection.
 */
export interface IPlanDeltaApplyResult {
  streamId: string;
  basePlanVersion: number;
  resultPlanVersion: number;
  planDeltaId: string;
  createdTaskIds: string[];
  updatedTaskIds: string[];
  cancelledTaskIds: string[];
  clarificationIds: string[];
}
