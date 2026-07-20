import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { CreateGovernanceSourceDto, UpdateGovernanceSourceDto } from '../dto';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceScopeService } from './governance-scope.service';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceSource, GovernanceSourceDocument, GovernanceSourceStatus } from '../schemas/governance-source.schema';
import { GovernanceSourceVersion, GovernanceSourceVersionDocument } from '../schemas/governance-source-version.schema';
import { GovernanceSourceEvent, GovernanceSourceEventDocument } from '../schemas/governance-source-event.schema';
import { GovernanceSourceEventService } from './governance-source-event.service';
import { GovernanceDeploymentRevision, GovernanceDeploymentRevisionDocument } from '../schemas/governance-deployment-revision.schema';
import { KnowledgeExtractionOrchestratorService } from '@modules/knowledge-intelligence/services/knowledge-extraction-orchestrator.service';
import { TemporalCandidateRepositoryService } from '@modules/knowledge-intelligence/services/temporal-candidate-repository.service';
import { GovernanceDraftPreparationService } from './governance-draft-preparation.service';

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
  isArchived: boolean;
  archivedAt?: string;
  archiveReason?: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class GovernanceSourceService {
  private readonly logger = new Logger(GovernanceSourceService.name);
  constructor(
    @InjectModel(GovernanceSource.name)
    private readonly sourceModel: Model<GovernanceSourceDocument>,
    private readonly programService: GovernanceProgramService,
    private readonly scopeService: GovernanceScopeService,
    private readonly accessService: GovernanceAccessService,
    private readonly config: ConfigService,
    @InjectModel(GovernanceSourceVersion.name) private readonly versionModel: Model<GovernanceSourceVersionDocument>,
    @InjectModel(GovernanceSourceEvent.name) private readonly eventModel: Model<GovernanceSourceEventDocument>,
    @InjectModel(GovernanceDeploymentRevision.name) private readonly revisionModel: Model<GovernanceDeploymentRevisionDocument>,
    private readonly events: GovernanceSourceEventService,
    private readonly extractionJobs: KnowledgeExtractionOrchestratorService,
    private readonly temporalCandidates: TemporalCandidateRepositoryService,
    @InjectConnection() private readonly connection: Connection,
    private readonly draftPreparation: GovernanceDraftPreparationService,
  ) {}

  async create(ownerUserId: string, programId: string, dto: CreateGovernanceSourceDto, ownerEmail = ''): Promise<GovernanceSourceResponse> {
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
    const affectedScopeIds = await this.resolveAffectedScopeIds(ownerUserId, programId, dto.visibility, dto.scopeIds ?? []);
    await Promise.all(affectedScopeIds.map((scopeId) => this.draftPreparation.prepare(ownerUserId, ownerEmail, programId, scopeId)));
    return this.toResponse(source);
  }

  async list(ownerUserId: string, programId: string, includeArchived = false): Promise<GovernanceSourceResponse[]> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    const sourceFilter = await this.buildAccessibleSourceFilter(ownerUserId, programId);
    const sources = await this.sourceModel.find({ ...sourceFilter, ...(includeArchived ? {} : { isArchived: { $ne: true } }) }).sort({ updatedAt: -1 }).lean().exec();
    return sources.map((source) => this.toResponse(source));
  }

  async findById(ownerUserId: string, programId: string, sourceId: string): Promise<GovernanceSourceResponse> {
    const source = await this.findOwnedSource(ownerUserId, programId, sourceId);
    return this.toResponse(source);
  }

  async update(ownerUserId: string, programId: string, sourceId: string, dto: UpdateGovernanceSourceDto, ownerEmail = ''): Promise<GovernanceSourceResponse> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    const source = await this.sourceModel.findOne({ _id: new Types.ObjectId(sourceId), programId: new Types.ObjectId(programId) }).exec();
    if (!source) throw new NotFoundException(ErrorCode.GOVERNANCE_SOURCE_NOT_FOUND);
    await this.assertSourceMutationAccess(ownerUserId, programId, source.visibility, source.scopeIds.map((id) => id.toString()));
    const visibility = dto.visibility ?? source.visibility;
    const scopeIds = dto.scopeIds ?? source.scopeIds.map((id) => id.toString());
    const previousVisibility = source.visibility;
    const previousScopeIds = source.scopeIds.map((id) => id.toString());
    await this.assertValidScopeSelection(programId, visibility, scopeIds);
    await this.assertSourceScopeAccess(ownerUserId, programId, visibility, scopeIds);

    if (dto.title !== undefined) source.title = dto.title.trim();
    if (dto.visibility !== undefined) source.visibility = dto.visibility;
    if (dto.scopeIds !== undefined) source.scopeIds = dto.scopeIds.map((id) => new Types.ObjectId(id));
    if (dto.sourceType !== undefined) source.sourceType = dto.sourceType;
    if (dto.url !== undefined) source.url = dto.url;
    if (dto.workspaceId !== undefined) source.workspaceId = dto.workspaceId ? new Types.ObjectId(dto.workspaceId) : undefined;
    if (dto.documentId !== undefined) source.documentId = dto.documentId ? new Types.ObjectId(dto.documentId) : undefined;
    if (dto.status !== undefined) {
      if (this.config.get<boolean>('dataRoom.sourceVersioningEnabled')) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Use source-version lifecycle transitions while versioning is enabled');
      source.status = dto.status as GovernanceSourceStatus;
    }
    if (dto.tags !== undefined) source.tags = dto.tags;
    if (dto.metadata !== undefined) source.metadata = dto.metadata;
    if (dto.reviewFrequencyDays !== undefined) source.reviewFrequencyDays = dto.reviewFrequencyDays;
    const affectedScopeIds = [...new Set([
      ...(await this.resolveAffectedScopeIds(ownerUserId, programId, previousVisibility, previousScopeIds)),
      ...(await this.resolveAffectedScopeIds(ownerUserId, programId, visibility, scopeIds)),
    ])];
    await source.save();
    await Promise.all(affectedScopeIds.map((scopeId) => this.draftPreparation.prepare(ownerUserId, ownerEmail, programId, scopeId)));
    return this.toResponse(source);
  }

  async archive(ownerUserId: string, programId: string, sourceId: string, reason?: string, ownerEmail = ''): Promise<GovernanceSourceResponse> {
    const source = await this.findMutableSource(ownerUserId, programId, sourceId);
    if (!source.isArchived) {
      source.isArchived = true;
      source.archivedAt = new Date();
      source.archivedBy = new Types.ObjectId(ownerUserId);
      source.archiveReason = reason;
      await source.save();
      await this.events.append({ programId, sourceId, actorId: ownerUserId, eventType: 'source.archived', reason });
      const affectedScopeIds = await this.resolveAffectedScopeIds(ownerUserId, programId, source.visibility, source.scopeIds.map(String));
      await Promise.all(affectedScopeIds.map((scopeId) => this.draftPreparation.prepare(ownerUserId, ownerEmail, programId, scopeId)));
    }
    return this.toResponse(source);
  }

  async restore(ownerUserId: string, programId: string, sourceId: string, ownerEmail = ''): Promise<GovernanceSourceResponse> {
    const source = await this.findMutableSource(ownerUserId, programId, sourceId);
    if (source.isArchived) {
      source.isArchived = false;
      source.archivedAt = undefined;
      source.archivedBy = undefined;
      source.archiveReason = undefined;
      await source.save();
      await this.events.append({ programId, sourceId, actorId: ownerUserId, eventType: 'source.restored' });
      const affectedScopeIds = await this.resolveAffectedScopeIds(ownerUserId, programId, source.visibility, source.scopeIds.map(String));
      await Promise.all(affectedScopeIds.map((scopeId) => this.draftPreparation.prepare(ownerUserId, ownerEmail, programId, scopeId)));
    }
    return this.toResponse(source);
  }

  async permanentlyDelete(ownerUserId: string, programId: string, sourceId: string, confirm: boolean): Promise<void> {
    if (!confirm) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Permanent deletion requires explicit confirmation');
    if (!this.config.get<boolean>('dataRoom.permanentSourceDeletionEnabled')) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Permanent source deletion is disabled');
    const source = await this.findMutableSource(ownerUserId, programId, sourceId);
    if (!source.isArchived) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Archive the source before permanent deletion');
    const referencedByRevision = await this.revisionModel.exists({ $or: [{ sourceIds: source._id }, { includedSourceIds: source._id }, { excludedSourceIds: source._id }] });
    if (referencedByRevision) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Permanent deletion is blocked because a deployment revision references this source');
    const remove = async (session?: ClientSession): Promise<void> => {
      // Keep the terminal audit record after removing the source's operational history.
      // It deliberately becomes an orphaned event because the source itself is gone.
      const deletionEvent = await this.events.append({ programId, sourceId, actorId: ownerUserId, eventType: 'source.permanently_deleted', session });
      await this.temporalCandidates.purgeSource(sourceId, session);
      await this.extractionJobs.purgeSource(sourceId, session);
      await this.versionModel.deleteMany({ sourceId: source._id }, { session }).exec();
      await this.eventModel.deleteMany({ sourceId: source._id, _id: { $ne: deletionEvent._id } }, { session }).exec();
      await source.deleteOne({ session });
    };
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(() => remove(session));
    } catch (error) {
      if (!(error instanceof Error) || !/Transaction numbers are only allowed|does not support transactions|replica set/i.test(error.message)) throw error;
      this.logger.error('MongoDB transactions are unavailable; refusing permanent source deletion', { sourceId, programId });
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Permanent source deletion requires a transaction-capable MongoDB deployment');
    } finally {
      await session.endSession();
    }
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

  private async findMutableSource(ownerUserId: string, programId: string, sourceId: string): Promise<GovernanceSourceDocument> {
    await this.programService.assertOwnedProgram(ownerUserId, programId);
    const source = await this.sourceModel.findOne({ _id: new Types.ObjectId(sourceId), programId: new Types.ObjectId(programId) }).exec();
    if (!source) throw new NotFoundException(ErrorCode.GOVERNANCE_SOURCE_NOT_FOUND);
    await this.assertSourceMutationAccess(ownerUserId, programId, source.visibility, source.scopeIds.map((id) => id.toString()));
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

  private async resolveAffectedScopeIds(ownerUserId: string, programId: string, visibility: string, scopeIds: string[]): Promise<string[]> {
    if (visibility !== 'program_shared') return [...new Set(scopeIds)];
    return (await this.scopeService.list(ownerUserId, programId)).map((scope) => scope.id);
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
      isArchived: doc.isArchived === true,
      archivedAt: this.toIso(doc.archivedAt),
      archiveReason: doc.archiveReason,
      createdAt: this.toIso(doc.createdAt) ?? '',
      updatedAt: this.toIso(doc.updatedAt) ?? '',
    };
  }

  private toIso(value?: Date | string): string | undefined {
    if (!value) return undefined;
    return value instanceof Date ? value.toISOString() : value;
  }
}
