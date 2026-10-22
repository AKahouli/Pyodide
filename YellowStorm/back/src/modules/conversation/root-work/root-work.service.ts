import { parseNativePendingInputs } from './native-pending-inputs';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { McpJwtService, AdkExecutionAuthority } from '@modules/connector/services/mcp-jwt.service';
import { UserService } from '@modules/user/services/user.service';
import { assertAccountApproved } from '@modules/user/utils/assert-account-accessible';
import { UnauthorizedException } from '../../exceptions';
import { CONVERSATION_STORE, ConversationStore } from '../persistence/conversation-store';
import { MessageStore } from '../persistence/message-store';
import { PostgresMessageStore } from '../persistence/postgres/postgres-message-store';
import { RootBackgroundJobStore, RootBackgroundJob } from '../persistence/postgres/root-background-job.store';
import { randomUUID } from 'crypto';
import { BadRequestException, ErrorCode } from '../../exceptions';
import { isCanonicalObjectId } from '@common/postgres/object-id';
import type { RootContinuationRequest } from '../interfaces/message.interface';
import { validateNativeInputResponses } from './native-input-responses';
import { acceptedRootClarifications } from './root-clarifications';
import { verifyEvidenceManifest, type RootEvidenceManifest } from './root-evidence-manifest';
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
  constructor(@Inject(ROOT_WORK_STORE) private readonly store: RootWorkStore,
    @Optional() private readonly authoritySigner?: McpJwtService,
    @Optional() @Inject(CONVERSATION_STORE) private readonly authorityConversations?: ConversationStore,
    @Optional() @Inject(PostgresMessageStore) private readonly authorityMessages?: MessageStore,
    @Optional() private readonly authorityUsers?: UserService,
    @Optional() private readonly authorityJobs?: RootBackgroundJobStore) {}

  async issueForegroundAuthority(executionId: string, actorId: string, conversationId: string,
    messageId: string, leaseId: string): Promise<string> {
    const claims: AdkExecutionAuthority = { purpose: 'root-work', executionId, sub: actorId,
      conversationId, messageId, generation: leaseId };
    await this.assertRootAuthorityBinding(claims);
    return this.authoritySigner!.issueAdkExecutionAuthority(claims);
  }

  async issueNativeConversationAuthority(actorId: string, conversationId: string, messageId: string, leaseId: string): Promise<string> {
    const claims: AdkExecutionAuthority = { purpose: 'native-conversation', executionId: messageId, sub: actorId,
      conversationId, messageId, generation: leaseId };
    await this.assertNativeConversationBinding(claims);
    return this.authoritySigner!.issueAdkExecutionAuthority(claims);
  }

  async issueForegroundChildAuthority(parentToken: string | undefined, childId: string): Promise<string> {
    const parent = await this.assertRootAuthority(parentToken);
    // Only a live foreground ROOT proof can derive an already-admitted child.
    // A child cannot derive siblings, and a scheduler grant is not a stream grant.
    if (!parent.messageId || parent.parentExecutionId || parent.owner || parent.fence !== undefined || childId === parent.executionId) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Foreground parent authority required');
    }
    const claims: AdkExecutionAuthority = { purpose: 'root-work', sub: parent.sub, executionId: childId,
      parentExecutionId: parent.executionId, conversationId: parent.conversationId,
      messageId: parent.messageId, generation: parent.generation };
    await this.assertRootAuthorityBinding(claims);
    return this.authoritySigner!.issueAdkExecutionAuthority(claims);
  }

  /** Public integration seam for native backend routes: actor is signature-bound,
   * and the exact stream lease/account/current conversation access are live reads. */
  async assertNativeConversationAuthority(token: string | undefined): Promise<AdkExecutionAuthority> {
    if (!this.authoritySigner) throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Native authority unavailable');
    const claims = this.authoritySigner.verifyAdkExecutionAuthority(token, 'native-conversation');
    await this.assertNativeConversationBinding(claims);
    return claims;
  }

  async renewNativeConversationAuthority(token: string | undefined): Promise<{ token: string }> {
    return { token: this.authoritySigner!.issueAdkExecutionAuthority(await this.assertNativeConversationAuthority(token)) };
  }

  private async assertNativeConversationBinding(claims: AdkExecutionAuthority): Promise<void> {
    const deny = () => new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Native conversation authority is stale or unavailable');
    if (!this.authoritySigner || !this.authorityConversations || !this.authorityMessages || !this.authorityUsers
      || !claims.messageId || claims.parentExecutionId || claims.executionId !== claims.messageId || !claims.conversationId || claims.owner || claims.fence !== undefined) throw deny();
    const conversation = await this.authorityConversations.findById(claims.conversationId);
    const message = await this.authorityMessages.findById(claims.messageId);
    if (!conversation || conversation.isArchived || !(conversation.createdBy === claims.sub
      || conversation.members.some(member => member.userId === claims.sub)) || !message
      || message.conversationId !== claims.conversationId || message.conversationType !== 'ai'
      || message.isComplete || !message.isStreaming || message.streamExecutionLeaseId !== claims.generation
      || !message.streamExecutionLeaseExpiresAt || message.streamExecutionLeaseExpiresAt.getTime() <= Date.now()) throw deny();
    const user = await this.authorityUsers.findById(claims.sub);
    if (!user) throw deny();
    assertAccountApproved(user);
  }

  async issueBackgroundAuthority(job: RootBackgroundJob): Promise<string> {
    const claims: AdkExecutionAuthority = { purpose: 'root-work', executionId: job.executionId, sub: job.actorId,
      conversationId: job.conversationId, owner: job.owner!, fence: job.fence, generation: `${job.owner}:${job.fence}` };
    await this.assertRootAuthorityBinding(claims);
    return this.authoritySigner!.issueAdkExecutionAuthority(claims);
  }

  async assertRootAuthority(token: string | undefined): Promise<AdkExecutionAuthority> {
    if (!this.authoritySigner) throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Root authority unavailable');
    const claims = this.authoritySigner.verifyAdkExecutionAuthority(token, 'root-work');
    await this.assertRootAuthorityBinding(claims);
    return claims;
  }

  async renewRootAuthority(token: string | undefined): Promise<{ token: string }> {
    return { token: this.authoritySigner!.issueAdkExecutionAuthority(await this.assertRootAuthority(token)) };
  }

  async assertAssetAuthority(token: string | undefined): Promise<AdkExecutionAuthority> {
    if (!this.authoritySigner) throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Native authority unavailable');
    let root: AdkExecutionAuthority;
    try { root = this.authoritySigner.verifyAdkExecutionAuthority(token, 'root-work'); }
    catch { return this.assertNativeConversationAuthority(token); }
    await this.assertRootAuthorityBinding(root);
    return root;
  }

  async assertAuthorityWorkspace(claims: AdkExecutionAuthority, workspaceId: unknown): Promise<void> {
    if (workspaceId === undefined) return;
    const conversation = claims.conversationId && await this.authorityConversations?.findById(claims.conversationId);
    if (!conversation || typeof workspaceId !== 'string') {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Foreign authority workspace');
    }
    const outputWorkspace = [conversation.id, conversation.systemWorkspaceId].includes(workspaceId);
    let allowed = outputWorkspace || conversation.workspaces.includes(workspaceId);
    if (claims.purpose === 'root-work') {
      const execution = await this.store.getExecution(claims.executionId);
      const state = execution?.resultPayload?.nativeState;
      if (!execution || !state || state.actorId !== claims.sub || state.scope.executionId !== claims.executionId) {
        throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Foreign authority workspace');
      }
      if (execution.role === 'library_worker') {
        const parent = execution.parentExecutionId ? await this.store.getExecution(execution.parentExecutionId) : null;
        const root = parent?.resultPayload?.nativeState;
        const selected = (root?.rootContext.catalog as Array<Record<string, unknown>> | undefined)
          ?.find(entry => entry.agent_id === state.rootContext.selected_agent_id);
        const sources = state.rootContext.source_workspace_ids;
        const admitted = Array.isArray(sources) && sources.includes(workspaceId);
        // Native workers retain their own admitted sources; constrained workers
        // additionally remain inside the frozen root capability ceiling.
        allowed = selected?.configuration_mode === 'native' ? allowed || admitted
          : selected?.configuration_mode === 'root_constrained'
            ? outputWorkspace || (allowed || admitted) && !!root?.capabilityCeiling?.workspaceIds.includes(workspaceId)
            : false;
      } else if (execution.role === 'temporary_worker') {
        const parent = execution.parentExecutionId ? await this.store.getExecution(execution.parentExecutionId) : null;
        const root = parent?.resultPayload?.nativeState;
        const sources = state.rootContext.source_workspace_ids;
        allowed = outputWorkspace || Array.isArray(sources) && sources.includes(workspaceId)
          && !!root?.capabilityCeiling?.workspaceIds.includes(workspaceId);
      } else if (execution.role === 'root') {
        allowed ||= !!state.capabilityCeiling?.workspaceIds.includes(workspaceId);
      }
    }
    if (!allowed) throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Foreign authority workspace');
  }

  private async assertRootAuthorityBinding(claims: AdkExecutionAuthority): Promise<void> {
    const deny = () => new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Root execution authority is stale or unavailable');
    if (!this.authoritySigner || !this.authorityConversations || !this.authorityMessages || !this.authorityUsers
      || !claims.conversationId || !claims.generation) throw deny();
    const execution = await this.store.getExecution(claims.executionId);
    const state = execution?.resultPayload?.nativeState;
    const conversation = await this.authorityConversations.findById(claims.conversationId);
    if (!execution || !state || !(execution.status === 'running' || claims.parentExecutionId && execution.status === 'waiting') || execution.terminalAt
      || execution.conversationId !== claims.conversationId || state.actorId !== claims.sub
      || state.scope.executionId !== claims.executionId || !conversation || conversation.createdBy !== claims.sub
      || conversation.isGroup || conversation.isArchived || conversation.rootWorkEpoch !== execution.conversationEpoch
      || conversation.rootAgentId !== execution.rootAgentId) throw deny();
    const user = await this.authorityUsers.findById(claims.sub);
    if (!user) throw deny();
    assertAccountApproved(user);
    if (claims.messageId && !claims.owner && claims.fence === undefined) {
      if (claims.parentExecutionId) {
        const parent = await this.store.getExecution(claims.parentExecutionId);
        const root = parent?.resultPayload?.nativeState;
        if (!parent || !root || parent.role !== 'root' || parent.depth !== 0 || parent.parentExecutionId
          || parent.status !== 'running' || parent.terminalAt || root.actorId !== claims.sub
          || parent.conversationId !== claims.conversationId || parent.conversationEpoch !== execution.conversationEpoch
          || parent.rootAgentId !== execution.rootAgentId || root.scope.executionId !== parent.id
          || execution.parentExecutionId !== parent.id || state.scope.parentExecutionId !== parent.id
          || execution.depth !== 1 || !['library_worker', 'temporary_worker'].includes(execution.role)
          || !this.authorityJobs || await this.authorityJobs.getJob(execution.id)) throw deny();
      } else if (execution.role !== 'root' || execution.depth !== 0 || execution.parentExecutionId) throw deny();
      const message = await this.authorityMessages.findById(claims.messageId);
      if (!message || message.conversationId !== claims.conversationId
        || message.conversationType !== 'ai' || message.isComplete || !message.isStreaming
        || message.streamExecutionLeaseId !== claims.generation || !message.streamExecutionLeaseExpiresAt
        || message.streamExecutionLeaseExpiresAt.getTime() <= Date.now()) throw deny();
    } else if (!claims.messageId && !claims.parentExecutionId && claims.owner && Number.isSafeInteger(claims.fence)) {
      const job = await this.authorityJobs?.getJob(claims.executionId);
      if (!job || job.status !== 'running' || job.owner !== claims.owner || job.fence !== claims.fence
        || claims.generation !== `${job.owner}:${job.fence}` || job.actorId !== claims.sub
        || job.conversationId !== claims.conversationId || job.conversationEpoch !== execution.conversationEpoch
        || job.parentExecutionId !== execution.parentExecutionId || !job.leaseUntil || job.leaseUntil.getTime() <= Date.now()
        || job.deadline.getTime() <= Date.now()) throw deny();
    } else throw deny();
  }

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
    evidenceManifest?: RootEvidenceManifest,
  ): Promise<RootExecutionRecord | null> {
    if (!TERMINAL_RESULT_STATUSES.includes(status)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, `invalid terminal status ${status}`);
    }
    if (evidenceManifest) return this.store.completeExecution(executionId, status, result, evidence, backgroundOwner, evidenceManifest);
    return backgroundOwner ? this.store.completeExecution(executionId, status, result, evidence, backgroundOwner)
      : this.store.completeExecution(executionId, status, result, evidence);
  }

  async markWaiting(executionId: string): Promise<void> {
    return this.store.markWaiting(executionId);
  }

  async stageEvidence(executionId: string, evidence: RegisterEvidenceInput[], owner?: RootBackgroundJobOwnerV1) {
    if (!this.store.stageEvidence) throw new Error('Evidence staging is unavailable');
    await this.store.stageEvidence(executionId, evidence, owner);
  }

  async stagedEvidence(executionId: string, manifest: RootEvidenceManifest): Promise<RegisterEvidenceInput[]> {
    const records = await this.store.listEvidenceForExecution(executionId);
    return verifyEvidenceManifest(records.map(({ id, executionId, conversationId, kind, producerAgentId, payload, dedupKey }) =>
      ({ evidenceId: id, executionId, conversationId, kind, producerAgentId, payload, dedupKey })), manifest);
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
  listWorkerExecutions(conversationId: string, epoch: number) {
    return this.store.listWorkerExecutions(conversationId, epoch);
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
    return { ...state, clarifications: acceptedRootClarifications(state, request.inputResponses) };
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
    if (input.expectedEpoch !== undefined && (!Number.isSafeInteger(input.expectedEpoch) || input.expectedEpoch < 0)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid Root Stop epoch');
    }
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
