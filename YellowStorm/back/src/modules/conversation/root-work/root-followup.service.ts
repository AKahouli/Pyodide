import { Injectable, Logger } from '@nestjs/common';
import { RootFollowupStore } from '../persistence/postgres/root-followup.store';
import { RootWorkService } from './root-work.service';
import { RootResultService } from './root-result.service';
import { ConversationService } from '../services/conversation.service';
import { ConversationRootResolverService } from './conversation-root-resolver.service';
import { AgentService } from '../../agent/agent.service';
import { executionScopeToWire } from './root-work.types';
import type { RootBackgroundAuthorityDto, RootBackgroundSettlementDto } from '../dto/root-background.dto';

@Injectable()
export class RootFollowupService {
  private readonly logger = new Logger(RootFollowupService.name);
  private reservationCursor?: string;
  private publicationCursor?: string;
  private readonly loggedReservationBlocks = new Map<string, string>();
  private readonly loggedPublicationBlocks = new Map<string, string>();
  constructor(private readonly store: RootFollowupStore, private readonly work: RootWorkService,
    private readonly results: RootResultService, private readonly conversations: ConversationService,
    private readonly resolver: ConversationRootResolverService, private readonly agents: AgentService) {}

  private async authorize(rootId: string, actorId: string) {
    const root = await this.work.getExecution(rootId);
    const state = root?.resultPayload?.nativeState;
    const conversation = root && await this.conversations.getConversationDocument(root.conversationId);
    if (!root || !state?.schedulingSeal || !root.rootAgentId || root.role !== 'root'
      || !['completed', 'failed'].includes(root.status) || state.actorId !== actorId
      || !conversation || conversation.createdBy !== actorId || conversation.isArchived || conversation.isGroup
      || conversation.rootAgentId !== root.rootAgentId || (conversation.rootWorkEpoch ?? 0) !== root.conversationEpoch) {
      throw new Error('Synthesis Root authority changed');
    }
    const pool = await this.resolver.resolveForActor(root.rootAgentId, actorId, root.conversationId, state.rootContext?.governance_revision ?? null);
    if (!pool.policy.background.enabled || pool.rootSnapshotDigest !== state.scope.immutableSnapshotRef) {
      throw new Error('Synthesis pinned Root authority changed');
    }
    for (const member of state.schedulingSeal.resultManifest) {
      await this.results.authorizeSynthesisMember(root.conversationId, member.executionId, actorId);
    }
    const current = await this.conversations.getConversationDocument(root.conversationId);
    if (current.createdBy !== actorId || current.rootAgentId !== root.rootAgentId || current.isArchived || current.isGroup
      || (current.rootWorkEpoch ?? 0) !== root.conversationEpoch) throw new Error('Synthesis audience changed');
    if (conversation.runtimeMode === 'governed') {
      await this.resolver.resolveForActor(root.rootAgentId, actorId, root.conversationId, state.rootContext?.governance_revision ?? null);
    }
    return { root, state };
  }

  async reconcile() {
    await this.store.releaseLegacyWriters();
    const candidates = await this.store.candidates(this.reservationCursor);
    this.reservationCursor = candidates.at(-1)?.id;
    for (const root of candidates) {
      try {
        const actorId = (await this.work.getExecution(root.id))?.resultPayload?.nativeState?.actorId;
        if (!actorId) continue;
        const authorized = await this.authorize(root.id, actorId);
        await this.store.reserve(root.id, actorId, authorized.state.schedulingSeal!.digest);
        this.loggedReservationBlocks.delete(root.id);
      } catch (error) { this.debugOnce(this.loggedReservationBlocks, root.id,
        `Synthesis reservation remains blocked root=${root.id} reason=${(error instanceof Error ? error.message : 'unknown').slice(0, 512)}`); }
    }
    const completed = await this.store.completed(this.publicationCursor);
    this.publicationCursor = completed.at(-1)?.id;
    for (const followup of completed) {
      try {
        const execution = await this.results.authorizeBackgroundExecution(followup.conversationId, followup.id,
          (await this.work.getExecution(followup.id))!.resultPayload!.nativeState!.actorId);
        const state = execution.resultPayload!.nativeState!;
        await this.store.publish(execution.id, state.actorId, state.followup!.manifestDigest);
        this.loggedPublicationBlocks.delete(followup.id);
      } catch (error) { this.debugOnce(this.loggedPublicationBlocks, followup.id,
        `Synthesis publication remains blocked followup=${followup.id} reason=${(error instanceof Error ? error.message : 'unknown').slice(0, 512)}`); }
    }
  }

