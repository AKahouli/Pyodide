import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { CreateGovernanceDeploymentDto, CreateGovernanceRevisionDto, PublishGovernanceDeploymentDto, UpdateGovernanceDeploymentDto, UpdateGovernanceRevisionDto } from '../dto';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceScopeService } from './governance-scope.service';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceDeployment, GovernanceDeploymentDocument } from '../schemas/governance-deployment.schema';
import { GovernanceDeploymentRevision, GovernanceDeploymentRevisionDocument } from '../schemas/governance-deployment-revision.schema';
import { GovernanceDryRun, GovernanceDryRunDocument } from '../schemas/governance-dry-run.schema';
import { GovernanceSource, GovernanceSourceDocument } from '../schemas/governance-source.schema';
import { GovernancePublicationAttempt, GovernancePublicationAttemptDocument, GovernancePublicationAttemptStatus } from '../schemas/governance-publication-attempt.schema';
import { GovernanceDraftPreparationService } from './governance-draft-preparation.service';

export interface GovernanceDeploymentResponse { id: string; programId: string; scopeId: string; name: string; status: string; currentDraftRevisionId?: string; currentPublishedRevisionId?: string; channels: Record<string, unknown>; createdAt: string; updatedAt: string }
export interface GovernanceRevisionResponse { id: string; deploymentId: string; revisionNumber: number; status: string; agentId: string; allowedAgentIds: string[]; workspaceIds: string[]; sourceIds: string[]; includedSourceIds: string[]; excludedSourceIds: string[]; sourceSnapshot: Record<string, unknown>; workspaceBindingSnapshot: Record<string, unknown>; configurationFingerprint?: string; scopeSnapshot: Record<string, unknown>; audienceSnapshot: Record<string, unknown>; previousAudienceSnapshot: Record<string, unknown>; createdBy: string; publishedBy?: string; publishedAt?: string; createdAt: string; updatedAt: string }
export interface GovernanceReadiness { deploymentId: string; score: number; status: 'ready' | 'blocked' | 'warning'; blockers: GovernanceReadinessCheck[]; warnings: GovernanceReadinessCheck[]; checks: GovernanceReadinessCheck[] }
export interface GovernanceReadinessCheck { key: string; label: string; status: 'passed' | 'warning' | 'failed'; severity: 'info' | 'warning' | 'blocking'; message?: string; targetType?: string; targetId?: string }

@Injectable()
export class GovernanceDeploymentService {
  constructor(
    @InjectModel(GovernanceDeployment.name) private readonly deploymentModel: Model<GovernanceDeploymentDocument>,
    @InjectModel(GovernanceDeploymentRevision.name) private readonly revisionModel: Model<GovernanceDeploymentRevisionDocument>,
    @InjectModel(GovernanceDryRun.name) private readonly dryRunModel: Model<GovernanceDryRunDocument>,
    @InjectModel(GovernanceSource.name) private readonly sourceModel: Model<GovernanceSourceDocument>,
    @InjectModel(GovernancePublicationAttempt.name) private readonly attemptModel: Model<GovernancePublicationAttemptDocument>,
    private readonly programService: GovernanceProgramService,
    private readonly scopeService: GovernanceScopeService,
    private readonly accessService: GovernanceAccessService,
    private readonly auditLogService: AuditLogService,
    private readonly draftPreparationService: GovernanceDraftPreparationService,
  ) {}

  async create(actorId: string, actorEmail: string, programId: string, dto: CreateGovernanceDeploymentDto): Promise<GovernanceDeploymentResponse> {
    const scope = await this.scopeService.findById(actorId, programId, dto.scopeId);
    await this.accessService.assertScopeAccess(actorId, programId, dto.scopeId);
    const duplicate = await this.deploymentModel.findOne({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(dto.scopeId) }).lean().exec();
    if (duplicate) throw new ConflictException(ErrorCode.GOVERNANCE_DEPLOYMENT_EXISTS);
    const deployment = await this.deploymentModel.create({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(dto.scopeId), name: dto.name.trim(), status: 'draft', channels: dto.channels ?? {} });
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.deployment.created', targetType: 'governance_deployment', targetId: deployment._id.toString(), metadata: { programId, scopeId: dto.scopeId } });
    if (scope.agentIds.length > 0) await this.draftPreparationService.prepare(actorId, actorEmail, programId, dto.scopeId);
    return this.toDeploymentResponse(deployment);
  }

