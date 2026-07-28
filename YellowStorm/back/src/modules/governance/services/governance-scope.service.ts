import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConflictException, ForbiddenException, NotFoundException, ValidationException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { UserGroupService } from '@modules/user-group';
import { CreateGovernanceScopeDto, UpdateGovernanceScopeDto } from '../dto';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceScope, GovernanceScopeDocument } from '../schemas/governance-scope.schema';
import { GovernanceSource, GovernanceSourceDocument } from '../schemas/governance-source.schema';
import { GovernanceMembership, GovernanceMembershipDocument } from '../schemas/governance-membership.schema';
import { GovernanceDeployment, GovernanceDeploymentDocument } from '../schemas/governance-deployment.schema';
import { GovernanceDeploymentRevision, GovernanceDeploymentRevisionDocument } from '../schemas/governance-deployment-revision.schema';
import { GovernanceDryRun, GovernanceDryRunDocument } from '../schemas/governance-dry-run.schema';
import { GovernanceMetric, GovernanceMetricDocument } from '../schemas/governance-metric.schema';
import { GovernancePublicationAttempt, GovernancePublicationAttemptDocument } from '../schemas/governance-publication-attempt.schema';
import { GovernanceDraftPreparationService } from './governance-draft-preparation.service';

export interface GovernanceScopeResponse {
  id: string;
  programId: string;
  parentScopeId?: string;
  name: string;
  type: string;
  status: 'active' | 'inactive';
  agentIds: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class GovernanceScopeService {
  constructor(
    @InjectModel(GovernanceScope.name)
    private readonly scopeModel: Model<GovernanceScopeDocument>,
    @InjectModel(GovernanceSource.name)
    private readonly sourceModel: Model<GovernanceSourceDocument>,
    @InjectModel(GovernanceMembership.name)
    private readonly membershipModel: Model<GovernanceMembershipDocument>,
    @InjectModel(GovernanceDeployment.name)
    private readonly deploymentModel: Model<GovernanceDeploymentDocument>,
    @InjectModel(GovernanceDeploymentRevision.name)
    private readonly revisionModel: Model<GovernanceDeploymentRevisionDocument>,
    @InjectModel(GovernanceDryRun.name)
    private readonly dryRunModel: Model<GovernanceDryRunDocument>,
    @InjectModel(GovernanceMetric.name)
    private readonly metricModel: Model<GovernanceMetricDocument>,
    @InjectModel(GovernancePublicationAttempt.name)
    private readonly publicationAttemptModel: Model<GovernancePublicationAttemptDocument>,
    private readonly programService: GovernanceProgramService,
    private readonly userGroupService: UserGroupService,
    private readonly auditLogService: AuditLogService,
    private readonly draftPreparation: GovernanceDraftPreparationService,
  ) {}

  async create(ownerUserId: string, programId: string, dto: CreateGovernanceScopeDto): Promise<GovernanceScopeResponse> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    await this.assertNoDuplicate(programId, dto.name.trim());
    await this.assertValidParent(programId, dto.parentScopeId);
    const metadata = dto.metadata ? this.normalizeDescription(dto.metadata) : undefined;
    const scope = await this.scopeModel.create({ ...dto, metadata, name: dto.name.trim(), programId: new Types.ObjectId(programId) });
    return this.toResponse(scope);
  }

