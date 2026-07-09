import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { CreateGovernanceSourceDto, UpdateGovernanceSourceDto } from '../dto';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceScopeService } from './governance-scope.service';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceSource, GovernanceSourceDocument, GovernanceSourceStatus } from '../schemas/governance-source.schema';

export interface GovernanceSourceResponse {
  id: string;
  programId: string;
  scopeIds: string[];
  visibility: string;
  title: string;
  sourceType: string;
  url?: string;
  workspaceId?: string;
  documentId?: string;
  status: string;
  tags: string[];
  metadata: Record<string, unknown>;
  lastReviewedAt?: string;
  nextReviewAt?: string;
  reviewFrequencyDays?: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class GovernanceSourceService {
  constructor(
    @InjectModel(GovernanceSource.name)
    private readonly sourceModel: Model<GovernanceSourceDocument>,
    private readonly programService: GovernanceProgramService,
    private readonly scopeService: GovernanceScopeService,
    private readonly accessService: GovernanceAccessService,
  ) {}

  async create(ownerUserId: string, programId: string, dto: CreateGovernanceSourceDto): Promise<GovernanceSourceResponse> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    await this.assertValidScopeSelection(programId, dto.visibility, dto.scopeIds ?? []);
    await this.assertSourceScopeAccess(ownerUserId, programId, dto.visibility, dto.scopeIds ?? []);
    const source = await this.sourceModel.create({
      title: dto.title.trim(),
      visibility: dto.visibility,
      sourceType: dto.sourceType,
      url: dto.url,
      workspaceId: dto.workspaceId ? new Types.ObjectId(dto.workspaceId) : undefined,
      documentId: dto.documentId ? new Types.ObjectId(dto.documentId) : undefined,
      status: 'draft',
      tags: dto.tags ?? [],
      metadata: dto.metadata ?? {},
      reviewFrequencyDays: dto.reviewFrequencyDays,
      programId: new Types.ObjectId(programId),
      scopeIds: (dto.scopeIds ?? []).map((id) => new Types.ObjectId(id)),
    });
    return this.toResponse(source);
  }