  async list(actorId: string, programId: string): Promise<GovernanceDeploymentResponse[]> {
    await this.programService.assertOwnedProgram(actorId, programId);
    const accessibleScopeIds = await this.accessService.getAccessibleScopeIds(actorId, programId);
    const filter = accessibleScopeIds.includes('*')
      ? { programId: new Types.ObjectId(programId) }
      : { programId: new Types.ObjectId(programId), scopeId: { $in: accessibleScopeIds.map((id) => new Types.ObjectId(id)) } };
    const deployments = await this.deploymentModel.find(filter).sort({ updatedAt: -1 }).lean().exec();
    return deployments.map((deployment) => this.toDeploymentResponse(deployment));
  }

  async findById(actorId: string, deploymentId: string): Promise<GovernanceDeploymentResponse> {
    const deployment = await this.findOwnedDeployment(actorId, deploymentId);
    return this.toDeploymentResponse(deployment);
  }

  async update(actorId: string, deploymentId: string, dto: UpdateGovernanceDeploymentDto): Promise<GovernanceDeploymentResponse> {
    const deployment = await this.findOwnedDeploymentDocument(actorId, deploymentId);
    if (dto.name !== undefined) deployment.name = dto.name.trim();
    if (dto.channels !== undefined) deployment.channels = dto.channels;
    await deployment.save();
    return this.toDeploymentResponse(deployment);
  }

  async createRevision(actorId: string, actorEmail: string, deploymentId: string, dto: CreateGovernanceRevisionDto): Promise<GovernanceRevisionResponse> {
    const deployment = await this.findOwnedDeploymentDocument(actorId, deploymentId);
    if (deployment.status === 'archived') throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
    const deploymentObjectId = new Types.ObjectId(deploymentId);
    const revisionNumber = (await this.revisionModel.countDocuments({ deploymentId: deploymentObjectId })) + 1;
    const allowedAgentIds = this.normalizeAllowedAgentIds(dto.agentId, dto.allowedAgentIds);
    await this.assertAgentsBelongToScope(actorId, deployment.programId.toString(), deployment.scopeId.toString(), allowedAgentIds);
    await this.assertWorkspacesBelongToScope(deployment.programId.toString(), deployment.scopeId.toString(), dto.workspaceIds ?? []);
    const revision = await this.revisionModel.create({
      deploymentId: deploymentObjectId,
      revisionNumber,
      agentId: new Types.ObjectId(dto.agentId),
      allowedAgentIds: this.toObjectIds(allowedAgentIds),
      workspaceIds: this.toObjectIds(dto.workspaceIds),
      sourceIds: this.toObjectIds(dto.sourceIds),
      includedSourceIds: this.toObjectIds(dto.includedSourceIds),
      excludedSourceIds: this.toObjectIds(dto.excludedSourceIds),
      agentSnapshot: dto.agentSnapshot ?? {},
      channelSnapshot: deployment.channels ?? {},
      sourceSnapshot: await this.buildSourceSnapshot(deployment.programId.toString(), dto.sourceIds ?? []),
      createdBy: new Types.ObjectId(actorId),
    });
    deployment.currentDraftRevisionId = revision._id;
    if (deployment.status !== 'published') deployment.status = 'dry_run';
    await deployment.save();
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.revision.created', targetType: 'governance_revision', targetId: revision._id.toString(), metadata: { deploymentId } });
    return this.toRevisionResponse(revision);
  }

  async listRevisions(actorId: string, deploymentId: string): Promise<GovernanceRevisionResponse[]> {
    await this.findOwnedDeployment(actorId, deploymentId);
    const revisions = await this.revisionModel.find({ deploymentId: new Types.ObjectId(deploymentId) }).sort({ revisionNumber: -1 }).lean().exec();
    return revisions.map((revision) => this.toRevisionResponse(revision));
  }

