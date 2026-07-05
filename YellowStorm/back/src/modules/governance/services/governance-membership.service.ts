import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { ConflictException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { Permissions } from '@modules/authorization/constants/permissions';
import { CreateGovernanceMembershipDto, UpdateGovernanceMembershipDto } from '../dto';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceScopeService } from './governance-scope.service';
import { GovernanceMembership, GovernanceMembershipDocument, GovernanceMembershipRole } from '../schemas/governance-membership.schema';

export interface GovernanceMembershipResponse {
  id: string;
  programId: string;
  scopeId?: string;
  userId: string;
  invitedBy: string;
  role: GovernanceMembershipRole;
  status: 'invited' | 'active' | 'disabled';
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

const rolePermissions: Record<GovernanceMembershipRole, string[]> = {
  program_owner: [Permissions.GOVERNANCE_ALL],
  program_admin: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_PROGRAMS_MANAGE, Permissions.GOVERNANCE_SCOPES_MANAGE, Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_SOURCES_REVIEW, Permissions.GOVERNANCE_MEMBERSHIPS_MANAGE, Permissions.GOVERNANCE_DEPLOYMENTS_MANAGE, Permissions.GOVERNANCE_DRY_RUNS_EXECUTE, Permissions.GOVERNANCE_PUBLISH, Permissions.GOVERNANCE_METRICS_READ],
  scope_admin: [Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_SOURCES_REVIEW, Permissions.GOVERNANCE_MEMBERSHIPS_MANAGE, Permissions.GOVERNANCE_DEPLOYMENTS_MANAGE, Permissions.GOVERNANCE_DRY_RUNS_EXECUTE, Permissions.GOVERNANCE_METRICS_READ],
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
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(actorId: string, actorEmail: string, programId: string, dto: CreateGovernanceMembershipDto): Promise<GovernanceMembershipResponse> {
    await this.assertProgramAndScope(actorId, programId, dto.scopeId);
    const duplicate = await this.membershipModel.findOne({ programId: new Types.ObjectId(programId), scopeId: dto.scopeId ? new Types.ObjectId(dto.scopeId) : null, userId: new Types.ObjectId(dto.userId) }).lean().exec();
    if (duplicate) throw new ConflictException(ErrorCode.GOVERNANCE_MEMBERSHIP_EXISTS);
    const membership = await this.membershipModel.create({
      programId: new Types.ObjectId(programId),
      scopeId: dto.scopeId ? new Types.ObjectId(dto.scopeId) : undefined,
      userId: new Types.ObjectId(dto.userId),
      invitedBy: new Types.ObjectId(actorId),
      role: dto.role,
      status: dto.status ?? 'active',
      permissions: rolePermissions[dto.role as GovernanceMembershipRole],
    });
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.membership.invited', targetType: 'governance_membership', targetId: membership._id.toString(), metadata: { programId, scopeId: dto.scopeId, role: dto.role } });
    return this.toResponse(membership);
  }

  async list(actorId: string, programId: string): Promise<GovernanceMembershipResponse[]> {
    await this.programService.assertOwnedProgram(actorId, programId);
    const accessibleScopeIds = await this.getAccessibleScopeIds(actorId, programId);
    const filter = accessibleScopeIds.includes('*')
      ? { programId: new Types.ObjectId(programId) }
      : { programId: new Types.ObjectId(programId), scopeId: { $in: accessibleScopeIds.map((id) => new Types.ObjectId(id)) } };
    const memberships = await this.membershipModel.find(filter).sort({ createdAt: -1 }).lean().exec();
    return memberships.map((membership) => this.toResponse(membership));
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
    if (dto.userId !== undefined) membership.userId = new Types.ObjectId(dto.userId);
    if (dto.role !== undefined) {
      membership.role = dto.role as GovernanceMembershipRole;
      membership.permissions = rolePermissions[dto.role as GovernanceMembershipRole];
    }
    if (dto.status !== undefined) membership.status = dto.status;
    await membership.save();
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.membership.updated', targetType: 'governance_membership', targetId: membershipId, metadata: { programId, status: membership.status, role: membership.role } });
    return this.toResponse(membership);
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
    const memberships = await this.membershipModel.find({ userId: new Types.ObjectId(userId), programId: new Types.ObjectId(programId), status: 'active' }).lean().exec();
    if (memberships.some((membership) => !membership.scopeId)) return ['*'];
    return memberships.map((membership) => membership.scopeId?.toString()).filter((scopeId): scopeId is string => Boolean(scopeId));
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: GovernanceMembershipDocument | Record<string, unknown>): GovernanceMembershipResponse {
    const value = doc as any;
    return {
      id: value._id?.toString() ?? '',
      programId: value.programId?.toString() ?? '',
      scopeId: value.scopeId?.toString(),
      userId: value.userId?.toString() ?? '',
      invitedBy: value.invitedBy?.toString() ?? '',
      role: value.role as GovernanceMembershipRole,
      status: value.status as 'invited' | 'active' | 'disabled',
      permissions: (value.permissions as string[]) ?? [],
      createdAt: this.toIso(value.createdAt),
      updatedAt: this.toIso(value.updatedAt),
    };
  }

  private toIso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value ?? '');
  }
}
