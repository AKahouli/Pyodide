import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { BadRequestException } from '../../exceptions';

import { AgentRepository } from '../repositories/agent.repository';
import { TeamService } from '../../team/team.service';
import {
  RootExecutionPolicy,
  enrollLegacyRootPolicy,
  newRootExecutionPolicy,
} from '../interfaces/root-execution-policy.interface';
import { RootExecutionPolicyDto } from '../dto/root-execution-policy.dto';

/** Canonical mono-agent type slug — the only eligible root type (plan §4.1). */
export const MONO_AGENT_SLUG = 'mono-agent';

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * Normalizes and validates the root-execution policy and its allowlist
 * selection (WP01). The HTTP boundary validates DTO shape; this service owns
 * the domain rules: only mono-agent records may enroll, section defaults, the
 * legacy temporary-worker opt-out mapping, and allowlist reference checks.
 */
@Injectable()
export class RootPolicyService {
  constructor(
    private readonly agentRepository: AgentRepository,
    @Inject(forwardRef(() => TeamService))
    private readonly teamService: TeamService,
  ) {}

  isEligibleRootType(agentTypeSlug: string): boolean {
    // Same canonicalization as AgentService.canonicalSlug (mono-agent / mono_agent).
    return (agentTypeSlug || '').toLowerCase().replace(/[-_\s]+/g, '_') === 'mono_agent';
  }

  requireEligibleRootType(agentTypeSlug: string): void {
    if (!this.isEligibleRootType(agentTypeSlug)) {
      throw new BadRequestException('rootExecutionPolicy is only allowed on mono-agent (root) agents');
    }
  }

  /**
   * Merge a policy payload over the section defaults. `existing` carries the
   * stored policy for partial updates. `isNewRoot=false` with no existing
   * policy is an enrollment: the legacy temporary-child flag is preserved
   * (A25 — an undistinguishable saved opt-out stays an opt-out).
   */
  normalizePolicy(
    dto: RootExecutionPolicyDto | null,
    opts: { isNewRoot: boolean; legacyTemporaryChildEnabled: boolean; existing?: RootExecutionPolicy | null },
  ): RootExecutionPolicy | null {
    if (dto === null) return null; // explicit unenroll
    const base = opts.isNewRoot
      ? newRootExecutionPolicy()
      : opts.existing ?? enrollLegacyRootPolicy(opts.legacyTemporaryChildEnabled);
    const overrides = this.normalizeModeOverrides(dto.perAgentModeOverrides);
    return {
      version: 1,
      delegation: { ...base.delegation, ...stripUndefined(dto.delegation) },
      temporaryWorkers: { ...base.temporaryWorkers, ...stripUndefined(dto.temporaryWorkers) },
      fanout: { ...base.fanout, ...stripUndefined(dto.fanout) },
      background: { ...base.background, ...stripUndefined(dto.background) },
      limits: { ...base.limits, ...stripUndefined(dto.limits), maxDepth: 1 },
      // Omit when empty so the stored/compared shape matches the defaults.
      ...(overrides.length ? { perAgentModeOverrides: overrides } : {}),
    };
  }

  /**
   * Existence/activity/self checks for the raw allowlist selection. Deeper
   * authorization (Team grants, governed scope, human/other-root exclusion)
   * is the resolver's job (WP02); here the stored selection must at least
   * point at real, active records.
   */
  async validateAllowlist(rootAgentId: string, delegateAgentIds: string[], delegateTeamIds: string[]): Promise<void> {
    const agentIds = dedupe(delegateAgentIds.map((id) => (id || '').trim()).filter(Boolean));
    if (agentIds.some((id) => !OBJECT_ID_RE.test(id))) {
      throw new BadRequestException('delegateAgentIds contains a malformed agent id');
    }
    if (agentIds.includes(rootAgentId)) {
      throw new BadRequestException('a root cannot delegate to itself');
    }
    if (agentIds.length) {
      const found = await this.agentRepository.findByIds(agentIds, { activeOnly: true });
      const foundIds = new Set(found.map((a) => a._id));
      const missing = agentIds.filter((id) => !foundIds.has(id));
      if (missing.length) {
        throw new BadRequestException(`delegateAgentIds not found or inactive: ${missing.join(', ')}`);
      }
    }
    const teamIds = dedupe(delegateTeamIds.map((id) => (id || '').trim()).filter(Boolean));
    if (teamIds.some((id) => !OBJECT_ID_RE.test(id))) {
      throw new BadRequestException('delegateTeamIds contains a malformed team id');
    }
    for (const teamId of teamIds) {
      const team = await this.teamService.findTeamBasicById(teamId);
      if (!team?.isActive) {
        throw new BadRequestException(`delegateTeamIds not found or inactive: ${teamId}`);
      }
    }
  }

  private normalizeModeOverrides(overrides?: { agentId: string; configurationMode: 'native' | 'root_constrained' }[]) {
    if (!overrides?.length) return [];
    const seen = new Set<string>();
    const out: { agentId: string; configurationMode: 'native' | 'root_constrained' }[] = [];
    for (const o of overrides) {
      const id = (o.agentId || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ agentId: id, configurationMode: o.configurationMode });
    }
    return out;
  }
}

function stripUndefined<T extends object>(value?: T): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function dedupe(v: string[]): string[] {
  return [...new Set(v)];
}