  async updateRevision(actorId: string, deploymentId: string, revisionId: string, dto: UpdateGovernanceRevisionDto): Promise<GovernanceRevisionResponse> {
    await this.findOwnedDeployment(actorId, deploymentId);
    const revision = await this.revisionModel.findOne({ _id: new Types.ObjectId(revisionId), deploymentId: new Types.ObjectId(deploymentId) }).exec();
    if (!revision) throw new NotFoundException(ErrorCode.GOVERNANCE_REVISION_NOT_FOUND);
    if (revision.status === 'published') throw new ConflictException(ErrorCode.GOVERNANCE_REVISION_IMMUTABLE);
    if (dto.agentId !== undefined) revision.agentId = new Types.ObjectId(dto.agentId);
    if (dto.agentId !== undefined || dto.allowedAgentIds !== undefined) {
      const primaryAgentId = dto.agentId ?? revision.agentId.toString();
      const allowedAgentIds = this.normalizeAllowedAgentIds(primaryAgentId, dto.allowedAgentIds ?? revision.allowedAgentIds.map(String));
      const deployment = await this.deploymentModel.findById(deploymentId).lean().exec();
      if (!deployment) throw new NotFoundException(ErrorCode.GOVERNANCE_DEPLOYMENT_NOT_FOUND);
      await this.assertAgentsBelongToScope(actorId, deployment.programId.toString(), deployment.scopeId.toString(), allowedAgentIds);
      revision.allowedAgentIds = this.toObjectIds(allowedAgentIds);
    }
    if (dto.workspaceIds !== undefined) {
      const deployment = await this.deploymentModel.findById(deploymentId).lean().exec();
      if (!deployment) throw new NotFoundException(ErrorCode.GOVERNANCE_DEPLOYMENT_NOT_FOUND);
      await this.assertWorkspacesBelongToScope(deployment.programId.toString(), deployment.scopeId.toString(), dto.workspaceIds);
      revision.workspaceIds = this.toObjectIds(dto.workspaceIds);
    }
    if (dto.sourceIds !== undefined) revision.sourceIds = this.toObjectIds(dto.sourceIds);
    if (dto.includedSourceIds !== undefined) revision.includedSourceIds = this.toObjectIds(dto.includedSourceIds);
    if (dto.excludedSourceIds !== undefined) revision.excludedSourceIds = this.toObjectIds(dto.excludedSourceIds);
    if (dto.agentSnapshot !== undefined) revision.agentSnapshot = dto.agentSnapshot;
    await revision.save();
    return this.toRevisionResponse(revision);
  }

  async getReadiness(actorId: string, deploymentId: string): Promise<GovernanceReadiness> {
    const deployment = await this.findOwnedDeployment(actorId, deploymentId);
    return this.buildReadiness(actorId, deploymentId, deployment);
  }

