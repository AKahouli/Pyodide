import { parseNativePendingInputs } from './native-pending-inputs';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BadRequestException, ErrorCode } from '../../exceptions';
import { isCanonicalObjectId } from '@common/postgres/object-id';
import type { RootContinuationRequest } from '../interfaces/message.interface';
import { validateNativeInputResponses } from './native-input-responses';
import {
  RegisterEvidenceInput,
  RegisterExecutionInput,
  RootWorkStore,
  ROOT_WORK_STORE,
  StopRootWorkInput,
  StopRootWorkResult,
} from './root-work.store';
import {
  DelegateResultV1,
  EXECUTION_ROLES,
  ExecutionRole,
  RootEvidenceRecord,
  RootExecutionRecord,
  RootNativeState,
  RootBackgroundJobOwnerV1,
  isStopRequestId,
  evidenceDedupKey,
} from './root-work.types';

const OBJECT_ID_RE = /^[0-9a-f]{24}$/;
const TERMINAL_RESULT_STATUSES = ['completed', 'cancelled', 'failed', 'outcome_unknown'] as const;
export type TerminalResultStatus = (typeof TERMINAL_RESULT_STATUSES)[number];

function requireObjectId(value: string | null | undefined, field: string): string | null {
  if (value == null || value === '') {
    return null;
  }
  if (!OBJECT_ID_RE.test(value)) {
    throw new BadRequestException(ErrorCode.VALIDATION_ERROR, `${field} must be a 24-char hex id`);
  }
  return value;
}

/**
 * Trusted facade over the root-work store (WP03). Callers are backend runtime
 * code only — there is intentionally no HTTP surface here yet; WP04/WP08 wire
 * delegation registration and the Stop-all controller onto this service.
 */
@Injectable()
export class RootWorkService {
  constructor(@Inject(ROOT_WORK_STORE) private readonly store: RootWorkStore) {}

