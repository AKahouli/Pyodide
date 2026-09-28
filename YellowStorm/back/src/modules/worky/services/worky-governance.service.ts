import { Injectable } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { WorkyStreamRepository } from '../persistence/worky-stream.repository';
import { WorkyGovernanceRepository } from '../persistence/worky-governance.repository';
import type { WorkyGovernancePolicyRecord, WorkyStreamRecord } from '../worky.types';
import { LoggerService } from '../../logger';
import {
  BadRequestException,
  NotFoundException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkyAuditService } from './worky-audit.service';
import { WorkyEventService } from './worky-event.service';
import {
  WORKY_GOVERNANCE_LEVELS,
  type WorkyGovernanceLevel,
} from '../constants/worky.constants';

const LEVEL_RANK: Record<WorkyGovernanceLevel, number> = {
  off: 0,
  notify: 1,
  approval: 2,
  hard_block: 3,
};

export interface IGovernanceResolveResult {
  resolvedLevel: WorkyGovernanceLevel;
  source: 'stream_override' | 'workspace_policy' | 'default';
  allowStreamOwnerOverride: boolean;
  maxOwnerRelaxLevel: WorkyGovernanceLevel;
  category: string;
}

export interface UpsertWorkyGovernancePolicyInput {
  workspaceId: string;
  defaultLevel: WorkyGovernanceLevel;
  categories: Array<{ category: string; level: WorkyGovernanceLevel }>;
  allowStreamOwnerOverride: boolean;
  maxOwnerRelaxLevel: WorkyGovernanceLevel;
}

/**
 * Worky governance policy engine (Part 3, `docs/worky/03_EXECUTION_GOVERNANCE.md`,
 * canonical §5).
 *
 * Resolution order for `(streamId, actionCategory)`:
 *
 *   1. **Stream override** — if `allowStreamOwnerOverride` is true and
 *      the stream is carrying an override `level` that is **at least as
 *      strict as** `maxOwnerRelaxLevel` (canonical §5.3, the "owner
 *      bounded" rule). The LLM can never set `off` via override.
 *   2. **Workspace policy** — the governance policy of the
 *      stream's workspace, indexed by `category`; falls back to
 *      `defaultLevel` for unlisted categories.
 *   3. **Default** — `off` for normal categories; `approval` for the
 *      external / irreversible categories (`external_send`,
 *      `customer_facing_release`, `external_comms`, `budget_overrun`,
 *      `cancel_human_task`).
 *
 * Every resolution (including `off`) writes one audit event.
 */
