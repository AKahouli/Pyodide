import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { Permissions } from '@modules/authorization/constants/permissions';
import { UserGroupService } from '@modules/user-group';
import { CreateGovernanceMembershipDto, UpdateGovernanceMembershipDto } from '../dto';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceScopeService } from './governance-scope.service';
import { GovernanceMembership, GovernanceMembershipDocument, GovernanceMembershipRole } from '../schemas/governance-membership.schema';

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

const MEMBERSHIP_POPULATE = [
  { path: 'userId', select: 'email profile.firstName profile.lastName' },
  { path: 'groupId', select: 'name members' },
];

const rolePermissions: Record<GovernanceMembershipRole, string[]> = {
  program_owner: [Permissions.GOVERNANCE_ALL],
  program_admin: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_PROGRAMS_MANAGE, Permissions.GOVERNANCE_SCOPES_MANAGE, Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_SOURCES_REVIEW, Permissions.GOVERNANCE_MEMBERSHIPS_MANAGE, Permissions.GOVERNANCE_DEPLOYMENTS_MANAGE, Permissions.GOVERNANCE_DRY_RUNS_EXECUTE, Permissions.GOVERNANCE_PUBLISH, Permissions.GOVERNANCE_METRICS_READ],
  scope_admin: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_SOURCES_REVIEW, Permissions.GOVERNANCE_MEMBERSHIPS_MANAGE, Permissions.GOVERNANCE_DEPLOYMENTS_MANAGE, Permissions.GOVERNANCE_DRY_RUNS_EXECUTE, Permissions.GOVERNANCE_METRICS_READ],
  scope_approver: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_SOURCES_REVIEW, Permissions.GOVERNANCE_PUBLISH, Permissions.GOVERNANCE_REVIEWS_MANAGE],
  scope_editor: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_DRY_RUNS_EXECUTE],
  scope_reviewer: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_SOURCES_REVIEW, Permissions.GOVERNANCE_DRY_RUNS_EXECUTE, Permissions.GOVERNANCE_REVIEWS_MANAGE],
  scope_viewer: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_METRICS_READ],
};

@Injectable()
export class GovernanceMembershipService {
  constructor(
    @InjectModel(GovernanceMembership.name)
    private readonly membershipModel: Model<GovernanceMembershipDocument>,
    private readonly programService: GovernanceProgramService,
    private readonly scopeService: GovernanceScopeService,
    private readonly userGroupService: UserGroupService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(actorId: string, actorEmail: string, programId: string, dto: CreateGovernanceMembershipDto): Promise<GovernanceMembershipResponse> {
    await this.assertProgramAndScope(actorId, programId, dto.scopeId);
    this.assertSingleTarget(dto);
    if (dto.groupId) await this.userGroupService.findById(actorId, dto.groupId);
    const targetFilter = dto.userId ? { userId: new Types.ObjectId(dto.userId) } : { groupId: new Types.ObjectId(dto.groupId) };
    const duplicate = await this.membershipModel.findOne({ programId: new Types.ObjectId(programId), scopeId: dto.scopeId ? new Types.ObjectId(dto.scopeId) : null, ...targetFilter }).exec();
    if (duplicate) return this.reactivateMembership(actorId, actorEmail, programId, duplicate, dto);
    const { membership, reusedExisting } = await this.createMembershipOrReuseDuplicate(actorId, actorEmail, programId, dto);
    if (!reusedExisting) this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.membership.invited', targetType: 'governance_membership', targetId: membership._id.toString(), metadata: { programId, scopeId: dto.scopeId, role: dto.role } });
    const populated = await this.membershipModel.findById(membership._id).populate(MEMBERSHIP_POPULATE).lean().exec();
    return this.toResponse(populated ?? membership);
  }

  private async createMembershipOrReuseDuplicate(actorId: string, actorEmail: string, programId: string, dto: CreateGovernanceMembershipDto): Promise<{ membership: GovernanceMembershipDocument; reusedExisting: boolean }> {
    try {
      const membership = await this.membershipModel.create({
        programId: new Types.ObjectId(programId),
        scopeId: dto.scopeId ? new Types.ObjectId(dto.scopeId) : undefined,
        userId: dto.userId ? new Types.ObjectId(dto.userId) : undefined,
        groupId: dto.groupId ? new Types.ObjectId(dto.groupId) : undefined,
        invitedBy: new Types.ObjectId(actorId),
        role: dto.role,
        status: dto.status ?? 'active',
        permissions: rolePermissions[dto.role as GovernanceMembershipRole],
      });
      return { membership, reusedExisting: false };
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) throw error;
      const targetFilter = dto.userId ? { userId: new Types.ObjectId(dto.userId) } : { groupId: new Types.ObjectId(dto.groupId) };
      const duplicate = await this.membershipModel.findOne({ programId: new Types.ObjectId(programId), scopeId: dto.scopeId ? new Types.ObjectId(dto.scopeId) : null, ...targetFilter }).exec();
      if (!duplicate) throw error;
      const membership = await this.reactivateMembershipDocument(actorId, actorEmail, programId, duplicate, dto);
      return { membership, reusedExisting: true };
    }
  }

