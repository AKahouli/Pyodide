import { createHash } from 'node:crypto';
import type { RootContinuationRequest } from '../interfaces/message.interface';
import type { RootNativeState } from './root-work.types';
import { BadRequestException, ErrorCode } from '../../exceptions';
import { stableStringify } from '../../agent/services/agent-execution-snapshot.service';

export interface RootClarification {
  invocationId: string;
  inputId: string;
  inputVersion: number;
  question: string;
  response: Record<string, unknown>;
  responseDigest: string;
}

/** Called only after actor, epoch, pending-input and schema validation. */
export function acceptedRootClarifications(state: RootNativeState, responses: RootContinuationRequest['inputResponses']): RootClarification[] {
  const additions: RootClarification[] = [];
  for (const input of responses) {
    const pending = state.pendingInputs.find((entry) => entry.inputId === input.inputId)!;
    if (pending.functionName !== 'adk_request_input') continue;
    const responseDigest = createHash('sha256').update(stableStringify(input.response)).digest('hex');
    additions.push({ invocationId: state.invocationId!, inputId: input.inputId, inputVersion: input.inputVersion ?? 1,
      question: pending.message ?? '', response: structuredClone(input.response), responseDigest });
  }
  return mergeRootClarifications(state.clarifications, additions);
}

/** Stale native state updates cannot erase validated user submissions. */
export function mergeRootClarifications(previous: RootClarification[] = [], incoming: RootClarification[] = []): RootClarification[] {
  const entries = [...previous];
  for (const entry of incoming) {
    const existing = entries.find((value) => value.invocationId === entry.invocationId
      && value.inputId === entry.inputId && value.inputVersion === entry.inputVersion);
    if (existing) {
      if (existing.responseDigest !== entry.responseDigest || stableStringify(existing.response) !== stableStringify(entry.response)) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Clarification response conflicts');
      }
    } else entries.push(entry);
  }
  if (entries.length > 64 || Buffer.byteLength(JSON.stringify(entries)) > 262144) {
    throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Clarification context limit exceeded');
  }
  return entries;
}
