/**
 * Trusted runtime contracts for root delegation (WP03, plan §9.1).
 *
 * These are validated typed objects on the request/stream seams — never
 * model-authored text. The Python mirror lives in
 * yellowstorm-adk/src/root_runtime/contracts.py; the proto encoding lives in
 * conversation/proto/chatbot.proto (ExecutionScope / ExecutionTrace).
 */

export const EXECUTION_ROLES = ['root', 'library_worker', 'temporary_worker', 'fanout_driver', 'followup'] as const;
export type ExecutionRole = (typeof EXECUTION_ROLES)[number];

export const INVOCATION_LIFECYCLE_STATES = [
  'unspecified',
  'started',
  'waiting',
  'completed',
  'cancelled',
  'retryable_interruption',
  'failed',
] as const;
export type InvocationLifecycleState = (typeof INVOCATION_LIFECYCLE_STATES)[number];

export const ROOT_EXECUTION_STATUSES = [
  'running',
  'waiting',
  'completed',
  'cancelled',
  'cancellation_requested',
  'failed',
  'outcome_unknown',
] as const;
export type RootExecutionStatus = (typeof ROOT_EXECUTION_STATUSES)[number];

export const NON_TERMINAL_EXECUTION_STATUSES: readonly RootExecutionStatus[] = [
  'running',
  'waiting',
  'cancellation_requested',
];

/** Request-path scope (proto ExecutionScope). Absent = legacy semantics. */
export interface ExecutionScopeV1 {
  role: ExecutionRole;
  executionId: string;
  parentExecutionId: string | null;
  workGroupId: string | null;
  depth: number;
  attempt: number;
  /** Root-work epoch this execution was admitted under. */
  conversationEpoch: number;
  /** Control fence; the ADK side rejects a request whose fence is stale. */
  expectedFence: string | null;
  resumeIntent: 'start' | 'resume' | 'attach';
  /** Digest of the frozen worker definition (immutable snapshot). */
  immutableSnapshotRef: string | null;
  nativeInvocationId: string | null;
  nativeSessionId: string | null;
  /** Wall-clock deadline (epoch ms); trusted code only. */
  deadlineEpochMs: number | null;
}

/** Bounded context packet handed to a child (plan §6.5). */
export interface ContextPacketV1 {
  task: string;
  expectedOutput: string | null;
  rootSummary: string | null;
  /** Evidence/input references the child may read; nothing else. */
  contextRefs: string[];
}

/** Typed result registered before parent synthesis (plan §12.2). */
export interface DelegateResultV1 {
  executionId: string;
  producerAgentId: string | null;
  producerRole: ExecutionRole;
  status: RootExecutionStatus;
  /** Bounded text result; large payloads live behind the references. */
  text: string | null;
  citationRefs: string[];
  artifactRefs: string[];
  safeError: string | null;
}

/** Stream-side lineage stamped onto producer events (proto ExecutionTrace). */
export interface ExecutionEventV1 {
  eventId: string;
  sequence: number;
  workGroupId: string | null;
  executionId: string;
  parentExecutionId: string | null;
  producerAgentId: string | null;
  producerRole: ExecutionRole;
  lifecycle: InvocationLifecycleState;
  /** Origin native event / tool-call ID. */
  sourceEventId: string | null;
}

/** Minimal work-group / execution / evidence identity record (plan §9.1). */
export interface RootExecutionRecord {
  id: string;
  conversationId: string;
  rootAgentId: string | null;
  workGroupId: string | null;
  parentExecutionId: string | null;
  role: ExecutionRole;
  depth: number;
  attempt: number;
  status: RootExecutionStatus;
  conversationEpoch: number;
  stopRequestId: string | null;
  resultPayload: DelegateResultV1 | null;
  createdAt: Date;
  updatedAt: Date;
  terminalAt: Date | null;
}

export interface RootEvidenceRecord {
  id: string;
  executionId: string;
  conversationId: string;
  kind: 'citation' | 'artifact';
  producerAgentId: string | null;
  payload: Record<string, unknown>;
  dedupKey: string;
  createdAt: Date;
}

/** Build the idempotent evidence dedup key (plan §12.2). */
export function evidenceDedupKey(
  executionId: string,
  nativeIdentity: string,
  outputOrdinal: number,
): string {
  return `${executionId}|${nativeIdentity}|${outputOrdinal}`;
}

/** Derive a child request id from the parent execution and native call id. */
export function deriveRequestId(parentExecutionId: string, nativeCallId: string): string {
  return `req_${parentExecutionId}_${nativeCallId}`;
}

/** Proto wire shape of ExecutionScope (snake_case, chatbot.proto). */
export interface ExecutionScopeWire {
  execution_role: number;
  execution_id: string;
  parent_execution_id: string;
  work_group_id: string;
  depth: number;
  attempt: number;
  conversation_epoch: number | null;
  expected_fence: string;
  resume_intent: string;
  immutable_snapshot_ref: string;
  native_invocation_id: string;
  native_session_id: string;
  deadline_epoch_ms: string | null;
}

/** Proto enum values — must match chatbot.proto ExecutionRole. */
export const EXECUTION_ROLE_WIRE: Record<ExecutionRole, number> = {
  root: 1,
  library_worker: 2,
  temporary_worker: 3,
  fanout_driver: 4,
  followup: 5,
};

/** Map the typed scope to the proto wire object (unset fields = legacy defaults). */
export function executionScopeToWire(scope: ExecutionScopeV1): ExecutionScopeWire {
  return {
    execution_role: EXECUTION_ROLE_WIRE[scope.role],
    execution_id: scope.executionId,
    parent_execution_id: scope.parentExecutionId ?? '',
    work_group_id: scope.workGroupId ?? '',
    depth: scope.depth,
    attempt: scope.attempt,
    conversation_epoch: scope.conversationEpoch,
    expected_fence: scope.expectedFence ?? '',
    resume_intent: scope.resumeIntent,
    immutable_snapshot_ref: scope.immutableSnapshotRef ?? '',
    native_invocation_id: scope.nativeInvocationId ?? '',
    native_session_id: scope.nativeSessionId ?? '',
    deadline_epoch_ms: scope.deadlineEpochMs !== null ? String(scope.deadlineEpochMs) : null,
  };
}
