import { Inject, Injectable } from '@nestjs/common';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { Permissions } from '@modules/authorization/constants/permissions';
import { USER_LOOKUP_PORT, type UserLookupPort } from '@common/ports/user-lookup.port';
import { UserGroupService } from '@modules/user-group';
import { CreateGovernanceMembershipDto, UpdateGovernanceMembershipDto } from '../dto';
import {
  type GovernanceMembershipRecord,    
} from '../persistence';
import { DuplicateKeyError } from '../persistence/governance-records';
import type { GovernanceMembershipRole } from '../domain/governance-types';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceScopeService } from './governance-scope.service';
import { PgMembershipStore } from '../persistence/postgres/pg-membership.store';
import { PgGroupLookupAdapter } from '../persistence/postgres/pg-group-lookup.adapter';

export interface GovernanceMembershipResponse {
  id: string;
  programId: string;
  scopeId?: string;
  userId?: string;
  groupId?: string;
  invitedBy: string;
  role: GovernanceMembershipRole;
  status: 'invited' | 'active' | 'disabled';
  permissions: string[];
  user?: { id: string; email: string; firstName?: string; lastName?: string };
  group?: { id: string; name: string; memberCount: number };
  createdAt: string;
  updatedAt: string;
}

const rolePermissions: Record<GovernanceMembershipRole, string[]> = {
  program_owner: [Permissions.GOVERNANCE_ALL],
  program_admin: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_PROGRAMS_MANAGE, Permissions.GOVERNANCE_SCOPES_MANAGE, Permissions.GOVERNANCE_DOCUMENTS_EDIT, Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_MEMBERSHIPS_MANAGE, Permissions.GOVERNANCE_DEPLOYMENTS_MANAGE, Permissions.GOVERNANCE_DRY_RUNS_EXECUTE, Permissions.GOVERNANCE_PUBLISH, Permissions.GOVERNANCE_METRICS_READ],
  scope_admin: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_DOCUMENTS_EDIT, Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_MEMBERSHIPS_MANAGE, Permissions.GOVERNANCE_DEPLOYMENTS_MANAGE, Permissions.GOVERNANCE_DRY_RUNS_EXECUTE, Permissions.GOVERNANCE_METRICS_READ],
  scope_approver: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_PUBLISH, Permissions.GOVERNANCE_REVIEWS_MANAGE],
  scope_editor: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_DOCUMENTS_EDIT, Permissions.GOVERNANCE_DRY_RUNS_EXECUTE],
  scope_reviewer: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_DRY_RUNS_EXECUTE, Permissions.GOVERNANCE_REVIEWS_MANAGE],
  scope_viewer: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_METRICS_READ],
};