  async list(actorId: string, programId: string): Promise<GovernanceMembershipResponse[]> {
    await this.programService.assertOwnedProgram(actorId, programId);
    const filter = await this.isProgramOwner(actorId, programId)
      ? { programId: new Types.ObjectId(programId) }
      : this.buildAccessibleMembershipFilter(actorId, programId);
    const memberships = await this.membershipModel.find(filter).populate(MEMBERSHIP_POPULATE).sort({ createdAt: -1 }).lean().exec();
    return memberships.map((membership) => this.toResponse(membership));
  }

  private async buildAccessibleMembershipFilter(actorId: string, programId: string): Promise<Record<string, unknown>> {
    const accessibleScopeIds = await this.getAccessibleScopeIds(actorId, programId);
    if (accessibleScopeIds.includes('*')) return { programId: new Types.ObjectId(programId) };
    return { programId: new Types.ObjectId(programId), scopeId: { $in: accessibleScopeIds.map((id) => new Types.ObjectId(id)) } };
  }

  async update(actorId: string, actorEmail: string, programId: string, membershipId: string, dto: UpdateGovernanceMembershipDto): Promise<GovernanceMembershipResponse> {
    await this.programService.assertOwnedProgram(actorId, programId);
    if (dto.scopeId !== undefined) {
      if (dto.scopeId) await this.scopeService.findById(actorId, programId, dto.scopeId);
      await this.assertCanManageMembership(actorId, programId, dto.scopeId);
    }
    const membership = await this.membershipModel.findOne({ _id: new Types.ObjectId(membershipId), programId: new Types.ObjectId(programId) }).exec();
    if (!membership) throw new NotFoundException(ErrorCode.GOVERNANCE_MEMBERSHIP_NOT_FOUND);
    await this.assertCanManageMembership(actorId, programId, membership.scopeId?.toString());
    if (dto.scopeId !== undefined) membership.scopeId = dto.scopeId ? new Types.ObjectId(dto.scopeId) : undefined;
    if (dto.role !== undefined) {
      membership.role = dto.role as GovernanceMembershipRole;
      membership.permissions = rolePermissions[dto.role as GovernanceMembershipRole];
    }
    if (dto.status !== undefined) membership.status = dto.status;
    await membership.save();
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.membership.updated', targetType: 'governance_membership', targetId: membershipId, metadata: { programId, status: membership.status, role: membership.role } });
    const populated = await this.membershipModel.findById(membership._id).populate(MEMBERSHIP_POPULATE).lean().exec();
    return this.toResponse(populated ?? membership);
  }

  private async reactivateMembership(actorId: string, actorEmail: string, programId: string, membership: GovernanceMembershipDocument, dto: CreateGovernanceMembershipDto): Promise<GovernanceMembershipResponse> {
    const reactivated = await this.reactivateMembershipDocument(actorId, actorEmail, programId, membership, dto);
    const populated = await this.membershipModel.findById(reactivated._id).populate(MEMBERSHIP_POPULATE).lean().exec();
    return this.toResponse(populated ?? reactivated);
  }

  private async reactivateMembershipDocument(actorId: string, actorEmail: string, programId: string, membership: GovernanceMembershipDocument, dto: CreateGovernanceMembershipDto): Promise<GovernanceMembershipDocument> {
    membership.role = dto.role as GovernanceMembershipRole;
    membership.permissions = rolePermissions[dto.role as GovernanceMembershipRole];
    membership.status = dto.status ?? 'active';
    membership.invitedBy = new Types.ObjectId(actorId);
    await membership.save();
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.membership.updated', targetType: 'governance_membership', targetId: membership._id.toString(), metadata: { programId, scopeId: dto.scopeId, status: membership.status, role: membership.role, reason: 'reactivated_existing' } });
    return membership;
  }

