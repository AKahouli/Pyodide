import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ErrorCode } from '../../exceptions';
import { AgentService } from '../../agent/agent.service';
import { RootDelegateResolverService } from '../../agent/services/root-delegate-resolver.service';
import { stableStringify } from '../../agent/services/agent-execution-snapshot.service';
import { ConversationService } from '../services/conversation.service';
import { resolvedDefinitionsDigest } from '../services/conversation-agent-request.builder';
import { ResolveRootDelegateDto } from '../dto/resolve-root-delegate.dto';
import { SettleRootDelegateDto } from '../dto/settle-root-delegate.dto';
import { RootWorkService } from './root-work.service';
import { scopeCandidateToFrozenCeiling } from './root-capability-ceiling';
import type { RootNativeState } from './root-work.types';
import { producerEvidence } from './root-producer-evidence';
import { WorkspaceShareService } from '../../workspace/workspace-share.service';
import { RunCodeSourceScopeService } from '../../workspace/services/run-code-source-scope.service';
import { RootBackgroundJobStore, RootJobOwner } from '../persistence/postgres/root-background-job.store';

@Injectable()
export class RootDelegateDefinitionService {
  constructor(private readonly work: RootWorkService, private readonly conversations: ConversationService,
    private readonly resolver: RootDelegateResolverService, private readonly agents: AgentService,
    private readonly workspaceShares: WorkspaceShareService, private readonly runCodeSources: RunCodeSourceScopeService,
    private readonly jobs: RootBackgroundJobStore) {}

  async resolve(executionId: string, request: ResolveRootDelegateDto) {
    return this.resolveRequest(executionId, request);
  }