@Injectable()
export class GovernanceMembershipService {
  constructor(
    private readonly membershipStore: PgMembershipStore,
    @Inject(USER_LOOKUP_PORT) private readonly userLookup: UserLookupPort,
    private readonly groupLookup: PgGroupLookupAdapter,
    private readonly programService: GovernanceProgramService,
    private readonly scopeService: GovernanceScopeService,
    private readonly userGroupService: UserGroupService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(actorId: string, actorEmail: string, programId: string, dto: CreateGovernanceMembershipDto): Promise<GovernanceMembershipResponse> {
    await this.assertProgramAndScope(actorId, programId, dto.scopeId);
    this.assertSingleTarget(dto);
    if (dto.groupId) await this.userGroupService.findById(actorId, dto.groupId);
    const duplicate = await this.membershipStore.findDuplicate(programId, dto.scopeId ?? null, { userId: dto.userId, groupId: dto.groupId });
    if (duplicate) return this.reactivateMembership(actorId, actorEmail, programId, duplicate, dto);
    const { membership, reusedExisting } = await this.createMembershipOrReuseDuplicate(actorId, actorEmail, programId, dto);
    if (!reusedExisting) this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.membership.invited', targetType: 'governance_membership', targetId: membership.id, metadata: { programId, scopeId: dto.scopeId, role: dto.role } });
    return this.toPopulatedResponse(await this.membershipStore.findById(membership.id), membership);
  }

  private async createMembershipOrReuseDuplicate(actorId: string, actorEmail: string, programId: string, dto: CreateGovernanceMembershipDto): Promise<{ membership: GovernanceMembershipRecord; reusedExisting: boolean }> {
    try {
      const membership = await this.membershipStore.insert({
        programId,
        scopeId: dto.scopeId,
        userId: dto.userId,
        groupId: dto.groupId,
        invitedBy: actorId,
        role: dto.role as GovernanceMembershipRole,
        status: dto.status ?? 'active',
        permissions: rolePermissions[dto.role as GovernanceMembershipRole],
      });
      return { membership, reusedExisting: false };
    } catch (error) {
      if (!(error instanceof DuplicateKeyError)) throw error;
      const duplicate = await this.membershipStore.findDuplicate(programId, dto.scopeId ?? null, { userId: dto.userId, groupId: dto.groupId });
      if (!duplicate) throw error;
      const membership = await this.reactivateMembershipDocument(actorId, actorEmail, programId, duplicate, dto);
      return { membership, reusedExisting: true };
    }
  }

  async list(actorId: string, programId: string): Promise<GovernanceMembershipResponse[]> {
    await this.programService.assertOwnedProgram(actorId, programId);
    const isOwner = await this.isProgramOwner(actorId, programId);
    const memberships = isOwner
      ? await this.membershipStore.listByProgram(programId)
      : await this.filterAccessibleMemberships(actorId, programId);
    return this.toPopulatedResponses(memberships);
  }

  private async filterAccessibleMemberships(actorId: string, programId: string): Promise<GovernanceMembershipRecord[]> {
    const accessibleScopeIds = await this.getAccessibleScopeIds(actorId, programId);
    if (accessibleScopeIds.includes('*')) return this.membershipStore.listByProgram(programId);
    const accessible = new Set(accessibleScopeIds);
    return (await this.membershipStore.listByProgram(programId)).filter((membership) => membership.scopeId && accessible.has(membership.scopeId));
  }

  async update(actorId: string, actorEmail: string, programId: string, membershipId: string, dto: UpdateGovernanceMembershipDto): Promise<GovernanceMembershipResponse> {
    await this.programService.assertOwnedProgram(actorId, programId);
    if (dto.scopeId !== undefined) {
      if (dto.scopeId) await this.scopeService.findById(actorId, programId, dto.scopeId);
      await this.assertCanManageMembership(actorId, programId, dto.scopeId);
    }
    const membership = await this.membershipStore.findByIdAndProgram(programId, membershipId);
    if (!membership) throw new NotFoundException(ErrorCode.GOVERNANCE_MEMBERSHIP_NOT_FOUND);
    await this.assertCanManageMembership(actorId, programId, membership.scopeId);
    const updated = await this.membershipStore.update(membership.id, {
      ...(dto.scopeId !== undefined ? { scopeId: dto.scopeId || null } : {}),
      ...(dto.role !== undefined ? { role: dto.role as GovernanceMembershipRole, permissions: rolePermissions[dto.role as GovernanceMembershipRole] } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    });
    if (!updated) throw new NotFoundException(ErrorCode.GOVERNANCE_MEMBERSHIP_NOT_FOUND);
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.membership.updated', targetType: 'governance_membership', targetId: membershipId, metadata: { programId, status: updated.status, role: updated.role } });
    return this.toPopulatedResponse(updated, updated);
  }

  private async reactivateMembership(actorId: string, actorEmail: string, programId: string, membership: GovernanceMembershipRecord, dto: CreateGovernanceMembershipDto): Promise<GovernanceMembershipResponse> {
    const reactivated = await this.reactivateMembershipDocument(actorId, actorEmail, programId, membership, dto);
    return this.toPopulatedResponse(reactivated, reactivated);
  }

  private async reactivateMembershipDocument(actorId: string, actorEmail: string, programId: string, membership: GovernanceMembershipRecord, dto: CreateGovernanceMembershipDto): Promise<GovernanceMembershipRecord> {
    const updated = await this.membershipStore.update(membership.id, {
      role: dto.role as GovernanceMembershipRole,
      permissions: rolePermissions[dto.role as GovernanceMembershipRole],
      status: dto.status ?? 'active',
      invitedBy: actorId,
    });
    if (!updated) throw new NotFoundException(ErrorCode.GOVERNANCE_MEMBERSHIP_NOT_FOUND);
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.membership.updated', targetType: 'governance_membership', targetId: membership.id, metadata: { programId, scopeId: dto.scopeId, status: updated.status, role: updated.role, reason: 'reactivated_existing' } });
    return updated;
  }

  async disable(actorId: string, actorEmail: string, programId: string, membershipId: string): Promise<void> {
    await this.programService.assertOwnedProgram(actorId, programId);
    const membership = await this.membershipStore.findByIdAndProgram(programId, membershipId);
    if (!membership) throw new NotFoundException(ErrorCode.GOVERNANCE_MEMBERSHIP_NOT_FOUND);
    await this.assertCanManageMembership(actorId, programId, membership.scopeId);

    if (await this.isProgramOwner(actorId, programId)) {
      await this.membershipStore.deleteById(membership.id);
      this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.membership.deleted', targetType: 'governance_membership', targetId: membershipId, metadata: { programId } });
      return;
    }

    await this.membershipStore.update(membership.id, { status: 'disabled' });
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.membership.disabled', targetType: 'governance_membership', targetId: membershipId, metadata: { programId, status: 'disabled' } });
  }

  async getAccessibleScopeIds(userId: string, programId: string): Promise<string[]> {
    const groupIds = await this.userGroupService.findGroupIdsForMember(userId);
    const memberships = await this.membershipStore.findActiveForUser(programId, userId, groupIds);
    if (memberships.some((membership) => !membership.scopeId)) return ['*'];
    return memberships.map((membership) => membership.scopeId).filter((scopeId): scopeId is string => Boolean(scopeId));
  }

  async hasScopeRole(userId: string, programId: string, scopeId: string, roles: GovernanceMembershipRole[]): Promise<boolean> {
    const groupIds = await this.userGroupService.findGroupIdsForMember(userId);
    const membership = (await this.membershipStore.findActiveForUser(programId, userId, groupIds)).find(
      (candidate) => roles.includes(candidate.role) && (!candidate.scopeId || candidate.scopeId === scopeId),
    );
    return Boolean(membership);
  }

  private async assertProgramAndScope(actorId: string, programId: string, scopeId?: string): Promise<void> {
    await this.programService.assertOwnedProgram(actorId, programId);
    if (!scopeId) {
      await this.assertCanManageMembership(actorId, programId, undefined);
      return;
    }
    await this.scopeService.findById(actorId, programId, scopeId);
    await this.assertCanManageMembership(actorId, programId, scopeId);
  }

  private async assertCanManageMembership(actorId: string, programId: string, scopeId?: string): Promise<void> {
    if (await this.isProgramOwner(actorId, programId)) return;
    const accessibleScopeIds = await this.getAccessibleScopeIds(actorId, programId);
    if (accessibleScopeIds.includes('*')) return;
    if (scopeId && accessibleScopeIds.includes(scopeId)) return;
    throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED);
  }

  private async isProgramOwner(actorId: string, programId: string): Promise<boolean> {
    try {
      await this.programService.assertProgramOwner(actorId, programId);
      return true;
    } catch (error) {
      void error;
      return false;
    }
  }

  private assertSingleTarget(dto: CreateGovernanceMembershipDto): void {
    if (Boolean(dto.userId) === Boolean(dto.groupId)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Provide exactly one membership target: userId or groupId');
  }

  /** Replaces the former Mongo `MEMBERSHIP_POPULATE` with batched port lookups. */
  private async toPopulatedResponses(memberships: GovernanceMembershipRecord[]): Promise<GovernanceMembershipResponse[]> {
    const userIds = [...new Set(memberships.map((membership) => membership.userId).filter((id): id is string => Boolean(id)))];
    const groupIds = [...new Set(memberships.map((membership) => membership.groupId).filter((id): id is string => Boolean(id)))];
    const [users, groups] = await Promise.all([
      userIds.length ? this.userLookup.byIds(userIds) : Promise.resolve(new Map()),
      groupIds.length ? this.groupLookup.summariesByIds(groupIds) : Promise.resolve(new Map()),
    ]);
    return memberships.map((membership) => this.toResponse(membership, users, groups));
  }

  private async toPopulatedResponse(membership: GovernanceMembershipRecord | null, fallback: GovernanceMembershipRecord): Promise<GovernanceMembershipResponse> {
    return (await this.toPopulatedResponses([membership ?? fallback]))[0];
  }

  private toResponse(
    membership: GovernanceMembershipRecord,
    users: Map<string, { id: string; email: string; firstName: string; lastName: string }>,
    groups: Map<string, { id: string; name: string; memberCount: number }>,
  ): GovernanceMembershipResponse {
    const user = membership.userId ? users.get(membership.userId) : undefined;
    const group = membership.groupId ? groups.get(membership.groupId) : undefined;
    return {
      id: membership.id,
      programId: membership.programId,
      scopeId: membership.scopeId,
      userId: membership.userId,
      groupId: membership.groupId,
      invitedBy: membership.invitedBy,
      role: membership.role,
      status: membership.status,
      permissions: membership.permissions ?? [],
      user: user ? { id: user.id, email: user.email, firstName: user.firstName || undefined, lastName: user.lastName || undefined } : undefined,
      group: group ? { id: group.id, name: group.name, memberCount: group.memberCount } : undefined,
      createdAt: membership.createdAt instanceof Date ? membership.createdAt.toISOString() : String(membership.createdAt),
      updatedAt: membership.updatedAt instanceof Date ? membership.updatedAt.toISOString() : String(membership.updatedAt),
    };
  }
}
