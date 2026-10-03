import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { isObjectId } from '@common/postgres/object-id';

import { AgentRepository } from '../repositories/agent.repository';
import { AgentRecord } from '../repositories/agent-record.mapper';
import { AgentShareService } from './agent-share.service';
import { RootPolicyService } from './root-policy.service';
import { RootConfigurationMode, RootExecutionPolicy } from '../interfaces/root-execution-policy.interface';
import { TeamService } from '../../team/team.service';

/** Upper bound on the effective catalog — matches ROOT_POLICY_CEILINGS-scale budgets. */
const MAX_POOL_ENTRIES = 64;

/**
 * Agent types excluded from acting as workers in this release (plan §6.1),
 * compared with the repo's canonical slug form (mono_agent / mono-agent).
 */
const INELIGIBLE_WORKER_TYPE_SLUGS = new Set(['mono_agent', 'humain']);

function canonicalSlug(value: string): string {
  return (value || '').toLowerCase().replace(/[-_\s]+/g, '_');
}

export interface RootDelegatePoolEntry {
  agentId: string;
  name: string;
  description: string;
  agentTypeSlug: string;
  configurationMode: RootConfigurationMode;
  /** Where the membership came from; a direct entry also lists the teams supplying it. */
  source: { direct: boolean; teamIds: string[] };
}

export interface RootDelegatePool {
  rootAgentId: string;
  delegationEnabled: boolean;
  defaultConfigurationMode: RootConfigurationMode;
  entries: RootDelegatePoolEntry[];
  /** Saved selections that yielded nothing (deleted/inactive/ineligible) — names withheld. */
  unavailableCounts: { agents: number; teams: number };
}

/**
 * Effective delegate pool resolution (WP02, plan §6.1/§6.2): flatten direct ids
 * and accessible Team membership into one bounded catalog with provenance.
 * Membership alone is not authorization — every entry must be visible to the
 * ACTOR (owner, administrator default, or an explicit share grant) through its
 * direct record, or be supplied by a Team the actor may execute through.
 */
@Injectable()
export class RootDelegateResolverService {
  constructor(
    private readonly agentRepository: AgentRepository,
    @Inject(forwardRef(() => AgentShareService))
    private readonly agentShareService: AgentShareService,
    private readonly rootPolicyService: RootPolicyService,
    // TeamService (forwardRef) supplies flattened, access-checked Team membership.
    @Inject(forwardRef(() => TeamService))
    private readonly teamService: TeamService,
  ) {}

  /** Load + authorize + resolve in one call for the editor/runtime. */
  async resolveForActor(rootAgentId: string, actorId: string): Promise<RootDelegatePool> {
    if (!isObjectId(rootAgentId)) throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    const root = await this.agentRepository.findById(rootAgentId);
    if (!root) throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    await this.assertPoolReader(root, actorId);
    return this.resolveEffectivePool(root, actorId);
  }

  async resolveEffectivePool(root: AgentRecord, actorId: string): Promise<RootDelegatePool> {
    const policy = (root.rootExecutionPolicy ?? undefined) as RootExecutionPolicy | undefined;
    const directIds = root.delegateAgentIds ?? [];
    const teamIds = root.delegateTeamIds ?? [];

    const modeFor = (agentId: string): RootConfigurationMode =>
      policy?.perAgentModeOverrides?.find((o) => o.agentId === agentId)?.configurationMode
      ?? policy?.delegation.defaultConfigurationMode
      ?? 'native';

    const entries = new Map<string, RootDelegatePoolEntry>();
    let unavailableAgents = 0;
    let unavailableTeams = 0;

    if (directIds.length) {
      // findByIds is owner-agnostic by design; the visibility grant is checked below.
      const found = await this.agentRepository.findByIds(directIds, { activeOnly: true });
      const byId = new Map(found.map((a) => [a._id, a]));
      for (const id of directIds) {
        const agent = byId.get(id);
        if (!agent || !this.isEligibleWorker(agent) || agent._id === root._id) {
          unavailableAgents += 1;
          continue;
        }
        if (!(await this.actorMayExecute(agent, actorId))) {
          // A saved id the actor lost access to is reported, not silently dropped (A20).
          unavailableAgents += 1;
          continue;
        }
        entries.set(agent._id, {
          agentId: agent._id,
          name: agent.name,
          description: agent.description,
          agentTypeSlug: agent.agentTypeSlug,
          configurationMode: modeFor(agent._id),
          source: { direct: true, teamIds: [] },
        });
      }
    }

    for (const teamId of teamIds) {
      let members: string[] = [];
      try {
        const team = await this.teamService.findUserTeamById(actorId, teamId);
        members = team.members.map((m) => m.agentId);
      } catch {
        unavailableTeams += 1;
        continue;
      }
      if (!members.length) continue;
      const found = await this.agentRepository.findByIds(members, { activeOnly: true });
      for (const agent of found) {
        if (!this.isEligibleWorker(agent) || agent._id === root._id) continue;
        // Team supply carries the grant: findUserTeamById already verified the
        // actor may execute through this team (owner or share).
        const existing = entries.get(agent._id);
        if (existing) {
          if (!existing.source.teamIds.includes(teamId)) existing.source.teamIds.push(teamId);
          continue;
        }
        if (entries.size >= MAX_POOL_ENTRIES) break;
        entries.set(agent._id, {
          agentId: agent._id,
          name: agent.name,
          description: agent.description,
          agentTypeSlug: agent.agentTypeSlug,
          configurationMode: modeFor(agent._id),
          source: { direct: false, teamIds: [teamId] },
        });
      }
    }

    return {
      rootAgentId: root._id,
      delegationEnabled: policy?.delegation.enabled ?? false,
      defaultConfigurationMode: policy?.delegation.defaultConfigurationMode ?? 'native',
      entries: [...entries.values()],
      unavailableCounts: { agents: unavailableAgents, teams: unavailableTeams },
    };
  }

  /** Other root profiles and human-type agents never act as workers (A18). */
  private isEligibleWorker(agent: AgentRecord): boolean {
    return agent.isActive && !INELIGIBLE_WORKER_TYPE_SLUGS.has(canonicalSlug(agent.agentTypeSlug));
  }

  /**
   * Direct execution grant for the actor: owner, administrator default, or an
   * explicit share. Viewing alone never bypasses this (A19).
   */
  private async actorMayExecute(agent: AgentRecord, actorId: string): Promise<boolean> {
    if (agent.createdBy === actorId) return true;
    if (agent.isDefault) return true;
    const permission = await this.agentShareService.getSharePermission(actorId, agent._id);
    return permission === 'read' || permission === 'write';
  }

  /** Controller-level guard: only users who may edit the root read its pool. */
  async assertPoolReader(root: AgentRecord, actorId: string): Promise<void> {
    if (!this.rootPolicyService.isEligibleRootType(root.agentTypeSlug)) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }
    if (root.createdBy !== actorId && !root.isDefault) {
      // Administrator roots are editable library records; personal roots only
      // by their owner (shared write on a root is a WP02+ editor question).
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_FORBIDDEN);
    }
  }
}