  async registerExecution(input: RegisterExecutionInput): Promise<RootExecutionRecord> {
    if (!OBJECT_ID_RE.test(input.executionId)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'executionId must be a 24-char hex id');
    }
    if (!OBJECT_ID_RE.test(input.conversationId)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'conversationId must be a 24-char hex id');
    }
    if (!EXECUTION_ROLES.includes(input.role)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, `unknown execution role ${input.role}`);
    }
    if (input.depth < 0 || input.attempt < 1) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'depth must be >= 0 and attempt >= 1');
    }
    return this.store.registerExecution({
      ...input,
      rootAgentId: requireObjectId(input.rootAgentId, 'rootAgentId'),
      workGroupId: requireObjectId(input.workGroupId, 'workGroupId'),
      parentExecutionId: requireObjectId(input.parentExecutionId, 'parentExecutionId'),
    });
  }

  async completeExecution(
    executionId: string,
    status: TerminalResultStatus,
    result: DelegateResultV1 | null,
    evidence: RegisterEvidenceInput[] = [],
    backgroundOwner?: RootBackgroundJobOwnerV1,
  ): Promise<RootExecutionRecord | null> {
    if (!TERMINAL_RESULT_STATUSES.includes(status)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, `invalid terminal status ${status}`);
    }
    return backgroundOwner ? this.store.completeExecution(executionId, status, result, evidence, backgroundOwner)
      : this.store.completeExecution(executionId, status, result, evidence);
  }

  async markWaiting(executionId: string): Promise<void> {
    return this.store.markWaiting(executionId);
  }

  recordNativeState(executionId: string, state: RootNativeState, status: 'running' | 'waiting', backgroundOwner?: RootBackgroundJobOwnerV1) {
    return backgroundOwner ? this.store.recordNativeState(executionId, state, status, backgroundOwner)
      : this.store.recordNativeState(executionId, state, status);
  }

  async applyNativeTrace(executionId: string, conversationId: string, actorId: string,
    trace: Record<string, unknown>): Promise<void> {
    const execution = await this.store.getExecution(executionId);
    const previous = execution?.resultPayload?.nativeState;
    if (!execution || !previous || execution.conversationId !== conversationId
      || previous.actorId !== actorId || trace.execution_id !== executionId
      || trace.native_session_id !== previous.sessionId
      || trace.producer_role !== 'EXECUTION_ROLE_ROOT') {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Native trace does not match its execution');
    }
    const invocationId = trace.native_invocation_id || previous.invocationId;
    const bootstrapCancellation = !invocationId && trace.lifecycle === 'INVOCATION_LIFECYCLE_STATE_CANCELLED';
    if ((!bootstrapCancellation && (typeof invocationId !== 'string' || !invocationId))
      || previous.invocationId && previous.invocationId !== invocationId) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid native invocation identity');
    }
    const pendingInputs = parseNativePendingInputs(trace.pending_inputs);
    const lifecycle = trace.lifecycle;
    if (!['INVOCATION_LIFECYCLE_STATE_STARTED', 'INVOCATION_LIFECYCLE_STATE_WAITING',
      'INVOCATION_LIFECYCLE_STATE_COMPLETED', 'INVOCATION_LIFECYCLE_STATE_CANCELLED',
      'INVOCATION_LIFECYCLE_STATE_FAILED'].includes(String(lifecycle))) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid native lifecycle');
    }
    const waiting = lifecycle === 'INVOCATION_LIFECYCLE_STATE_WAITING';
    if (lifecycle === 'INVOCATION_LIFECYCLE_STATE_CANCELLED') {
      // Stop has already advanced the epoch; its cancellation acknowledgement
      // must settle cancellation_requested without admitting new work.
      await this.store.completeExecution(executionId, 'cancelled', null);
      return;
    }
    const state = { ...previous, invocationId: invocationId as string | null, pendingInputs };
    const recorded = await this.store.recordNativeState(executionId, state, waiting ? 'waiting' : 'running');
    if (!recorded) return; // Stop or a terminal transition won the epoch fence.
    const terminal = {
      INVOCATION_LIFECYCLE_STATE_COMPLETED: 'completed',
      INVOCATION_LIFECYCLE_STATE_CANCELLED: 'cancelled',
      INVOCATION_LIFECYCLE_STATE_FAILED: 'failed',
    } as const;
    const status = terminal[String(lifecycle) as keyof typeof terminal];
    if (status) await this.store.completeExecution(executionId, status, null);
  }

  getExecution(executionId: string): Promise<RootExecutionRecord | null> {
    return this.store.getExecution(executionId);
  }

  listWaitingRoots(conversationId: string, epoch: number) {
    return this.store.listWaitingRoots(conversationId, epoch);
  }

  async validateContinuation(request: RootContinuationRequest, actorId: string,
    conversationId: string, epoch: number): Promise<RootNativeState> {
    const execution = await this.store.getExecution(request.executionId);
    const state = execution?.resultPayload?.nativeState;
    if (!execution || !state || execution.role !== 'root' || execution.status !== 'waiting'
      || execution.conversationId !== conversationId || state.actorId !== actorId
      || execution.conversationEpoch !== epoch || !state.invocationId || !state.requestProfile
      || !state.scope.immutableSnapshotRef) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'This root invocation cannot be continued');
    }
    validateNativeInputResponses(state.pendingInputs, request.inputResponses);
    return state;
  }

  /**
   * Idempotent evidence registration (plan §12.2): a replayed registration
   * with the same (execution, native identity, ordinal) returns the original
   * record and never replaces a valid evidence id.
   */
  async registerEvidence(
    input: Omit<RegisterEvidenceInput, 'evidenceId' | 'dedupKey'> & {
      nativeIdentity: string;
      outputOrdinal: number;
    },
  ): Promise<RootEvidenceRecord> {
    if (input.kind !== 'citation' && input.kind !== 'artifact') {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, `unknown evidence kind ${input.kind}`);
    }
    return this.store.registerEvidence({
      ...input,
      evidenceId: randomUUID().replaceAll('-', '').slice(0, 24),
      dedupKey: evidenceDedupKey(input.executionId, input.nativeIdentity, input.outputOrdinal),
    });
  }

  listEvidenceForExecution(executionId: string): Promise<RootEvidenceRecord[]> {
    return this.store.listEvidenceForExecution(executionId);
  }

  async stopRootWork(input: StopRootWorkInput): Promise<StopRootWorkResult> {
    if (!OBJECT_ID_RE.test(input.conversationId)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'conversationId must be a 24-char hex id');
    }
    // Time-ordered ids are what let the store fence a retried old Stop.
    if (!isStopRequestId(input.stopRequestId)) {
      throw new BadRequestException(
        ErrorCode.VALIDATION_ERROR,
        'stopRequestId must be a UUIDv7 (use newStopRequestId())',
      );
    }
    return this.store.stopRootWork(input);
  }
}

/** Role guard used by callers that dispatch worker scopes. */
export function isWorkerRole(role: ExecutionRole): boolean {
  return role === 'library_worker' || role === 'temporary_worker';
}
