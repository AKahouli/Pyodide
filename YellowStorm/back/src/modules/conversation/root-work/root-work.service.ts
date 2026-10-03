import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BadRequestException, ErrorCode } from '../../exceptions';
import { isCanonicalObjectId } from '@common/postgres/object-id';
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
  ): Promise<RootExecutionRecord | null> {
    if (!TERMINAL_RESULT_STATUSES.includes(status)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, `invalid terminal status ${status}`);
    }
    return this.store.completeExecution(executionId, status, result);
  }

  async markWaiting(executionId: string): Promise<void> {
    return this.store.markWaiting(executionId);
  }

  getExecution(executionId: string): Promise<RootExecutionRecord | null> {
    return this.store.getExecution(executionId);
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