  async list(ownerUserId: string, programId: string): Promise<GovernanceSourceResponse[]> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    const sourceFilter = await this.buildAccessibleSourceFilter(ownerUserId, programId);
    const sources = await this.sourceModel.find(sourceFilter).sort({ updatedAt: -1 }).lean().exec();
    return sources.map((source) => this.toResponse(source));
  }

  async findById(ownerUserId: string, programId: string, sourceId: string): Promise<GovernanceSourceResponse> {
    const source = await this.findOwnedSource(ownerUserId, programId, sourceId);
    return this.toResponse(source);
  }

  async update(ownerUserId: string, programId: string, sourceId: string, dto: UpdateGovernanceSourceDto): Promise<GovernanceSourceResponse> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    const source = await this.sourceModel.findOne({ _id: new Types.ObjectId(sourceId), programId: new Types.ObjectId(programId) }).exec();
    if (!source) throw new NotFoundException(ErrorCode.GOVERNANCE_SOURCE_NOT_FOUND);
    await this.assertSourceMutationAccess(ownerUserId, programId, source.visibility, source.scopeIds.map((id) => id.toString()));
    const visibility = dto.visibility ?? source.visibility;
    const scopeIds = dto.scopeIds ?? source.scopeIds.map((id) => id.toString());
    await this.assertValidScopeSelection(programId, visibility, scopeIds);
    await this.assertSourceScopeAccess(ownerUserId, programId, visibility, scopeIds);

    if (dto.title !== undefined) source.title = dto.title.trim();
    if (dto.visibility !== undefined) source.visibility = dto.visibility;
    if (dto.scopeIds !== undefined) source.scopeIds = dto.scopeIds.map((id) => new Types.ObjectId(id));
    if (dto.sourceType !== undefined) source.sourceType = dto.sourceType;
    if (dto.url !== undefined) source.url = dto.url;
    if (dto.workspaceId !== undefined) source.workspaceId = dto.workspaceId ? new Types.ObjectId(dto.workspaceId) : undefined;
    if (dto.documentId !== undefined) source.documentId = dto.documentId ? new Types.ObjectId(dto.documentId) : undefined;
    if (dto.status !== undefined) source.status = dto.status as GovernanceSourceStatus;
    if (dto.tags !== undefined) source.tags = dto.tags;
    if (dto.metadata !== undefined) source.metadata = dto.metadata;
    if (dto.reviewFrequencyDays !== undefined) source.reviewFrequencyDays = dto.reviewFrequencyDays;
    await source.save();
    return this.toResponse(source);
  }

  async delete(ownerUserId: string, programId: string, sourceId: string): Promise<void> {
    const source = await this.findOwnedSource(ownerUserId, programId, sourceId);
    await this.assertSourceMutationAccess(ownerUserId, programId, source.visibility, source.scopeIds.map((id: Types.ObjectId) => id.toString()));
    await this.sourceModel.deleteOne({ _id: source._id });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async findOwnedSource(ownerUserId: string, programId: string, sourceId: string): Promise<any> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    const source = await this.sourceModel.findOne({ _id: new Types.ObjectId(sourceId), programId: new Types.ObjectId(programId) }).lean().exec();
    if (!source) throw new NotFoundException(ErrorCode.GOVERNANCE_SOURCE_NOT_FOUND);
    if (source.visibility !== 'program_shared') {
      await this.accessService.assertScopeSelection(ownerUserId, programId, source.scopeIds.map((id: Types.ObjectId) => id.toString()));
    }
    return source;
  }

  private async buildAccessibleSourceFilter(ownerUserId: string, programId: string): Promise<Record<string, unknown>> {
    const programObjectId = new Types.ObjectId(programId);
    const accessibleScopeIds = await this.accessService.getAccessibleScopeIds(ownerUserId, programId);
    if (accessibleScopeIds.includes('*')) return { programId: programObjectId };
    return {
      programId: programObjectId,
      $or: [
        { visibility: 'program_shared' },
        { scopeIds: { $in: accessibleScopeIds.map((id) => new Types.ObjectId(id)) } },
      ],
    };
  }

  private async assertSourceScopeAccess(ownerUserId: string, programId: string, visibility: string, scopeIds: string[]): Promise<void> {
    if (visibility === 'program_shared') {
      await this.accessService.assertProgramWideAccess(ownerUserId, programId);
      return;
    }
    await this.accessService.assertScopeSelection(ownerUserId, programId, scopeIds);
  }

  private async assertSourceMutationAccess(ownerUserId: string, programId: string, visibility: string, scopeIds: string[]): Promise<void> {
    if (visibility === 'program_shared') {
      await this.accessService.assertProgramWideAccess(ownerUserId, programId);
      return;
    }
    await this.accessService.assertScopeSelection(ownerUserId, programId, scopeIds);
  }

  private async assertValidScopeSelection(programId: string, visibility: string, scopeIds: string[]): Promise<void> {
    if (visibility === 'program_shared' && scopeIds.length > 0) {
      throw new ConflictException(ErrorCode.GOVERNANCE_SOURCE_SCOPE_INVALID);
    }
    if (visibility !== 'program_shared' && scopeIds.length === 0) {
      throw new ConflictException(ErrorCode.GOVERNANCE_SOURCE_SCOPE_INVALID);
    }
    if (visibility === 'scope_specific' && scopeIds.length !== 1) {
      throw new ConflictException(ErrorCode.GOVERNANCE_SOURCE_SCOPE_INVALID);
    }
    if (scopeIds.length === 0) return;
    const count = await this.scopeService.countProgramScopes(programId, scopeIds);
    if (count !== new Set(scopeIds).size) throw new ConflictException(ErrorCode.GOVERNANCE_SOURCE_SCOPE_INVALID);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: any): GovernanceSourceResponse {
    return {
      id: doc._id.toString(),
      programId: doc.programId.toString(),
      scopeIds: (doc.scopeIds ?? []).map((id: Types.ObjectId) => id.toString()),
      visibility: doc.visibility,
      title: doc.title,
      sourceType: doc.sourceType,
      url: doc.url,
      workspaceId: doc.workspaceId?.toString(),
      documentId: doc.documentId?.toString(),
      status: doc.status,
      tags: doc.tags ?? [],
      metadata: doc.metadata ?? {},
      lastReviewedAt: this.toIso(doc.lastReviewedAt),
      nextReviewAt: this.toIso(doc.nextReviewAt),
      reviewFrequencyDays: doc.reviewFrequencyDays,
      createdAt: this.toIso(doc.createdAt) ?? '',
      updatedAt: this.toIso(doc.updatedAt) ?? '',
    };
  }

  private toIso(value?: Date | string): string | undefined {
    if (!value) return undefined;
    return value instanceof Date ? value.toISOString() : value;
  }
}