  async publish(actorId: string, actorEmail: string, deploymentId: string, dto: PublishGovernanceDeploymentDto): Promise<GovernanceDeploymentResponse> {
    const deployment = await this.findOwnedDeploymentDocument(actorId, deploymentId);
    await this.accessService.assertScopeRole(actorId, deployment.programId.toString(), deployment.scopeId.toString(), ['scope_approver']);
    let readiness: GovernanceReadiness | undefined;
    let revisionId = dto.revisionId ?? deployment.currentDraftRevisionId?.toString();
    try {
      if (deployment.status === 'archived') throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
      const scope = await this.scopeService.findById(actorId, deployment.programId.toString(), deployment.scopeId.toString());
      if (scope.status !== 'active') throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
      readiness = await this.buildReadiness(actorId, deploymentId, deployment);
      if (readiness.blockers.length > 0 && !dto.allowPartial) {
        await this.createPublicationAttempt(actorId, actorEmail, deployment, revisionId, dto, 'blocked', readiness, ErrorCode.GOVERNANCE_PUBLISH_BLOCKED, 'Readiness blockers prevent publication');
        this.auditLogService.logFailure({ actorId, actorEmail, action: 'governance.deployment.published', targetType: 'governance_deployment', targetId: deploymentId, failureReason: 'Readiness blockers prevent publication', metadata: { blockers: readiness.blockers.map((blocker) => blocker.key) } });
        throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
      }
      if (!revisionId) throw new ConflictException(ErrorCode.GOVERNANCE_NO_DRAFT_REVISION);
      if (revisionId !== deployment.currentDraftRevisionId?.toString()) throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
      if (deployment.currentPublishedRevisionId?.toString() === revisionId) throw new ConflictException(ErrorCode.GOVERNANCE_REVISION_IMMUTABLE);
      const revision = await this.revisionModel.findOne({ _id: new Types.ObjectId(revisionId), deploymentId: new Types.ObjectId(deploymentId) }).exec();
      if (!revision) throw new NotFoundException(ErrorCode.GOVERNANCE_REVISION_NOT_FOUND);
      if (revision.status === 'published' || revision.status === 'rejected') throw new ConflictException(ErrorCode.GOVERNANCE_REVISION_IMMUTABLE);
      if (!revision.agentId || !revision.allowedAgentIds?.length) throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
      const previousRevisionStatus = revision.status;
      revision.status = 'published';
      revision.publishedBy = new Types.ObjectId(actorId);
      revision.publishedAt = new Date();
      await revision.save();
      let publishDeployment: GovernanceDeploymentDocument | null;
      try {
        publishDeployment = await this.deploymentModel.findOneAndUpdate(
          { _id: deployment._id, currentDraftRevisionId: revision._id, currentPublishedRevisionId: { $ne: revision._id } },
          { $set: { currentPublishedRevisionId: revision._id, status: 'published' } },
          { new: true },
        ).exec();
      } catch (error) {
        const observedDeployment = await this.deploymentModel.findById(deployment._id).exec();
        if (observedDeployment?.currentPublishedRevisionId?.equals(revision._id)) publishDeployment = observedDeployment;
        else {
          revision.status = previousRevisionStatus;
          revision.publishedBy = undefined;
          revision.publishedAt = undefined;
          await revision.save();
          throw error;
        }
      }
      if (!publishDeployment) {
        const observedDeployment = await this.deploymentModel.findById(deployment._id).exec();
        if (observedDeployment?.currentPublishedRevisionId?.equals(revision._id)) publishDeployment = observedDeployment;
        else {
          revision.status = previousRevisionStatus;
          revision.publishedBy = undefined;
          revision.publishedAt = undefined;
          await revision.save();
          throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
        }
      }
      await this.createPublicationAttempt(actorId, actorEmail, publishDeployment, revisionId, dto, dto.allowPartial ? 'partial' : 'success', readiness);
      this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.deployment.published', targetType: 'governance_deployment', targetId: deploymentId, metadata: { revisionId, channels: dto.channels } });
      return this.toDeploymentResponse(publishDeployment);
    } catch (error) {
      if (readiness && !(error instanceof ConflictException && (error as { code?: string }).code === ErrorCode.GOVERNANCE_PUBLISH_BLOCKED)) {
        await this.createPublicationAttempt(actorId, actorEmail, deployment, revisionId, dto, 'failed', readiness, this.getErrorCode(error), this.getErrorMessage(error));
      }
      throw error;
    }
  }

  async suspend(actorId: string, actorEmail: string, deploymentId: string): Promise<GovernanceDeploymentResponse> {
    const deployment = await this.findOwnedDeploymentDocument(actorId, deploymentId);
    if (!deployment.currentPublishedRevisionId || deployment.status !== 'published') throw new ConflictException(ErrorCode.GOVERNANCE_NO_PUBLISHED_REVISION);
    deployment.status = 'suspended';
    await deployment.save();
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.deployment.suspended', targetType: 'governance_deployment', targetId: deploymentId, metadata: { programId: deployment.programId.toString() } });
    return this.toDeploymentResponse(deployment);
  }

  async rollback(actorId: string, actorEmail: string, deploymentId: string): Promise<GovernanceDeploymentResponse> {
    const deployment = await this.findOwnedDeploymentDocument(actorId, deploymentId);
    if (!deployment.currentPublishedRevisionId) throw new ConflictException(ErrorCode.GOVERNANCE_NO_PUBLISHED_REVISION);
    const previous = await this.revisionModel.findOne({ deploymentId: new Types.ObjectId(deploymentId), status: 'published', _id: { $ne: deployment.currentPublishedRevisionId } }).sort({ publishedAt: -1 }).exec();
    if (!previous) throw new ConflictException(ErrorCode.GOVERNANCE_NO_PUBLISHED_REVISION);
    deployment.currentPublishedRevisionId = previous._id;
    deployment.status = 'published';
    await deployment.save();
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.deployment.rollback', targetType: 'governance_deployment', targetId: deploymentId, metadata: { revisionId: previous._id.toString() } });
    return this.toDeploymentResponse(deployment);
  }

