import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '../../postgres/postgres.constants';
import * as schema from '../../postgres/schema';
import { BadRequestException, ConflictException, ErrorCode } from '../../exceptions';
import { RootDelegateResolverService } from '../../agent/services/root-delegate-resolver.service';
import { WorkspaceShareService } from '../../workspace/workspace-share.service';
import { ConversationService } from '../services/conversation.service';
import { RootWorkService } from './root-work.service';
import { RootFanoutProposalDto } from '../dto/root-fanout-proposal.dto';
import { reserveFanoutManifest } from '../persistence/postgres/root-fanout-reservation';
import { buildFanoutManifest, FanoutManifestV1 } from './root-fanout-manifest';
import { updateWorkerPermit } from '../persistence/postgres/root-worker-permits';
import { RootWorkerPermitDto } from '../dto/root-worker-permit.dto';

@Injectable()
export class RootFanoutService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly work: RootWorkService, private readonly conversations: ConversationService,
    private readonly resolver: RootDelegateResolverService, private readonly workspaceShares: WorkspaceShareService) {}

  async permit(parentId: string, childId: string, request: RootWorkerPermitDto) {
    if (request.operation === 'release') {
      return { acquired: await updateWorkerPermit(this.db, parentId, childId, request.owner, 'release') };
    }
    const [parent, child] = await Promise.all([this.work.getExecution(parentId), this.work.getExecution(childId)]);
    const state = parent?.resultPayload?.nativeState;
    const childState = child?.resultPayload?.nativeState;
    if (!parent || !state || parent.role !== 'root' || !parent.rootAgentId || !['running', 'waiting'].includes(parent.status)
      || !child || !childState || child.parentExecutionId !== parentId || !['running', 'waiting'].includes(child.status)) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Worker permit authority unavailable');
    }
    const authorize = async () => {
      const [conversation, pool] = await Promise.all([
        this.conversations.getConversationDocument(parent.conversationId), this.resolver.resolveForActor(parent.rootAgentId!, state.actorId),
      ]);
      const targetAllowed = child.role === 'temporary_worker' ? pool.policy.temporaryWorkers.enabled
        && childState.scope.immutableSnapshotRef === state.scope.immutableSnapshotRef
        : child.role === 'library_worker' && pool.delegationEnabled && pool.entries.some((entry) =>
          entry.agentId === childState.rootContext.selected_agent_id && entry.snapshotDigest === childState.scope.immutableSnapshotRef);
      if (!targetAllowed || conversation.createdBy !== state.actorId || conversation.rootAgentId !== parent.rootAgentId
        || conversation.isArchived || conversation.isGroup || (conversation.rootWorkEpoch ?? 0) !== parent.conversationEpoch
        || pool.rootSnapshotDigest !== state.scope.immutableSnapshotRef) {
        throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Worker permit authority changed');
      }
    };
    await authorize();
    const sources = childState.rootContext.source_workspace_ids;
    if (!Array.isArray(sources) || sources.some((id) => typeof id !== 'string')) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Worker source proof unavailable');
    }
    await this.workspaceShares.assertUserHasAccess(state.actorId, sources);
    await authorize();
    return { acquired: await updateWorkerPermit(this.db, parentId, childId, request.owner, 'acquire') };
  }

  async reserve(parentId: string, proposal: RootFanoutProposalDto) {
    const parent = await this.work.getExecution(parentId);
    const state = parent?.resultPayload?.nativeState;
    if (!parent || parent.role !== 'root' || parent.depth !== 0 || !parent.rootAgentId || !state?.capabilityCeiling) {
      throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Fan-out ROOT profile unavailable');
    }
    let validated: FanoutManifestV1;
    try {
      validated = buildFanoutManifest(parentId, proposal, Number(state.rootContext.max_fanout_items), state.capabilityCeiling.workspaceIds);
    } catch (error) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, (error as Error).message);
    }
    const authorize = async () => {
      const [conversation, pool] = await Promise.all([
        this.conversations.getConversationDocument(parent.conversationId),
        this.resolver.resolveForActor(parent.rootAgentId!, state.actorId),
      ]);
      if (conversation.createdBy !== state.actorId || conversation.rootAgentId !== parent.rootAgentId
        || conversation.isArchived || conversation.isGroup || (conversation.rootWorkEpoch ?? 0) !== parent.conversationEpoch
        || pool.rootSnapshotDigest !== state.scope.immutableSnapshotRef || !pool.policy.fanout.enabled) {
        throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Fan-out ROOT authority changed');
      }
      const target = validated.target;
      if (target.kind === 'library' && (!pool.delegationEnabled
        || !pool.entries.some((entry) => entry.agentId === target.agentId))
        || target.kind === 'temporary' && !pool.policy.temporaryWorkers.enabled) {
        throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Fan-out target authority changed');
      }
      await this.workspaceShares.assertUserHasAccess(state.actorId,
        [...new Set(validated.items.flatMap((item) => item.contextRefs ?? []))]);
    };
    await authorize();
    const manifest = await reserveFanoutManifest(this.db, parentId, proposal);
    // A changed grant during reservation leaves a consumed reservation, never
    // a runnable item. Item hydration must independently reauthorize its target.
    await authorize();
    return manifest;
  }
}
