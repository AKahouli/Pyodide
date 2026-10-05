import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConflictException, ErrorCode } from '@modules/exceptions';
import { AgentRepository } from '@modules/agent/repositories/agent.repository';
import { RootDelegateResolverService } from '@modules/agent/services/root-delegate-resolver.service';
import { AgentExecutionSnapshotService } from '@modules/agent/services/agent-execution-snapshot.service';
import { RootPolicyService } from '@modules/agent/services/root-policy.service';
import type { GovernanceRevisionRecord } from '../persistence';
import { sealRootWork, PublishedRootWorkV1 } from './governance-root-snapshot';

@Injectable()
export class GovernanceRootPublicationService {
  constructor(private readonly agents: AgentRepository, private readonly resolver: RootDelegateResolverService,
    private readonly snapshots: AgentExecutionSnapshotService, private readonly policies: RootPolicyService,
    private readonly config: ConfigService) {}

  async capture(actorId: string, revision: GovernanceRevisionRecord): Promise<PublishedRootWorkV1 | undefined> {
    const root = revision.agentId ? await this.agents.findById(revision.agentId) : null;
    if (!root?.isActive) throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
    // Existing guide deployments remain direct-agent deployments.
    if (!root.rootExecutionPolicy) return undefined;
    if (!this.policies.isEligibleRootType(root.agentTypeSlug)) throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
    const pool = await this.resolver.resolveForActor(root._id, actorId);
    const allowed = new Set(revision.allowedAgentIds);
    if (!allowed.has(root._id)) throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
    return sealRootWork({ version: 1, pool: { ...pool, entries: pool.entries.filter((entry) => allowed.has(entry.agentId)) } },
      revision.id, this.config.get<string>('INTERNAL_SERVICE_SECRET'));
  }

  async assertUnchanged(rootWork: PublishedRootWorkV1 | undefined, revision: GovernanceRevisionRecord, actorId: string): Promise<void> {
    const root = revision.agentId ? await this.agents.findById(revision.agentId) : null;
    if (!root?.isActive || (rootWork ? this.snapshots.computeDigest(root) !== rootWork.pool.rootSnapshotDigest
      : Boolean(root.rootExecutionPolicy))) throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
    if (rootWork) await this.resolver.resolveForActor(root._id, actorId);
  }
}