  async resolveContext(actorId: string, deploymentId: string): Promise<Record<string, unknown>> {
    const deployment = await this.findOwnedDeployment(actorId, deploymentId);
    if (deployment.status !== 'published') throw new BadRequestException(ErrorCode.GOVERNANCE_NO_PUBLISHED_REVISION);
    if (!deployment.currentPublishedRevisionId) throw new BadRequestException(ErrorCode.GOVERNANCE_NO_PUBLISHED_REVISION);
    const revision = await this.revisionModel.findById(deployment.currentPublishedRevisionId).lean().exec();
    if (!revision) throw new NotFoundException(ErrorCode.GOVERNANCE_REVISION_NOT_FOUND);
    return { programId: deployment.programId.toString(), scopeId: deployment.scopeId.toString(), deploymentId, revisionId: revision._id.toString(), agentId: revision.agentId.toString(), workspaceIds: revision.workspaceIds.map((id) => id.toString()), sourceIds: revision.sourceIds.map((id) => id.toString()), channels: deployment.channels };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async findOwnedDeployment(actorId: string, deploymentId: string): Promise<any> {
    const deployment = await this.deploymentModel.findById(deploymentId).lean().exec();
    if (!deployment) throw new NotFoundException(ErrorCode.GOVERNANCE_DEPLOYMENT_NOT_FOUND);
    await this.programService.assertOwnedProgram(actorId, deployment.programId.toString());
    await this.accessService.assertScopeAccess(actorId, deployment.programId.toString(), deployment.scopeId.toString());
    return deployment;
  }

  private async findOwnedDeploymentDocument(actorId: string, deploymentId: string): Promise<GovernanceDeploymentDocument> {
    const deployment = await this.deploymentModel.findById(deploymentId).exec();
    if (!deployment) throw new NotFoundException(ErrorCode.GOVERNANCE_DEPLOYMENT_NOT_FOUND);
    await this.programService.assertOwnedProgram(actorId, deployment.programId.toString());
    await this.accessService.assertScopeAccess(actorId, deployment.programId.toString(), deployment.scopeId.toString());
    return deployment;
  }

  private async buildReadiness(actorId: string, deploymentId: string, deployment: GovernanceDeploymentDocument): Promise<GovernanceReadiness> {
    const checks = await this.buildReadinessChecks(actorId, deployment);
    const blockers = checks.filter((check) => check.severity === 'blocking' && check.status === 'failed');
    const warnings = checks.filter((check) => check.severity === 'warning' && check.status !== 'passed');
    const score = Math.max(0, Math.round((checks.filter((check) => check.status === 'passed').length / checks.length) * 100));
    return { deploymentId, score, status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ready', blockers, warnings, checks };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async buildReadinessChecks(actorId: string, deployment: any): Promise<GovernanceReadinessCheck[]> {
    const passedDryRun = deployment.currentDraftRevisionId
      ? await this.dryRunModel.findOne({ deploymentId: deployment._id, revisionId: deployment.currentDraftRevisionId, status: 'passed' }).select('_id').lean().exec()
      : null;
    const checks: GovernanceReadinessCheck[] = [
      { key: 'draft_revision', label: 'Draft revision', status: deployment.currentDraftRevisionId ? 'passed' : 'failed', severity: 'blocking', targetType: 'rule' },
      { key: 'dry_run_passed', label: 'Dry-run passed', status: passedDryRun ? 'passed' : 'failed', severity: 'blocking', targetType: 'dry_run' },
      { key: 'published_revision', label: 'Published revision', status: deployment.currentPublishedRevisionId ? 'passed' : 'warning', severity: 'warning', targetType: 'rule' },
    ];
    void actorId;
    return checks;
  }

  private async createPublicationAttempt(actorId: string, actorEmail: string, deployment: GovernanceDeploymentDocument, revisionId: string | undefined, dto: PublishGovernanceDeploymentDto, status: GovernancePublicationAttemptStatus, readiness?: GovernanceReadiness, errorCode?: string, errorMessage?: string): Promise<void> {
    await this.attemptModel.create({
      programId: deployment.programId,
      scopeId: deployment.scopeId,
      deploymentId: deployment._id,
      revisionId: revisionId ? new Types.ObjectId(revisionId) : undefined,
      triggeredByUserId: new Types.ObjectId(actorId),
      triggeredByEmail: actorEmail,
      requestedChannels: dto.channels ?? [],
      allowPartial: Boolean(dto.allowPartial),
      comment: dto.comment,
      status,
      readinessSnapshot: readiness ?? {},
      errorCode,
      errorMessage,
    });
  }

  private getErrorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : undefined;
  }

  private getErrorMessage(error: unknown): string | undefined {
    return error instanceof Error ? error.message : undefined;
  }

  private async buildSourceSnapshot(programId: string, sourceIds: string[]): Promise<Record<string, unknown>> {
    const sources = await this.sourceModel.find({ programId, _id: { $in: sourceIds } }).select('title status visibility').lean().exec();
    return { sources: sources.map((source) => ({ id: source._id.toString(), title: source.title, status: source.status, visibility: source.visibility })) };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toDeploymentResponse(doc: any): GovernanceDeploymentResponse {
    return { id: doc._id?.toString() ?? '', programId: doc.programId?.toString() ?? '', scopeId: doc.scopeId?.toString() ?? '', name: String(doc.name ?? ''), status: String(doc.status ?? ''), currentDraftRevisionId: doc.currentDraftRevisionId?.toString(), currentPublishedRevisionId: doc.currentPublishedRevisionId?.toString(), channels: (doc.channels as Record<string, unknown>) ?? {}, createdAt: this.toIso(doc.createdAt), updatedAt: this.toIso(doc.updatedAt) };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toRevisionResponse(doc: any): GovernanceRevisionResponse {
    const agentId = doc.agentId?.toString() ?? '';
    return { id: doc._id?.toString() ?? '', deploymentId: doc.deploymentId?.toString() ?? '', revisionNumber: Number(doc.revisionNumber), status: String(doc.status ?? ''), agentId, allowedAgentIds: this.toStrings(doc.allowedAgentIds).length ? this.toStrings(doc.allowedAgentIds) : [agentId].filter(Boolean), workspaceIds: this.toStrings(doc.workspaceIds), sourceIds: this.toStrings(doc.sourceIds), includedSourceIds: this.toStrings(doc.includedSourceIds), excludedSourceIds: this.toStrings(doc.excludedSourceIds), sourceSnapshot: doc.sourceSnapshot ?? {}, workspaceBindingSnapshot: doc.workspaceBindingSnapshot ?? {}, configurationFingerprint: doc.configurationFingerprint, scopeSnapshot: doc.scopeSnapshot ?? {}, audienceSnapshot: doc.audienceSnapshot ?? {}, previousAudienceSnapshot: doc.previousAudienceSnapshot ?? {}, createdBy: doc.createdBy?.toString() ?? '', publishedBy: doc.publishedBy?.toString(), publishedAt: this.toOptionalIso(doc.publishedAt), createdAt: this.toIso(doc.createdAt), updatedAt: this.toIso(doc.updatedAt) };
  }

  private normalizeAllowedAgentIds(primaryAgentId: string, allowedAgentIds?: string[]): string[] {
    return [...new Set([primaryAgentId, ...(allowedAgentIds?.length ? allowedAgentIds : [primaryAgentId])])];
  }

  private async assertAgentsBelongToScope(actorId: string, programId: string, scopeId: string, agentIds: string[]): Promise<void> {
    const scope = await this.scopeService.findById(actorId, programId, scopeId);
    const mappedAgentIds = new Set(scope.agentIds);
    if (agentIds.some((agentId) => !mappedAgentIds.has(agentId))) {
      throw new BadRequestException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED, 'Every published assistant must be mapped to the scope');
    }
  }

  private async assertWorkspacesBelongToScope(programId: string, scopeId: string, workspaceIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(workspaceIds)];
    if (!uniqueIds.length) return;
    const matched = await this.sourceModel.distinct('workspaceId', {
      programId: new Types.ObjectId(programId),
      workspaceId: { $in: this.toObjectIds(uniqueIds) },
      isArchived: false,
      $or: [{ scopeIds: new Types.ObjectId(scopeId) }, { ownerScopeId: new Types.ObjectId(scopeId) }, { visibility: 'program_shared' }],
    }).exec();
    if (new Set(matched.map(String)).size !== uniqueIds.length) throw new BadRequestException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED, 'Every workspace must be mapped to this scope before it can be published');
  }

  private toObjectIds(ids?: string[]): Types.ObjectId[] { return (ids ?? []).map((id) => new Types.ObjectId(id)); }
  private toStrings(value: unknown): string[] { return Array.isArray(value) ? value.map((id) => id.toString()) : []; }
  private toIso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value ?? ''); }
  private toOptionalIso(value: unknown): string | undefined { return value ? this.toIso(value) : undefined; }
}