  async resolveOwned(grant: RootJobOwner) {
    const owned = await this.jobs.getOwnedHydration(grant);
    if (owned.child.role !== 'library_worker' || !owned.request.agentId) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Owned job is not a library worker');
    }
    return this.resolveRequest(owned.parent.id, { ...owned.request, agentId: owned.request.agentId }, grant, owned.job.nativeSessionId);
  }

  async prepareBackground(executionId: string, request: ResolveRootDelegateDto) {
    return this.resolveRequest(executionId, request, undefined, undefined, true);
  }

  async resolveFanoutItem(grant: RootJobOwner, executionId: string) {
    if (grant.producerExecutionId !== undefined && grant.producerExecutionId !== executionId) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Fan-out producer binding changed');
    }
    const producer = { ...grant, producerExecutionId: executionId };
    if (!producer.nativeOwner) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Fan-out requires native ownership');
    const owned = await this.jobs.getOwnedFanoutItem(producer, executionId);
    if (owned.role !== 'library_worker' || !owned.request.agentId) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Fan-out item is not a library worker');
    }
    const prepared = await this.resolveRequest(owned.parent.id, { ...owned.request, agentId: owned.request.agentId },
      undefined, owned.job.nativeSessionId, true, producer);
    if (!('registration' in prepared) || !prepared.registration) throw new Error('Fan-out preparation missing');
    const child = await this.jobs.registerOwnedFanoutItem(producer, prepared.registration);
    return { executionId: child.id, definition: prepared.definition,
      scope: { ...child.resultPayload!.nativeState!.scope, expectedFence: String(producer.fence) },
      ...(child.terminalAt ? { result: child.resultPayload } : {}) };
  }

  private async resolveRequest(executionId: string, request: ResolveRootDelegateDto, grant?: RootJobOwner,
    ownedSessionId?: string, prepareOnly = false, fanoutGrant?: RootJobOwner) {
    if (!/^[0-9a-f]{24}$/.test(executionId) || !request.nativeCallId
      || !request.nativeCallBranch.endsWith(`delegate_to_agent@${request.nativeCallId}`)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid native delegation identity');
    }
    const parent = await this.work.getExecution(executionId);
    const state = parent?.resultPayload?.nativeState;
    if (!parent || !state || parent.role !== 'root' || parent.depth !== 0
      || (grant || fanoutGrant ? parent.status === 'cancellation_requested' : !['running', 'waiting'].includes(parent.status)) || !state.capabilityCeiling) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Root execution cannot admit a worker');
    }
    const authorize = async () => {
      const conversation = await this.conversations.getConversationDocument(parent.conversationId);
      if (conversation.isArchived || conversation.isGroup || conversation.createdBy !== state.actorId
        || conversation.rootAgentId !== parent.rootAgentId
        || (conversation.rootWorkEpoch ?? 0) !== parent.conversationEpoch) {
        throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Root delegation authority changed');
      }
      const pool = await this.resolver.resolveForActor(parent.rootAgentId!, state.actorId);
      if (fanoutGrant && (!pool.policy.background.enabled || !pool.policy.fanout.enabled || !pool.policy.fanout.allowBackground)) {
        throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Background fan-out authority changed');
      }
      const frozen = (state.rootContext.catalog as Array<Record<string, unknown>> | undefined)
        ?.find((entry) => entry.agent_id === request.agentId);
      const current = pool.entries.find((entry) => entry.agentId === request.agentId);
      if (!pool.delegationEnabled || pool.rootSnapshotDigest !== state.scope.immutableSnapshotRef
        || !frozen || !current || current.snapshotDigest !== frozen.snapshot_digest
        || current.configurationMode !== frozen.configuration_mode) {
        throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Specialist grant or definition changed');
      }
      return current;
    };
    await authorize();
    const [definition] = await this.agents.buildGrpcAgentsForPlaybook(state.actorId, [request.agentId],
      undefined, ownedSessionId ?? state.sessionId, { conversationId: parent.conversationId, correlationId: request.nativeCallId,
        scopeType: 'conversation', scopeId: parent.conversationId });
    if (!definition || definition.id !== request.agentId) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Specialist definition unavailable');
    }
    // Recheck current grants/configuration after asynchronous hydration.
    const selected = await authorize();
    const candidate = selected.configurationMode === 'root_constrained'
      ? scopeCandidateToFrozenCeiling(definition, state.capabilityCeiling) : definition;
    const childId = createHash('sha256').update(`${executionId}:${request.nativeCallBranch}`).digest('hex').slice(0, 24);
    if (candidate.tools.some((tool) => tool.name === 'run_code')) {
      // File mounts come only from the selected worker's own hydrated documents.
      // Each execution gets a separate writable prefix, including on replay.
      const documents = candidate.brain_context.flatMap((context) => context.workspace_documents ?? [])
        .filter((document) => document.workspace_id && document.filepath)
        .map((document) => ({ workspaceId: document.workspace_id, path: document.filepath }));
      await this.workspaceShares.assertUserHasAccess(state.actorId, [...new Set(documents.map((document) => document.workspaceId))]);
      const sources = await this.runCodeSources.buildSources([], documents);
      candidate.agent_params ??= { params: {} };
      candidate.agent_params.params.run_code_context_json = JSON.stringify({ userId: state.actorId, runId: childId, sources });
      await authorize();
    }
    const requestDigest = createHash('sha256').update(stableStringify({ agentId: request.agentId,
      task: request.task, expectedOutput: request.expectedOutput ?? '', contextRefs: request.contextRefs ?? [] })).digest('hex');
    // Compare with the admitted runtime identity; tools receive the owned
    // background session, whose binding is checked independently by the job.
    const digestCandidate = (grant || fanoutGrant) && candidate.agent_params?.params.session_id !== undefined
      ? { ...candidate, agent_params: { params: { ...candidate.agent_params.params, session_id: state.sessionId } } }
      : candidate;
    const childState: RootNativeState = {
      admittedRequest: { nativeCallId: request.nativeCallId, nativeCallBranch: request.nativeCallBranch,
        agentId: request.agentId, task: request.task, expectedOutput: request.expectedOutput ?? '',
        contextRefs: [...(request.contextRefs ?? [])] },
      actorId: state.actorId, sessionId: state.sessionId, invocationId: state.invocationId, pendingInputs: [],
      scope: { ...state.scope, role: 'library_worker', executionId: childId, parentExecutionId: executionId,
        depth: 1, immutableSnapshotRef: selected.snapshotDigest },
      rootContext: { delegate_request_digest: requestDigest, selected_agent_id: request.agentId,
        source_workspace_ids: [...new Set(candidate.brain_context.map((context) => context.workspace_id).filter(Boolean))] },
      resolvedDefinitionsDigest: resolvedDefinitionsDigest(digestCandidate, []),
    };
    if (grant) {
      const owned = await this.jobs.getOwnedHydration(grant);
      if (owned.child.id !== childId || owned.parent.id !== executionId
        || owned.state.resolvedDefinitionsDigest !== childState.resolvedDefinitionsDigest) {
        throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Owned worker definition changed');
      }
      return { executionId: childId, definition: candidate, scope: { ...owned.state.scope,
        expectedFence: String(owned.job.fence), nativeSessionId: owned.job.nativeSessionId,
        nativeInvocationId: owned.job.nativeInvocationId, deadlineEpochMs: owned.job.deadline.getTime(),
        resumeIntent: owned.job.nativeInvocationId ? 'resume' as const
          : owned.job.startedAt && !grant.nativeOwner ? 'attach' as const : 'start' as const } };
    }
    const registration = { executionId: childId, conversationId: parent.conversationId,
      rootAgentId: parent.rootAgentId, parentExecutionId: executionId, workGroupId: parent.workGroupId,
      role: 'library_worker' as const, depth: 1, attempt: 1, conversationEpoch: parent.conversationEpoch,
      nativeState: childState };
    if (fanoutGrant) {
      const owned = await this.jobs.getOwnedFanoutItem(fanoutGrant, childId);
      if (owned.parent.id !== executionId) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Fan-out parent changed');
    }
    if (prepareOnly) return { executionId: childId, definition: candidate, scope: childState.scope, registration };
    const child = await this.work.registerExecution(registration);
    return { executionId: child.id, definition: candidate, scope: childState.scope,
      ...(child.terminalAt ? { result: child.resultPayload } : {}) };
  }

  async settle(parentId: string, childId: string, request: SettleRootDelegateDto, backgroundOwner?: RootJobOwner) {
    if (request.fullText !== undefined && Buffer.byteLength(request.fullText, 'utf8') > 262144) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Child output exceeds the durable result limit');
    }
    const child = await this.work.getExecution(childId);
    const state = child?.resultPayload?.nativeState;
    if (!child || !state || !['library_worker', 'temporary_worker'].includes(child.role) || child.parentExecutionId !== parentId) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Child lifecycle does not match its root');
    }
    if (request.status === 'waiting') {
      const waiting = backgroundOwner ? await this.work.recordNativeState(childId, state, 'waiting', backgroundOwner)
        : await this.work.recordNativeState(childId, state, 'waiting');
      if (!waiting) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Child waiting admission is stale');
      return waiting.resultPayload;
    }
    if (child.terminalAt) return child.resultPayload;
    const evidence = producerEvidence(child, request.evidence);
    const result = { executionId: child.id, producerAgentId: String(state.rootContext.selected_agent_id),
      producerRole: child.role === 'temporary_worker' ? 'temporary_worker' as const : 'library_worker' as const,
      status: request.status, text: request.text ?? null,
      ...(request.fullText !== undefined ? { fullText: request.fullText } : {}),
      citationRefs: evidence.filter((item) => item.kind === 'citation').map((item) => item.evidenceId),
      artifactRefs: evidence.filter((item) => item.kind === 'artifact').map((item) => item.evidenceId),
      safeError: request.status === 'completed' ? null : 'Specialist outcome could not be confirmed' };
    const settled = backgroundOwner ? await this.work.completeExecution(childId, request.status, result, evidence, backgroundOwner)
      : await this.work.completeExecution(childId, request.status, result, evidence);
    if (!settled) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Child completion is behind the control barrier');
    return settled.resultPayload;
  }
}
