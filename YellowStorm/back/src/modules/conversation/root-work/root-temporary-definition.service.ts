import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ErrorCode } from '../../exceptions';
import { AgentService } from '../../agent/agent.service';
import { RootDelegateResolverService } from '../../agent/services/root-delegate-resolver.service';
import { stableStringify } from '../../agent/services/agent-execution-snapshot.service';
import { SemanticModelService } from '../../semantic-model/services/semantic-model.service';
import { ConversationSettingsService } from '../../system/conversation-settings.service';
import { WorkspaceShareService } from '../../workspace/workspace-share.service';
import { RunCodeSourceScopeService } from '../../workspace/services/run-code-source-scope.service';
import { ConversationService } from '../services/conversation.service';
import { resolvedDefinitionsDigest } from '../services/conversation-agent-request.builder';
import { ResolveRootTemporaryDto } from '../dto/resolve-root-temporary.dto';
import { RootWorkService } from './root-work.service';
import { scopeCandidateToFrozenCeiling } from './root-capability-ceiling';
import type { IGrpcCompaction } from '../../agent/interfaces/agent.interface';
import { RootBackgroundJobStore, RootJobOwner } from '../persistence/postgres/root-background-job.store';

@Injectable()
export class RootTemporaryDefinitionService {
  constructor(private readonly work: RootWorkService, private readonly conversations: ConversationService,
    private readonly resolver: RootDelegateResolverService, private readonly agents: AgentService,
    private readonly semanticModels: SemanticModelService, private readonly settings: ConversationSettingsService,
    private readonly workspaceShares: WorkspaceShareService, private readonly runCodeSources: RunCodeSourceScopeService,
    private readonly jobs: RootBackgroundJobStore) {}

  async resolve(parentId: string, request: ResolveRootTemporaryDto) {
    return this.resolveRequest(parentId, request);
  }

  async resolveOwned(grant: RootJobOwner) {
    const owned = await this.jobs.getOwnedHydration(grant);
    if (owned.child.role !== 'temporary_worker') {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Owned job is not a temporary worker');
    }
    return this.resolveRequest(owned.parent.id, owned.request, grant);
  }

  async prepareBackground(parentId: string, request: ResolveRootTemporaryDto) {
    return this.resolveRequest(parentId, request, undefined, true);
  }