  async disable(actorId: string, actorEmail: string, programId: string, membershipId: string): Promise<void> {
    await this.programService.assertOwnedProgram(actorId, programId);
    const membership = await this.membershipModel.findOne({ _id: new Types.ObjectId(membershipId), programId: new Types.ObjectId(programId) }).exec();
    if (!membership) throw new NotFoundException(ErrorCode.GOVERNANCE_MEMBERSHIP_NOT_FOUND);
    await this.assertCanManageMembership(actorId, programId, membership.scopeId?.toString());
    membership.status = 'disabled';
    await membership.save();
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.membership.disabled', targetType: 'governance_membership', targetId: membershipId, metadata: { programId, status: 'disabled' } });
  }

  async getAccessibleScopeIds(userId: string, programId: string): Promise<string[]> {
    const groupIds = await this.userGroupService.findGroupIdsForMember(userId);
    const memberships = await this.membershipModel.find({
      programId: new Types.ObjectId(programId),
      status: 'active',
      $or: [
        { userId: new Types.ObjectId(userId) },
        ...(groupIds.length > 0 ? [{ groupId: { $in: groupIds.map((id) => new Types.ObjectId(id)) } }] : []),
      ],
    }).lean().exec();
    if (memberships.some((membership) => !membership.scopeId)) return ['*'];
    return memberships.map((membership) => membership.scopeId?.toString()).filter((scopeId): scopeId is string => Boolean(scopeId));
  }

  async hasScopeRole(userId: string, programId: string, scopeId: string, roles: GovernanceMembershipRole[]): Promise<boolean> {
    const groupIds = await this.userGroupService.findGroupIdsForMember(userId);
    const membership = await this.membershipModel.findOne({
      programId: new Types.ObjectId(programId),
      status: 'active',
      role: { $in: roles },
      $or: [
        { scopeId: null },
        { scopeId: new Types.ObjectId(scopeId) },
      ],
      $and: [{
        $or: [
          { userId: new Types.ObjectId(userId) },
          ...(groupIds.length > 0 ? [{ groupId: { $in: groupIds.map((id) => new Types.ObjectId(id)) } }] : []),
        ],
      }],
    }).select('_id').lean().exec();
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

  private isDuplicateKeyError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: GovernanceMembershipDocument | Record<string, unknown>): GovernanceMembershipResponse {
    const value = doc as any;
    return {
      id: value._id?.toString() ?? '',
      programId: value.programId?.toString() ?? '',
      scopeId: value.scopeId?.toString(),
      userId: this.objectIdString(value.userId),
      groupId: this.objectIdString(value.groupId),
      invitedBy: value.invitedBy?.toString() ?? '',
      role: value.role as GovernanceMembershipRole,
      status: value.status as 'invited' | 'active' | 'disabled',
      permissions: (value.permissions as string[]) ?? [],
      user: this.userSummary(value.userId),
      group: this.groupSummary(value.groupId),
      createdAt: this.toIso(value.createdAt),
      updatedAt: this.toIso(value.updatedAt),
    };
  }

  private objectIdString(value: unknown): string | undefined {
    if (!value) return undefined;
    if (typeof value === 'object' && '_id' in value) return (value._id as { toString(): string }).toString();
    return (value as { toString(): string }).toString();
  }

  private userSummary(value: unknown): GovernanceMembershipResponse['user'] {
    if (!value || typeof value !== 'object' || !('email' in value)) return undefined;
    const user = value as { _id?: { toString(): string }; email?: string; profile?: { firstName?: string; lastName?: string } };
    return { id: user._id?.toString() ?? '', email: user.email ?? '', firstName: user.profile?.firstName, lastName: user.profile?.lastName };
  }

  private groupSummary(value: unknown): GovernanceMembershipResponse['group'] {
    if (!value || typeof value !== 'object' || !('name' in value)) return undefined;
    const group = value as { _id?: { toString(): string }; name?: string; members?: unknown[] };
    return { id: group._id?.toString() ?? '', name: group.name ?? '', memberCount: group.members?.length ?? 0 };
  }

  private toIso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value ?? '');
  }
}
