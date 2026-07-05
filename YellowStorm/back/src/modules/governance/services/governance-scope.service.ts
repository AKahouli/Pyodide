import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { CreateGovernanceScopeDto, UpdateGovernanceScopeDto } from '../dto';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceScope, GovernanceScopeDocument } from '../schemas/governance-scope.schema';
import { GovernanceSource, GovernanceSourceDocument } from '../schemas/governance-source.schema';
import { GovernanceMembership, GovernanceMembershipDocument } from '../schemas/governance-membership.schema';

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
    private readonly programService: GovernanceProgramService,
  ) {}

  async create(ownerUserId: string, programId: string, dto: CreateGovernanceScopeDto): Promise<GovernanceScopeResponse> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    await this.assertNoDuplicate(programId, dto.name.trim());
    await this.assertValidParent(programId, dto.parentScopeId);
    const scope = await this.scopeModel.create({ ...dto, name: dto.name.trim(), programId: new Types.ObjectId(programId) });
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

  async update(ownerUserId: string, programId: string, scopeId: string, dto: UpdateGovernanceScopeDto): Promise<GovernanceScopeResponse> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
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
    if (dto.status !== undefined) scope.status = dto.status;
    if (dto.agentIds !== undefined) scope.agentIds = dto.agentIds.map((id) => new Types.ObjectId(id));
    if (dto.metadata !== undefined) scope.metadata = dto.metadata;
    await scope.save();
    return this.toResponse(scope);
  }

  async delete(ownerUserId: string, programId: string, scopeId: string): Promise<void> {
    const scope = await this.findOwnedScope(ownerUserId, programId, scopeId);
    const [childScopeCount, sourceCount] = await Promise.all([
      this.scopeModel.countDocuments({ programId: new Types.ObjectId(programId), parentScopeId: new Types.ObjectId(scopeId) }),
      this.sourceModel.countDocuments({ programId: new Types.ObjectId(programId), scopeIds: new Types.ObjectId(scopeId) }),
    ]);
    if (childScopeCount > 0 || sourceCount > 0) {
      throw new ConflictException(ErrorCode.GOVERNANCE_SCOPE_DELETE_BLOCKED);
    }
    await this.scopeModel.deleteOne({ _id: scope._id });
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
    const memberships = await this.membershipModel.find({ userId: new Types.ObjectId(ownerUserId), programId: new Types.ObjectId(programId), status: 'active' }).lean().exec();
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
