/**
 * Shared standard-run admission state (WP07).
 *
 * Enforces, via shared PostgreSQL state, what process-local maps cannot:
 * per-user and fleet-wide active-run capacity and same-conversation
 * exclusivity across actors and replicas. The partial unique index on
 * (conversation_id) WHERE status='running' is the hard exclusivity
 * guarantee; capacity counters are best-effort gates around it.
 */

export const CONVERSATION_EXECUTION_STORE = Symbol('CONVERSATION_EXECUTION_STORE');

export type ConversationExecutionConflictReason =
  | 'conversation_busy'
  | 'message_already_running';

export interface AdmitExecutionInput {
  executionId: string;
  conversationId: string;
  userId: string;
  messageId: string;
  ownerReplicaId: string | null;
  /** Row expiry: running rows stop counting against capacity after it. */
  expiresAt: Date;
  maxActiveRunsPerUser: number;
  maxActiveRunsFleet: number;
}

export type AdmitExecutionResult =
  | { admitted: true }
  | { admitted: false; reason: 'capacity' | ConversationExecutionConflictReason };

export interface ConversationExecutionStore {
  /**
   * Atomically admit one standard run. Returns a typed conflict reason when
   * the conversation/message is already running, or a capacity rejection
   * when the per-user or fleet budget is exhausted.
   */
  admit(input: AdmitExecutionInput): Promise<AdmitExecutionResult>;

  /** Extend the expiry of the running execution row (heartbeat). */
  extendExpiry(messageId: string, expiresAt: Date): Promise<void>;

  /**
   * True when a stop was requested for this running execution from anywhere
   * in the fleet (cross-replica control intent).
   */
  isCancelRequested(messageId: string): Promise<boolean>;

  /** Record a stop request for a running execution; true when one existed. */
  requestCancel(messageId: string): Promise<boolean>;

  /**
   * Finalize the running execution row from the message's durable
   * execution_status (completed/failed/interrupted/cancelled). Idempotent;
   * no-op when the row is not running.
   */
  finalizeByMessage(messageId: string): Promise<void>;

  /**
   * Finalize running rows whose expiry passed (owner crashed without
   * finalizing). Status is taken from the message's durable state when
   * available, otherwise `interrupted`. Never resurrects or overwrites.
   */
  finalizeExpired(now: Date): Promise<number>;
}