  private async resolveRequest(parentId: string, request: ResolveRootTemporaryDto, grant?: RootJobOwner, prepareOnly = false) {
    if (!request.nativeCallId || !request.nativeCallBranch.endsWith(`spawn_temporary_worker@${request.nativeCallId}`)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Temporary worker requires its native branch');
    }
    const parent = await this.work.getExecution(parentId);
    const state = parent?.resultPayload?.nativeState;
    if (!parent || parent.role !== 'root' || parent.depth !== 0 || !state?.requestProfile
      || !state.capabilityCeiling || !state.resolvedDefinitionsDigest
      || state.rootContext.temporary_workers_enabled !== true || !parent.rootAgentId) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Temporary worker profile is unavailable');
    }
    const rootId = parent.rootAgentId;
    const authorize = async () => {
      const [conversation, current, pool] = await Promise.all([
        this.conversations.getConversationDocument(parent.conversationId), this.work.getExecution(parentId),
        this.resolver.resolveForActor(rootId, state.actorId),
      ]);
      if (conversation.createdBy !== state.actorId || conversation.rootAgentId !== rootId
        || conversation.isArchived || conversation.isGroup
        || (conversation.rootWorkEpoch ?? 0) !== parent.conversationEpoch
        || !current || (grant ? current.status === 'cancellation_requested' : !['running', 'waiting'].includes(current.status))
        || pool.rootSnapshotDigest !== state.scope.immutableSnapshotRef || !pool.policy.temporaryWorkers.enabled) {
        throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Temporary worker authority changed');
      }
    };
    await authorize();
    const profile = state.requestProfile;
    const compaction = (await this.settings.getSettings()).compaction;
    const grpcCompaction: IGrpcCompaction | undefined = compaction?.enabled ? {
      enabled: true, compaction_interval: compaction.compactionInterval, overlap_size: compaction.overlapSize,
      token_fraction: compaction.tokenFraction, event_retention_size: compaction.eventRetentionSize,
      summarizer_model: compaction.summarizerModel ?? '',
    } : undefined;
    const semanticModel = profile.semanticModelId ? await this.semanticModels.resolveChatModel(state.actorId, profile.semanticModelId) : undefined;
    const [root] = await this.agents.buildAgentsForStream(state.actorId, profile.modelId, [rootId], [], [],
      profile.connectorRepo?.connectorId, semanticModel, { conversationId: parent.conversationId,
        correlationId: request.nativeCallId, playbookHandoffAttached: Boolean(profile.playbookHandoffId) },
      profile.reasoningEffort, grpcCompaction, profile.webConnectorAccessEnabled);
    if (!root || root.id !== rootId || resolvedDefinitionsDigest(root, []) !== state.resolvedDefinitionsDigest) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Frozen ROOT execution profile changed');
    }
    const refs = request.contextRefs ?? [];
    if (refs.some((ref) => !state.capabilityCeiling!.workspaceIds.includes(ref))) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Temporary input reference is not authorized');
    }
    const childId = createHash('sha256').update(`${parentId}:${request.nativeCallBranch}`).digest('hex').slice(0, 24);
    const candidate = scopeCandidateToFrozenCeiling(root, state.capabilityCeiling);
    candidate.id = childId;
    candidate.name = `temporary_${childId}`;
    candidate.save_memory = false;
    candidate.brain_context = candidate.brain_context.filter((context) => !refs.length || refs.includes(context.workspace_id));
    // Memory actions without trusted read/write semantics cannot enter a
    // temporary profile. Remote tool annotations are not classification.
    candidate.connector_bindings = (candidate.connector_bindings ?? []).filter((binding) => binding.connector_slug !== 'smart-memory');
    candidate.connectorIds = candidate.connector_bindings.map((binding) => String(binding.connector_id));
    candidate.tools = candidate.tools.filter((tool) => tool.name !== 'smart-memory');
    candidate.agent_params ??= { params: {} };
    candidate.agent_params.params.connector_bindings_json = JSON.stringify(candidate.connector_bindings);
    candidate.agent_params.params.enable_temporary_child_agents = 'false';
    const workspaceIds = candidate.brain_context.map((context) => context.workspace_id);
    await this.workspaceShares.assertUserHasAccess(state.actorId, workspaceIds);
    if (candidate.tools.some((tool) => tool.name === 'run_code')) {
      candidate.agent_params.params.run_code_context_json = JSON.stringify({ userId: state.actorId, runId: childId,
        sources: await this.runCodeSources.buildSources(workspaceIds, []) });
    }
    await authorize();
    await this.workspaceShares.assertUserHasAccess(state.actorId, workspaceIds);
    const childState = { admittedRequest: { nativeCallId: request.nativeCallId, nativeCallBranch: request.nativeCallBranch,
      task: request.task, expectedOutput: request.expectedOutput ?? '', contextRefs: [...(request.contextRefs ?? [])] },
      actorId: state.actorId, sessionId: state.sessionId, invocationId: state.invocationId,
      pendingInputs: [], scope: { ...state.scope, role: 'temporary_worker' as const, executionId: childId,
        parentExecutionId: parentId, depth: 1 }, rootContext: { selected_agent_id: childId,
        origin_root_agent_id: rootId, source_workspace_ids: workspaceIds,
        delegate_request_digest: createHash('sha256').update(stableStringify({ nativeCallId: request.nativeCallId,
          nativeCallBranch: request.nativeCallBranch, task: request.task,
          expectedOutput: request.expectedOutput ?? '', contextRefs: request.contextRefs ?? [] })).digest('hex') },
      resolvedDefinitionsDigest: resolvedDefinitionsDigest(candidate, []) };
    if (grant) {
      const owned = await this.jobs.getOwnedHydration(grant);
      if (owned.child.id !== childId || owned.parent.id !== parentId
        || owned.state.resolvedDefinitionsDigest !== childState.resolvedDefinitionsDigest) {
        throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Owned temporary definition changed');
      }
      return { executionId: childId, definition: candidate, scope: { ...owned.state.scope,
        expectedFence: String(owned.job.fence), nativeSessionId: owned.job.nativeSessionId,
        nativeInvocationId: owned.job.nativeInvocationId, deadlineEpochMs: owned.job.deadline.getTime(),
        resumeIntent: owned.job.nativeInvocationId ? 'resume' as const
          : owned.job.startedAt && !grant.nativeOwner ? 'attach' as const : 'start' as const } };
    }
    const registration = { executionId: childId, conversationId: parent.conversationId,
      rootAgentId: rootId, parentExecutionId: parentId, workGroupId: parent.workGroupId, role: 'temporary_worker',
      depth: 1, attempt: 1, conversationEpoch: parent.conversationEpoch, nativeState: childState } as const;
    if (prepareOnly) return { executionId: childId, definition: candidate, scope: childState.scope, registration };
    const child = await this.work.registerExecution(registration);
    return { executionId: childId, definition: candidate, scope: childState.scope,
      ...(child.terminalAt ? { result: child.resultPayload } : {}) };
  }
}
