import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConflictException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { GovernanceProgram, GovernanceProgramDocument } from '../schemas/governance-program.schema';
import { GovernanceScope, GovernanceScopeDocument } from '../schemas/governance-scope.schema';
import { GovernanceSource, GovernanceSourceDocument } from '../schemas/governance-source.schema';
import { GovernanceMembership, GovernanceMembershipDocument } from '../schemas/governance-membership.schema';
import { CreateGovernanceProgramDto, UpdateGovernanceProgramDto } from '../dto';

export interface GovernanceProgramResponse {
  id: string;
  name: string;
  description?: string;
  domain?: string;
  defaultLanguage: string;
  status: 'draft' | 'published' | 'archived';
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class GovernanceProgramService {
  constructor(
    @InjectModel(GovernanceProgram.name)
    private readonly programModel: Model<GovernanceProgramDocument>,
    @InjectModel(GovernanceScope.name)
    private readonly scopeModel: Model<GovernanceScopeDocument>,
    @InjectModel(GovernanceSource.name)
    private readonly sourceModel: Model<GovernanceSourceDocument>,
    @InjectModel(GovernanceMembership.name)
    private readonly membershipModel: Model<GovernanceMembershipDocument>,
  ) {}

  async create(ownerUserId: string, dto: CreateGovernanceProgramDto): Promise<GovernanceProgramResponse> {
    const name = dto.name.trim();
    const ownerId = new Types.ObjectId(ownerUserId);
    const existing = await this.programModel.findOne({ ownerUserId: ownerId, name }).lean().exec();
    if (existing) throw new ConflictException(ErrorCode.GOVERNANCE_PROGRAM_NAME_EXISTS);

    const program = await this.programModel.create({
      ...dto,
      name,
      ownerUserId: ownerId,
    });
    return this.toResponse(program);
  }

  async listForOwner(ownerUserId: string): Promise<GovernanceProgramResponse[]> {
    const ownerId = new Types.ObjectId(ownerUserId);
    const memberships = await this.membershipModel.find({ userId: ownerId, status: 'active' }).select('programId').lean().exec();
    const programIds = memberships.map((membership) => membership.programId);
    const programs = await this.programModel
      .find({ $or: [{ ownerUserId: ownerId }, { _id: { $in: programIds } }] })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    return programs.map((program) => this.toResponse(program));
  }

  async findById(ownerUserId: string, programId: string): Promise<GovernanceProgramResponse> {
    const program = await this.findAccessibleProgram(ownerUserId, programId);
    return this.toResponse(program);
  }

  async update(ownerUserId: string, programId: string, dto: UpdateGovernanceProgramDto): Promise<GovernanceProgramResponse> {
    const ownerId = new Types.ObjectId(ownerUserId);
    const programObjectId = new Types.ObjectId(programId);
    const program = await this.programModel.findOne({ _id: programObjectId, ownerUserId: ownerId }).exec();
    if (!program) throw new NotFoundException(ErrorCode.GOVERNANCE_PROGRAM_NOT_FOUND);

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const duplicate = await this.programModel.findOne({ ownerUserId: ownerId, name, _id: { $ne: program._id } }).lean().exec();
      if (duplicate) throw new ConflictException(ErrorCode.GOVERNANCE_PROGRAM_NAME_EXISTS);
      program.name = name;
    }
    if (dto.description !== undefined) program.description = dto.description;
    if (dto.domain !== undefined) program.domain = dto.domain;
    if (dto.defaultLanguage !== undefined) program.defaultLanguage = dto.defaultLanguage;
    if (dto.status !== undefined) program.status = dto.status;
    if (dto.metadata !== undefined) program.metadata = dto.metadata;
    await program.save();
    return this.toResponse(program);
  }

  async delete(ownerUserId: string, programId: string): Promise<void> {
    const ownerId = new Types.ObjectId(ownerUserId);
    const programObjectId = new Types.ObjectId(programId);
    const program = await this.programModel.findById(programObjectId).exec();
    if (!program) throw new NotFoundException(ErrorCode.GOVERNANCE_PROGRAM_NOT_FOUND);
    const isOwner = program.ownerUserId.toString() === ownerUserId;
    const isProgramAdmin = await this.hasActiveProgramRole(ownerId, programObjectId, 'program_admin');
    if (!isOwner && !isProgramAdmin) throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED);

    const [scopeCount, sourceCount] = await Promise.all([
      this.scopeModel.countDocuments({ programId: programObjectId }),
      this.sourceModel.countDocuments({ programId: programObjectId }),
    ]);
    if (scopeCount > 0 || sourceCount > 0) {
      throw new ConflictException(ErrorCode.GOVERNANCE_PROGRAM_DELETE_BLOCKED);
    }
    await this.programModel.deleteOne({ _id: program._id });
  }

  private async hasActiveProgramRole(userId: Types.ObjectId, programId: Types.ObjectId, role: string): Promise<boolean> {
    const membership = await this.membershipModel.findOne({ programId, userId, scopeId: null, role, status: 'active' }).select('_id').lean().exec();
    return Boolean(membership);
  }

  async assertOwnedProgram(ownerUserId: string, programId: string): Promise<void> {
    await this.findAccessibleProgram(ownerUserId, programId);
  }

  async assertProgramOwner(ownerUserId: string, programId: string): Promise<void> {
    await this.findOwnedProgram(ownerUserId, programId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async findOwnedProgram(ownerUserId: string, programId: string): Promise<any> {
    const program = await this.programModel.findOne({ _id: new Types.ObjectId(programId), ownerUserId: new Types.ObjectId(ownerUserId) }).lean().exec();
    if (!program) throw new NotFoundException(ErrorCode.GOVERNANCE_PROGRAM_NOT_FOUND);
    return program;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async findAccessibleProgram(ownerUserId: string, programId: string): Promise<any> {
    const ownerId = new Types.ObjectId(ownerUserId);
    const programObjectId = new Types.ObjectId(programId);
    const program = await this.programModel.findOne({ _id: programObjectId, ownerUserId: ownerId }).lean().exec();
    if (program) return program;
    const membership = await this.membershipModel.findOne({ programId: programObjectId, userId: ownerId, status: 'active' }).lean().exec();
    if (!membership) throw new NotFoundException(ErrorCode.GOVERNANCE_PROGRAM_NOT_FOUND);
    const accessibleProgram = await this.programModel.findById(programObjectId).lean().exec();
    if (!accessibleProgram) throw new NotFoundException(ErrorCode.GOVERNANCE_PROGRAM_NOT_FOUND);
    return accessibleProgram;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: any): GovernanceProgramResponse {
    return {
      id: doc._id.toString(),
      name: doc.name,
      description: doc.description,
      domain: doc.domain,
      defaultLanguage: doc.defaultLanguage,
      status: doc.status,
      metadata: doc.metadata ?? {},
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    };
  }
}