@Injectable()
export class WorkyGovernanceService {
  constructor(
    private readonly streams: WorkyStreamRepository,
    private readonly policies: WorkyGovernanceRepository,
    private readonly events: WorkyEventService,
    private readonly audit: WorkyAuditService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyGovernanceService.name);
  }

  /**
   * Resolve the level for one (stream, category) pair. The runtime calls
   * this on every gated step. Audits the resolution so even `off` is
   * tracked (canonical §5.3).
   */
  async resolve(
    streamId: string,
    category: string,
    streamOverrideLevel: string | null,
  ): Promise<IGovernanceResolveResult> {
    if (!isObjectId(streamId)) {
      throw new NotFoundException(ErrorCode.WORKY_STREAM_NOT_FOUND, 'Worky stream not found.');
    }
    const stream = await this.streams.findById(streamId);
    if (!stream) {
      throw new NotFoundException(ErrorCode.WORKY_STREAM_NOT_FOUND, 'Worky stream not found.');
    }
    const policy = await this.findPolicy(stream.workspaceId);
    const defaultLevel = this.defaultForCategory(category);
    const categoryRule = (policy?.categories ?? []).find(
      (c) => String(c.category) === category,
    );
    const policyLevel = (categoryRule?.level ?? policy?.defaultLevel ?? defaultLevel) as WorkyGovernanceLevel;

    // Stream override path. The owner can relax a category only to
    // `maxOwnerRelaxLevel` and never to `off`; they can also make it
    // stricter.
    if (
      streamOverrideLevel &&
      WORKY_GOVERNANCE_LEVELS.includes(streamOverrideLevel as WorkyGovernanceLevel) &&
      policy?.allowStreamOwnerOverride
    ) {
      const override = streamOverrideLevel as WorkyGovernanceLevel;
      const ceiling = policy.maxOwnerRelaxLevel as WorkyGovernanceLevel;
      // "off" is forbidden as an override target.
      if (override === 'off') {
        await this.auditRejection(streamId, category, override, 'override_to_off_forbidden');
        throw new BadRequestException(
          ErrorCode.WORKY_GOVERNANCE_LEVEL_REJECTED,
          'Owner override cannot lower a category to off.',
        );
      }
      // The owner may only relax DOWN to the ceiling (lower rank than
      // `ceiling` is allowed; equal rank is also allowed). They may
      // always make it stricter (higher rank).
      if (LEVEL_RANK[override] > LEVEL_RANK[ceiling] && LEVEL_RANK[override] < LEVEL_RANK[policyLevel]) {
        await this.auditRejection(streamId, category, override, 'override_below_ceiling');
        throw new BadRequestException(
          ErrorCode.WORKY_GOVERNANCE_LEVEL_REJECTED,
          `Override '${override}' is below the relax ceiling '${ceiling}'.`,
        );
      }
      const result: IGovernanceResolveResult = {
        resolvedLevel: override,
        source: 'stream_override',
        allowStreamOwnerOverride: true,
        maxOwnerRelaxLevel: ceiling,
        category,
      };
      await this.auditResolution(stream, result);
      return result;
    }

    const result: IGovernanceResolveResult = {
      resolvedLevel: policyLevel,
      source: policy ? 'workspace_policy' : 'default',
      allowStreamOwnerOverride: policy?.allowStreamOwnerOverride ?? true,
      maxOwnerRelaxLevel: (policy?.maxOwnerRelaxLevel ?? 'notify') as WorkyGovernanceLevel,
      category,
    };
    await this.auditResolution(stream, result);
    return result;
  }

  /**
   * Idempotent upsert of a workspace-scoped policy. Used by the admin
   * controller (`/worky/admin/governance-policy`).
   */
  async upsertWorkspacePolicy(
    actorUserId: string,
    input: UpsertWorkyGovernancePolicyInput,
  ): Promise<WorkyGovernancePolicyRecord> {
    if (!isObjectId(input.workspaceId)) {
      throw new BadRequestException(
        ErrorCode.VALIDATION_ERROR,
        'Invalid workspaceId.',
      );
    }
    const categories = input.categories.filter((c) => WORKY_GOVERNANCE_LEVELS.includes(c.level));
    const policy = await this.policies.upsertWorkspacePolicy({
      workspaceId: input.workspaceId,
      defaultLevel: input.defaultLevel,
      categories,
      allowStreamOwnerOverride: input.allowStreamOwnerOverride,
      maxOwnerRelaxLevel: input.maxOwnerRelaxLevel,
    });
    await this.audit.append({
      streamId: input.workspaceId,
      actorUserId,
      action: 'governance.policy.upserted',
      targetType: 'workspace',
      targetId: input.workspaceId,
      details: {
        defaultLevel: input.defaultLevel,
        categories,
        allowStreamOwnerOverride: input.allowStreamOwnerOverride,
        maxOwnerRelaxLevel: input.maxOwnerRelaxLevel,
      },
    });
    return policy;
  }

  async findPolicy(workspaceId: string): Promise<WorkyGovernancePolicyRecord | null> {
    if (!isObjectId(workspaceId)) return null;
    return this.policies.findWorkspacePolicy(workspaceId);
  }

  private defaultForCategory(category: string): WorkyGovernanceLevel {
    const external = new Set([
      'external_send',
      'customer_facing_release',
      'external_comms',
      'budget_overrun',
      'cancel_human_task',
    ]);
    return external.has(category) ? 'approval' : 'off';
  }

  private async auditResolution(
    stream: WorkyStreamRecord,
    result: IGovernanceResolveResult,
  ): Promise<void> {
    await this.audit.append({
      streamId: stream.id,
      actorUserId: null,
      action: 'governance.evaluated',
      targetType: 'stream',
      targetId: stream.id,
      details: {
        category: result.category,
        resolvedLevel: result.resolvedLevel,
        source: result.source,
      },
    });
    this.events.emit(stream.ownerUserId, stream.id, {
      type: 'governance.evaluated',
      emittedAt: Date.now(),
      payload: {
        category: result.category,
        resolvedLevel: result.resolvedLevel,
        source: result.source,
      },
    });
  }

  private async auditRejection(
    streamId: string,
    category: string,
    attempted: string,
    reason: string,
  ): Promise<void> {
    await this.audit.append({
      streamId,
      actorUserId: null,
      action: 'governance.rejected',
      targetType: 'stream',
      targetId: streamId,
      details: { category, attempted, reason },
    });
  }
}