  async list(ownerUserId: string, programId: string): Promise<GovernanceScopeResponse[]> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    const accessibleScopeIds = await this.getAccessibleScopeIds(ownerUserId, programId);
    const filter = accessibleScopeIds.includes('*')
      ? { programId: new Types.ObjectId(programId) }
      : { programId: new Types.ObjectId(programId), _id: { $in: accessibleScopeIds.map((id) => new Types.ObjectId(id)) } };
    const scopes = await this.scopeModel.find(filter).sort({ createdAt: 1 }).lean().exec();
    return scopes.map((scope) => this.toResponse(scope));
  }

  async findById(ownerUserId: string, programId: string, scopeId: string): Promise<GovernanceScopeResponse> {
    const scope = await this.findOwnedScope(ownerUserId, programId, scopeId);
    return this.toResponse(scope);
  }

  async update(ownerUserId: string, ownerEmail: string, programId: string, scopeId: string, dto: UpdateGovernanceScopeDto): Promise<GovernanceScopeResponse> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    await this.assertScopeAccess(ownerUserId, programId, scopeId);
    await this.assertCanUpdateScope(ownerUserId, programId, scopeId, dto);
    const scope = await this.scopeModel.findOne({ _id: new Types.ObjectId(scopeId), programId: new Types.ObjectId(programId) }).exec();
    if (!scope) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      await this.assertNoDuplicate(programId, name, scopeId);
      scope.name = name;
    }
    if (dto.parentScopeId !== undefined) {
      await this.assertValidParent(programId, dto.parentScopeId, scopeId);
      scope.parentScopeId = dto.parentScopeId ? new Types.ObjectId(dto.parentScopeId) : undefined;
    }
    if (dto.type !== undefined) scope.type = dto.type as GovernanceScope['type'];
    if (dto.status !== undefined) {
      scope.status = dto.status;
      if (dto.status === 'inactive') await this.suspendPublishedDeployment(ownerUserId, ownerEmail, programId, scopeId);
    }
    if (dto.agentIds !== undefined) scope.agentIds = dto.agentIds.map((id) => new Types.ObjectId(id));
    if (dto.metadata !== undefined) {
      const metadata = this.normalizeDescription(dto.metadata);
      this.assertMetadataUpdateAllowed(metadata);
      scope.metadata = this.mergeMetadata(scope.metadata, metadata);
    }
    await scope.save();
    const materialChange = dto.name !== undefined || dto.parentScopeId !== undefined || dto.type !== undefined || dto.status !== undefined || dto.agentIds !== undefined || dto.metadata?.classification !== undefined;
    if (materialChange) await this.draftPreparation.prepare(ownerUserId, ownerEmail, programId, scopeId);
    return this.toResponse(scope);
  }

  async delete(ownerUserId: string, programId: string, scopeId: string): Promise<void> {
    await this.findOwnedScope(ownerUserId, programId, scopeId);
    await this.assertCanDeleteScope(ownerUserId, programId, scopeId);
    await this.deleteScopeTree(programId, scopeId);
  }

  private async deleteScopeTree(programId: string, scopeId: string): Promise<void> {
    const programObjectId = new Types.ObjectId(programId);
    const scopeObjectId = new Types.ObjectId(scopeId);
    const children = await this.scopeModel.find({ programId: programObjectId, parentScopeId: scopeObjectId }).select('_id').lean().exec();
    await Promise.all(children.map((child) => this.deleteScopeTree(programId, child._id.toString())));
    const deployments = await this.deploymentModel.find({ programId: programObjectId, scopeId: scopeObjectId }).select('_id').lean().exec();
    const deploymentIds = deployments.map((deployment) => deployment._id);
    await this.sourceModel.deleteMany({ programId: programObjectId, visibility: 'multi_scope', scopeIds: { $size: 1, $all: [scopeObjectId] } });
    await Promise.all([
      this.sourceModel.deleteMany({ programId: programObjectId, visibility: 'scope_specific', scopeIds: scopeObjectId }),
      this.sourceModel.updateMany({ programId: programObjectId, visibility: 'multi_scope', scopeIds: scopeObjectId }, { $pull: { scopeIds: scopeObjectId } }),
      this.sourceModel.updateMany({ programId: programObjectId, ownerScopeId: scopeObjectId }, { $unset: { ownerScopeId: '' } }),
      this.membershipModel.deleteMany({ programId: programObjectId, scopeId: scopeObjectId }),
      this.metricModel.deleteMany({ programId: programObjectId, scopeId: scopeObjectId }),
      this.dryRunModel.deleteMany({ programId: programObjectId, scopeId: scopeObjectId }),
      this.publicationAttemptModel.deleteMany({ programId: programObjectId, scopeId: scopeObjectId }),
      deploymentIds.length > 0 ? this.revisionModel.deleteMany({ deploymentId: { $in: deploymentIds } }) : Promise.resolve(),
      deploymentIds.length > 0 ? this.deploymentModel.deleteMany({ _id: { $in: deploymentIds } }) : Promise.resolve(),
    ]);
    await this.scopeModel.deleteOne({ _id: scopeObjectId, programId: programObjectId });
  }

  private async assertCanDeleteScope(ownerUserId: string, programId: string, scopeId: string): Promise<void> {
    if (await this.isProgramOwner(ownerUserId, programId)) return;
    const membership = await this.membershipModel.findOne({
      userId: new Types.ObjectId(ownerUserId),
      programId: new Types.ObjectId(programId),
      status: 'active',
      $or: [
        { scopeId: null, role: 'program_admin' },
        { scopeId: new Types.ObjectId(scopeId), role: 'scope_admin' },
      ],
    }).select('_id').lean().exec();
    if (membership) return;
    throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED);
  }

  private async assertCanUpdateScope(ownerUserId: string, programId: string, scopeId: string, dto: UpdateGovernanceScopeDto): Promise<void> {
    if (!this.hasScopeManagementFields(dto)) return;
    if (await this.canManageScope(ownerUserId, programId, scopeId)) return;
    throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED);
  }

  private hasScopeManagementFields(dto: UpdateGovernanceScopeDto): boolean {
    if (dto.name !== undefined || dto.parentScopeId !== undefined || dto.type !== undefined || dto.status !== undefined || dto.agentIds !== undefined) return true;
    if (!dto.metadata) return false;
    return Object.keys(dto.metadata).some((key) => key !== 'review');
  }

  private async canManageScope(ownerUserId: string, programId: string, scopeId: string): Promise<boolean> {
    if (await this.isProgramOwner(ownerUserId, programId)) return true;
    const groupIds = await this.userGroupService.findGroupIdsForMember(ownerUserId);
    const membership = await this.membershipModel.findOne({
      programId: new Types.ObjectId(programId),
      status: 'active',
      role: { $in: ['program_admin', 'scope_admin'] },
      $or: [
        { userId: new Types.ObjectId(ownerUserId) },
        ...(groupIds.length > 0 ? [{ groupId: { $in: groupIds.map((id) => new Types.ObjectId(id)) } }] : []),
      ],
      $and: [{
        $or: [
          { scopeId: null },
          { scopeId: new Types.ObjectId(scopeId) },
        ],
      }],
    }).select('_id').lean().exec();
    return Boolean(membership);
  }

  private async suspendPublishedDeployment(actorId: string, actorEmail: string, programId: string, scopeId: string): Promise<void> {
    const result = await this.deploymentModel.updateOne(
      { programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId), status: 'published' },
      { $set: { status: 'suspended' } },
    ).exec();
    if (result.modifiedCount > 0) {
      this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.deployment.suspended', targetType: 'governance_scope', targetId: scopeId, metadata: { programId, scopeId, reason: 'scope_inactive' } });
    }
  }

  private assertMetadataUpdateAllowed(metadata: Record<string, unknown>): void {
    const review = metadata.review;
    if (review && typeof review === 'object' && 'status' in review && (review as { status?: unknown }).status === 'approved') {
      throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED);
    }
  }

  private normalizeDescription(metadata: Record<string, unknown>): Record<string, unknown> {
    const description = metadata.description;
    if (description === undefined) return metadata;
    if (typeof description !== 'string' || description.length > 2000) {
      throw new ValidationException([{ field: 'metadata.description', message: 'Scope description must be a string of at most 2000 characters', value: description }]);
    }
    return { ...metadata, description: description.trim() };
  }

  private mergeMetadata(current: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
    const merged = { ...(current ?? {}) };
    for (const [key, value] of Object.entries(next)) {
      const existing = merged[key];
      merged[key] = this.isPlainObject(existing) && this.isPlainObject(value)
        ? this.mergeMetadata(existing as Record<string, unknown>, value as Record<string, unknown>)
        : value;
    }
    return merged;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
  }

  async countProgramScopes(programId: string, scopeIds: string[]): Promise<number> {
    return this.scopeModel.countDocuments({ programId: new Types.ObjectId(programId), _id: { $in: scopeIds.map((id) => new Types.ObjectId(id)) } });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async findOwnedScope(ownerUserId: string, programId: string, scopeId: string): Promise<any> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    await this.assertScopeAccess(ownerUserId, programId, scopeId);
    const scope = await this.scopeModel.findOne({ _id: new Types.ObjectId(scopeId), programId: new Types.ObjectId(programId) }).lean().exec();
    if (!scope) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    return scope;
  }

  private async assertNoDuplicate(programId: string, name: string, excludeScopeId?: string): Promise<void> {
    const filter = excludeScopeId ? { programId: new Types.ObjectId(programId), name, _id: { $ne: new Types.ObjectId(excludeScopeId) } } : { programId: new Types.ObjectId(programId), name };
    const duplicate = await this.scopeModel.findOne(filter).lean().exec();
    if (duplicate) throw new ConflictException(ErrorCode.GOVERNANCE_SCOPE_NAME_EXISTS);
  }

  private async assertScopeAccess(ownerUserId: string, programId: string, scopeId: string): Promise<void> {
    const accessibleScopeIds = await this.getAccessibleScopeIds(ownerUserId, programId);
    if (accessibleScopeIds.includes('*') || accessibleScopeIds.includes(scopeId)) return;
    throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
  }

  private async getAccessibleScopeIds(ownerUserId: string, programId: string): Promise<string[]> {
    if (await this.isProgramOwner(ownerUserId, programId)) return ['*'];
    const groupIds = await this.userGroupService.findGroupIdsForMember(ownerUserId);
    const memberships = await this.membershipModel.find({
      programId: new Types.ObjectId(programId),
      status: 'active',
      $or: [
        { userId: new Types.ObjectId(ownerUserId) },
        ...(groupIds.length > 0 ? [{ groupId: { $in: groupIds.map((id) => new Types.ObjectId(id)) } }] : []),
      ],
    }).lean().exec();
    if (memberships.some((membership) => !membership.scopeId)) return ['*'];
    return memberships.map((membership) => membership.scopeId?.toString()).filter((scopeId): scopeId is string => Boolean(scopeId));
  }

  private async isProgramOwner(ownerUserId: string, programId: string): Promise<boolean> {
    try {
      await this.programService.assertProgramOwner(ownerUserId, programId);
      return true;
    } catch (error) {
      void error;
      return false;
    }
  }

  private async assertValidParent(programId: string, parentScopeId?: string, scopeId?: string): Promise<void> {
    if (!parentScopeId) return;
    if (scopeId && parentScopeId === scopeId) throw new ConflictException(ErrorCode.GOVERNANCE_SCOPE_PARENT_INVALID);
    const parent = await this.scopeModel.findOne({ _id: new Types.ObjectId(parentScopeId), programId: new Types.ObjectId(programId) }).lean().exec();
    if (!parent) throw new ConflictException(ErrorCode.GOVERNANCE_SCOPE_PARENT_INVALID);
    if (!scopeId) return;
    let cursor = parent.parentScopeId?.toString();
    while (cursor) {
      if (cursor === scopeId) throw new ConflictException(ErrorCode.GOVERNANCE_SCOPE_PARENT_INVALID);
      const ancestor = await this.scopeModel.findOne({ _id: new Types.ObjectId(cursor), programId: new Types.ObjectId(programId) }).select('parentScopeId').lean().exec();
      cursor = ancestor?.parentScopeId?.toString();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: any): GovernanceScopeResponse {
    return {
      id: doc._id.toString(),
      programId: doc.programId.toString(),
      parentScopeId: doc.parentScopeId?.toString(),
      name: doc.name,
      type: doc.type,
      status: doc.status,
      agentIds: (doc.agentIds ?? []).map((id: Types.ObjectId) => id.toString()),
      metadata: doc.metadata ?? {},
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    };
  }
}