  private debugOnce(seen: Map<string, string>, key: string, message: string) {
    if (seen.get(key) === message) return;
    if (seen.size >= 1000) seen.clear();
    seen.set(key, message);
    this.logger.debug(message);
  }

  async definition(executionId: string, request: RootBackgroundAuthorityDto) {
    const grant = { executionId, owner: request.owner, fence: request.fence, nativeOwner: request.nativeOwner };
    const owned = await this.store.owned(grant);
    if (owned.job.requestDigest !== request.requestDigest) throw new Error('Synthesis request binding changed');
    await this.authorize(owned.root.id, owned.job.actorId);
    const [definition] = await this.agents.buildGrpcAgentsForPlaybook(owned.job.actorId, [owned.root.rootAgentId!],
      undefined, owned.job.nativeSessionId);
    if (!definition) throw new Error('Synthesis pinned profile unavailable');
    // Native compilation removes effects before installing its fixed read-only result tool.
    const candidate = { ...definition, tools: [], brain_context: [], skills: [], save_memory: false };
    await this.authorize(owned.root.id, owned.job.actorId);
    const current = await this.store.owned(grant);
    return { kind: 'followup' as const, executionId, actorId: current.job.actorId, definition: candidate,
      request: current.state.admittedRequest, rootContext: current.state.rootContext,
      executionScope: executionScopeToWire({ ...current.state.scope, expectedFence: String(current.job.fence),
        nativeInvocationId: current.job.nativeInvocationId, deadlineEpochMs: current.job.deadline.getTime(),
        resumeIntent: current.job.nativeInvocationId ? 'resume' : 'start' }) };
  }

  async authorizeOwned(executionId: string, request: RootBackgroundAuthorityDto) {
    const grant = { executionId, owner: request.owner, fence: request.fence, nativeOwner: request.nativeOwner };
    const owned = await this.store.owned(grant);
    if (owned.job.requestDigest !== request.requestDigest) throw new Error('Synthesis request binding changed');
    await this.authorize(owned.root.id, owned.job.actorId);
    return { ...await this.store.owned(grant), grant };
  }

  async readResult(executionId: string, producerId: string, request: RootBackgroundAuthorityDto & { offset?: number }) {
    const grant = { executionId, owner: request.owner, fence: request.fence, nativeOwner: request.nativeOwner };
    const owned = await this.store.owned(grant);
    if (request.requestDigest !== owned.job.requestDigest) throw new Error('Synthesis request binding changed');
    await this.authorize(owned.root.id, owned.job.actorId);
    const result = await this.store.readResult(grant, producerId, request.offset ?? 0);
    await this.authorize(owned.root.id, owned.job.actorId);
    await this.store.owned(grant);
    return result;
  }

  async settle(executionId: string, request: RootBackgroundSettlementDto) {
    const grant = { executionId, owner: request.owner, fence: request.fence, nativeOwner: request.nativeOwner };
    const owned = await this.store.owned(grant);
    if (owned.job.requestDigest !== request.requestDigest || request.evidence?.length || request.status === 'waiting') {
      throw new Error('Synthesis cannot introduce evidence, tools or approvals');
    }
    await this.authorize(owned.root.id, owned.job.actorId);
    if (request.status === 'completed' && (!owned.job.nativeInvocationId || !owned.job.initialInputEventId
      || typeof request.fullText !== 'string' || Buffer.byteLength(request.fullText) > 262144)) {
      throw new Error('Synthesis output lacks bounded native invocation correlation');
    }
    const result = { executionId, producerAgentId: owned.root.rootAgentId, producerRole: 'followup' as const,
      status: request.status, text: request.text ?? null, fullText: request.fullText,
      citationRefs: [], artifactRefs: [], safeError: request.status === 'completed' ? null : 'Synthesis outcome could not be confirmed' };
    const settled = await this.work.completeExecution(executionId, request.status, result, [], grant);
    if (!settled) throw new Error('Synthesis settlement is behind the control barrier');
    return settled.resultPayload;
  }
}
