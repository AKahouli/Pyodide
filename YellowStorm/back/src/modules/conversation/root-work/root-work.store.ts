/**
 * Durable store contract for root-work identity records (WP03, plan §9.1/§11).
 * PostgreSQL implementation: persistence/postgres/postgres-root-work.store.ts.
 */

import { RootExecutionRecord, RootEvidenceRecord, RootNativeState, RootBackgroundJobOwnerV1 } from './root-work.types';

/** DI token for the durable root-work store. */
export const ROOT_WORK_STORE = Symbol('ROOT_WORK_STORE');

export interface RegisterExecutionInput {
  executionId: string;
  conversationId: string;
  rootAgentId: string | null;
  workGroupId: string | null;
  parentExecutionId: string | null;
  role: 'root' | 'library_worker' | 'temporary_worker' | 'fanout_driver' | 'followup';
  depth: number;
  attempt: number;
  conversationEpoch: number;
  nativeState?: RootNativeState;
}

export interface RegisterEvidenceInput {
  /** Assigned by the store when a new row is created; reused on replay. */
  evidenceId: string;
  executionId: string;
  conversationId: string;
  kind: 'citation' | 'artifact';
  producerAgentId: string | null;
  payload: Record<string, unknown>;
  dedupKey: string;
}

export interface StopRootWorkInput {
  conversationId: string;
  stopRequestId: string;
}

export interface StopRootWorkResult {
  /** Epoch AFTER the barrier; requests admitted afterwards use this epoch. */
  barrierEpoch: number;
  /** True when this call newly applied the barrier (false = idempotent replay). */
  applied: boolean;
  markedCount: number;
}

export interface RootWorkStore {
  /** Insert the execution row. Idempotent on executionId (returns existing). */
  registerExecution(input: RegisterExecutionInput): Promise<RootExecutionRecord>;

  getExecution(executionId: string): Promise<RootExecutionRecord | null>;
  listWaitingRoots(conversationId: string, epoch: number): Promise<RootExecutionRecord[]>;

  /** Record the typed result + terminal state; no-op when already terminal. */
  completeExecution(
    executionId: string,
    status: 'completed' | 'cancelled' | 'failed' | 'outcome_unknown',
    result: RootExecutionRecord['resultPayload'],
    evidence?: RegisterEvidenceInput[],
    backgroundOwner?: RootBackgroundJobOwnerV1,
  ): Promise<RootExecutionRecord | null>;

  /** Mark waiting (e.g. approval or HITL park). */
  markWaiting(executionId: string): Promise<void>;
  recordNativeState(executionId: string, state: RootNativeState,
    status: 'running' | 'waiting', backgroundOwner?: RootBackgroundJobOwnerV1): Promise<RootExecutionRecord | null>;

  /**
   * Idempotently insert an evidence record. When dedupKey already exists the
   * existing record is returned unchanged (replay-safe identity).
   */
  registerEvidence(input: RegisterEvidenceInput): Promise<RootEvidenceRecord>;

  listEvidenceForExecution(executionId: string): Promise<RootEvidenceRecord[]>;

  /**
   * Stop-all barrier (plan §11.1): under one transaction capture the epoch,
   * increment it, anchor the stop request id and mark all nonterminal
   * executions at or before the captured epoch cancellation-requested. A
   * repeated call with the same stopRequestId is a no-op; an older
   * stopRequestId after a newer one is rejected.
   */
  stopRootWork(input: StopRootWorkInput): Promise<StopRootWorkResult>;
}
