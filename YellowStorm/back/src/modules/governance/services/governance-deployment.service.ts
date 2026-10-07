import { Injectable, Optional } from '@nestjs/common';
import { GovernanceRootPublicationService } from './governance-root-publication.service';
import { assertNoClientRootWork } from './governance-root-snapshot';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { CreateGovernanceDeploymentDto, CreateGovernanceRevisionDto, PublishGovernanceDeploymentDto, UpdateGovernanceDeploymentDto, UpdateGovernanceRevisionDto } from '../dto';
import {          
  type GovernanceDeploymentRecord,           
  type GovernanceRevisionRecord,           
  type RevisionStore,            PASSTHROUGH_TRANSACTION} from '../persistence';
import type { GovernancePublicationAttemptStatus } from '../domain/governance-types';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceScopeService } from './governance-scope.service';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceDraftPreparationService } from './governance-draft-preparation.service';
import { PgGovernanceTransactionRunner } from '../persistence/postgres/pg-transaction-runner';
import { PgPublicationAttemptStore } from '../persistence/postgres/pg-publication-attempt.store';
import { PgDryRunStore } from '../persistence/postgres/pg-dry-run.store';
import { PgRevisionStore } from '../persistence/postgres/pg-revision.store';
import { PgDeploymentStore } from '../persistence/postgres/pg-deployment.store';
import { PgBindingStore } from '../persistence/postgres/pg-binding.store';

export interface GovernanceDeploymentResponse { id: string; programId: string; scopeId: string; name: string; status: string; currentDraftRevisionId?: string; currentPublishedRevisionId?: string; channels: Record<string, unknown>; createdAt: string; updatedAt: string }
export interface GovernanceRevisionResponse { id: string; deploymentId: string; revisionNumber: number; status: string; agentId: string; allowedAgentIds: string[]; workspaceIds: string[]; workspaceBindingSnapshot: Record<string, unknown>; configurationFingerprint?: string; scopeSnapshot: Record<string, unknown>; audienceSnapshot: Record<string, unknown>; previousAudienceSnapshot: Record<string, unknown>; createdBy: string; publishedBy?: string; publishedAt?: string; createdAt: string; updatedAt: string }
export interface GovernanceReadiness { deploymentId: string; score: number; status: 'ready' | 'blocked' | 'warning'; blockers: GovernanceReadinessCheck[]; warnings: GovernanceReadinessCheck[]; checks: GovernanceReadinessCheck[] }
export interface GovernanceReadinessCheck { key: string; label: string; status: 'passed' | 'warning' | 'failed'; severity: 'info' | 'warning' | 'blocking'; message?: string; targetType?: string; targetId?: string }

@Injectable()
export class GovernanceDeploymentService {
  constructor(
    private readonly deploymentStore: PgDeploymentStore,
    private readonly revisionStore: PgRevisionStore,
    private readonly dryRunStore: PgDryRunStore,
    private readonly bindingStore: PgBindingStore,
    private readonly attemptStore: PgPublicationAttemptStore,
    private readonly programService: GovernanceProgramService,
    private readonly scopeService: GovernanceScopeService,
    private readonly accessService: GovernanceAccessService,
    private readonly auditLogService: AuditLogService,
    private readonly draftPreparationService: GovernanceDraftPreparationService,
    private readonly tx: PgGovernanceTransactionRunner = PASSTHROUGH_TRANSACTION as unknown as PgGovernanceTransactionRunner,
    @Optional() private readonly rootPublication?: GovernanceRootPublicationService,
  ) {}

  async create(actorId: string, actorEmail: string, programId: string, dto: CreateGovernanceDeploymentDto): Promise<GovernanceDeploymentResponse> {
    const scope = await this.scopeService.findById(actorId, programId, dto.scopeId);
    await this.accessService.assertScopeAccess(actorId, programId, dto.scopeId);
    const duplicate = await this.deploymentStore.findByProgramAndScope(programId, dto.scopeId);
    if (duplicate) throw new ConflictException(ErrorCode.GOVERNANCE_DEPLOYMENT_EXISTS);
    const deployment = await this.deploymentStore.insert({ programId, scopeId: dto.scopeId, name: dto.name.trim(), channels: dto.channels ?? {} });
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.deployment.created', targetType: 'governance_deployment', targetId: deployment.id, metadata: { programId, scopeId: dto.scopeId } });
    if (scope.agentIds.length > 0) await this.draftPreparationService.prepare(actorId, actorEmail, programId, dto.scopeId);
    return this.toDeploymentResponse(deployment);
  }

  async list(actorId: string, programId: string): Promise<GovernanceDeploymentResponse[]> {
    await this.programService.assertOwnedProgram(actorId, programId);
    const accessibleScopeIds = await this.accessService.getAccessibleScopeIds(actorId, programId);
    const deployments = await this.deploymentStore.listByProgramScopes(programId, accessibleScopeIds.includes('*') ? '*' : accessibleScopeIds);
    return deployments.map((deployment) => this.toDeploymentResponse(deployment));
  }

  async findById(actorId: string, deploymentId: string): Promise<GovernanceDeploymentResponse> {
    const deployment = await this.findOwnedDeployment(actorId, deploymentId);
    return this.toDeploymentResponse(deployment);
  }

  async update(actorId: string, deploymentId: string, dto: UpdateGovernanceDeploymentDto): Promise<GovernanceDeploymentResponse> {
    const deployment = await this.findOwnedDeployment(actorId, deploymentId);
    const updated = await this.deploymentStore.update(deployment.id, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.channels !== undefined ? { channels: dto.channels } : {}),
    });
    if (!updated) throw new NotFoundException(ErrorCode.GOVERNANCE_DEPLOYMENT_NOT_FOUND);
    return this.toDeploymentResponse(updated);
  }

  async createRevision(actorId: string, actorEmail: string, deploymentId: string, dto: CreateGovernanceRevisionDto): Promise<GovernanceRevisionResponse> {
    assertNoClientRootWork(dto.agentSnapshot);
    const deployment = await this.findOwnedDeployment(actorId, deploymentId);
    if (deployment.status === 'archived') throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
    const allowedAgentIds = this.normalizeAllowedAgentIds(dto.agentId, dto.allowedAgentIds);
    await this.assertAgentsBelongToScope(actorId, deployment.programId, deployment.scopeId, allowedAgentIds);
    await this.assertWorkspacesBelongToScope(deployment.programId, deployment.scopeId, dto.workspaceIds ?? []);
    // Revision insert and the deployment's draft pointer move together.
    const revision = await this.tx.run(async () => {
      const revisionNumber = (await this.revisionStore.countByDeployment(deployment.id)) + 1;
      const inserted = await this.revisionStore.insert({
        deploymentId: deployment.id,
        revisionNumber,
        agentId: dto.agentId,
        allowedAgentIds,
        workspaceIds: dto.workspaceIds,
        agentSnapshot: dto.agentSnapshot ?? {},
        channelSnapshot: (deployment.channels as Record<string, unknown>) ?? {},
        createdBy: actorId,
      });
      await this.deploymentStore.update(deployment.id, {
        currentDraftRevisionId: inserted.id,
        ...(deployment.status !== 'published' ? { status: 'dry_run' as const } : {}),
      });
      return inserted;
    });
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.revision.created', targetType: 'governance_revision', targetId: revision.id, metadata: { deploymentId } });
    return this.toRevisionResponse(revision);
  }

  async listRevisions(actorId: string, deploymentId: string): Promise<GovernanceRevisionResponse[]> {
    await this.findOwnedDeployment(actorId, deploymentId);
    const revisions = await this.revisionStore.listByDeployment(deploymentId);
    return revisions.map((revision) => this.toRevisionResponse(revision));
  }

  async updateRevision(actorId: string, deploymentId: string, revisionId: string, dto: UpdateGovernanceRevisionDto): Promise<GovernanceRevisionResponse> {
    assertNoClientRootWork(dto.agentSnapshot);
    await this.findOwnedDeployment(actorId, deploymentId);
    const revision = await this.revisionStore.findByDeploymentAndId(deploymentId, revisionId);
    if (!revision) throw new NotFoundException(ErrorCode.GOVERNANCE_REVISION_NOT_FOUND);
    if (revision.status === 'published') throw new ConflictException(ErrorCode.GOVERNANCE_REVISION_IMMUTABLE);
    const patch: Parameters<RevisionStore['update']>[1] = {};
    if (dto.agentId !== undefined) patch.agentId = dto.agentId;
    if (dto.agentId !== undefined || dto.allowedAgentIds !== undefined) {
      const primaryAgentId = dto.agentId ?? revision.agentId ?? '';
      const allowedAgentIds = this.normalizeAllowedAgentIds(primaryAgentId, dto.allowedAgentIds ?? revision.allowedAgentIds);
      const deployment = await this.deploymentStore.findById(deploymentId);
      if (!deployment) throw new NotFoundException(ErrorCode.GOVERNANCE_DEPLOYMENT_NOT_FOUND);
      await this.assertAgentsBelongToScope(actorId, deployment.programId, deployment.scopeId, allowedAgentIds);
      patch.allowedAgentIds = allowedAgentIds;
    }
    if (dto.workspaceIds !== undefined) {
      const deployment = await this.deploymentStore.findById(deploymentId);
      if (!deployment) throw new NotFoundException(ErrorCode.GOVERNANCE_DEPLOYMENT_NOT_FOUND);
      await this.assertWorkspacesBelongToScope(deployment.programId, deployment.scopeId, dto.workspaceIds);
      patch.workspaceIds = dto.workspaceIds;
    }
    if (dto.agentSnapshot !== undefined) patch.agentSnapshot = dto.agentSnapshot;
    const updated = await this.revisionStore.update(revision.id, patch);
    if (!updated) throw new NotFoundException(ErrorCode.GOVERNANCE_REVISION_NOT_FOUND);
    return this.toRevisionResponse(updated);
  }

  async getReadiness(actorId: string, deploymentId: string): Promise<GovernanceReadiness> {
    const deployment = await this.findOwnedDeployment(actorId, deploymentId);
    return this.buildReadiness(deploymentId, deployment);
  }

  async publish(actorId: string, actorEmail: string, deploymentId: string, dto: PublishGovernanceDeploymentDto): Promise<GovernanceDeploymentResponse> {
    const deployment = await this.findOwnedDeployment(actorId, deploymentId);
    await this.accessService.assertScopeRole(actorId, deployment.programId, deployment.scopeId, ['scope_approver']);
    let readiness: GovernanceReadiness | undefined;
    const revisionId = dto.revisionId ?? deployment.currentDraftRevisionId;
    try {
      if (deployment.status === 'archived') throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
      const scope = await this.scopeService.findById(actorId, deployment.programId, deployment.scopeId);
      if (scope.status !== 'active') throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
      readiness = await this.buildReadiness(deploymentId, deployment);
      if (readiness.blockers.length > 0 && !dto.allowPartial) {
        await this.createPublicationAttempt(actorId, actorEmail, deployment, revisionId, dto, 'blocked', readiness, ErrorCode.GOVERNANCE_PUBLISH_BLOCKED, 'Readiness blockers prevent publication');
        this.auditLogService.logFailure({ actorId, actorEmail, action: 'governance.deployment.published', targetType: 'governance_deployment', targetId: deploymentId, failureReason: 'Readiness blockers prevent publication', metadata: { blockers: readiness.blockers.map((blocker) => blocker.key) } });
        throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
      }
      if (!revisionId) throw new ConflictException(ErrorCode.GOVERNANCE_NO_DRAFT_REVISION);
      if (revisionId !== deployment.currentDraftRevisionId) throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
      if (deployment.currentPublishedRevisionId === revisionId) throw new ConflictException(ErrorCode.GOVERNANCE_REVISION_IMMUTABLE);
      const revision = await this.revisionStore.findByDeploymentAndId(deploymentId, revisionId);
      if (!revision) throw new NotFoundException(ErrorCode.GOVERNANCE_REVISION_NOT_FOUND);
      if (revision.status === 'published' || revision.status === 'rejected') throw new ConflictException(ErrorCode.GOVERNANCE_REVISION_IMMUTABLE);
      if (!revision.agentId || !revision.allowedAgentIds?.length) throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
      await this.assertAgentsBelongToScope(actorId, deployment.programId, deployment.scopeId, revision.allowedAgentIds);
      await this.assertWorkspacesBelongToScope(deployment.programId, deployment.scopeId, revision.workspaceIds);
      if (!this.rootPublication) throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
      const rootWork = await this.rootPublication.capture(actorId, revision);
      const { rootWork: _untrustedRootWork, ...agentSnapshot } = revision.agentSnapshot ?? {};
      // Revision status and the deployment's published pointer commit together; a lost
      // publish race throws and rolls the revision status back.
      const publishDeployment = await this.tx.run(async () => {
        await this.rootPublication!.assertUnchanged(rootWork, revision, actorId);
        const committed = await this.revisionStore.update(revision.id, { status: 'published', publishedBy: actorId, publishedAt: new Date(),
          agentSnapshot: { ...agentSnapshot, ...(rootWork ? { rootWork } : {}) } }, revision);
        if (!committed) throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
        const published = await this.deploymentStore.publishGuarded(deployment.id, revisionId, revision.id);
        if (published) return published;
        const observedDeployment = await this.deploymentStore.findById(deployment.id);
        if (observedDeployment?.currentPublishedRevisionId === revision.id) return observedDeployment;
        throw new ConflictException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED);
      });
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
    const deployment = await this.findOwnedDeployment(actorId, deploymentId);
    if (!deployment.currentPublishedRevisionId || deployment.status !== 'published') throw new ConflictException(ErrorCode.GOVERNANCE_NO_PUBLISHED_REVISION);
    const updated = await this.deploymentStore.update(deployment.id, { status: 'suspended' });
    if (!updated) throw new NotFoundException(ErrorCode.GOVERNANCE_DEPLOYMENT_NOT_FOUND);
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.deployment.suspended', targetType: 'governance_deployment', targetId: deploymentId, metadata: { programId: deployment.programId } });
    return this.toDeploymentResponse(updated);
  }

  async rollback(actorId: string, actorEmail: string, deploymentId: string): Promise<GovernanceDeploymentResponse> {
    const deployment = await this.findOwnedDeployment(actorId, deploymentId);
    if (!deployment.currentPublishedRevisionId) throw new ConflictException(ErrorCode.GOVERNANCE_NO_PUBLISHED_REVISION);
    const previous = await this.revisionStore.findPreviousPublished(deploymentId, deployment.currentPublishedRevisionId);
    if (!previous) throw new ConflictException(ErrorCode.GOVERNANCE_NO_PUBLISHED_REVISION);
    const updated = await this.deploymentStore.update(deployment.id, { currentPublishedRevisionId: previous.id, status: 'published' });
    if (!updated) throw new NotFoundException(ErrorCode.GOVERNANCE_DEPLOYMENT_NOT_FOUND);
    this.auditLogService.logSuccess({ actorId, actorEmail, action: 'governance.deployment.rollback', targetType: 'governance_deployment', targetId: deploymentId, metadata: { revisionId: previous.id } });
    return this.toDeploymentResponse(updated);
  }

  async resolveContext(actorId: string, deploymentId: string): Promise<Record<string, unknown>> {
    const deployment = await this.findOwnedDeployment(actorId, deploymentId);
    if (deployment.status !== 'published') throw new BadRequestException(ErrorCode.GOVERNANCE_NO_PUBLISHED_REVISION);
    if (!deployment.currentPublishedRevisionId) throw new BadRequestException(ErrorCode.GOVERNANCE_NO_PUBLISHED_REVISION);
    const revision = await this.revisionStore.findById(deployment.currentPublishedRevisionId);
    if (!revision) throw new NotFoundException(ErrorCode.GOVERNANCE_REVISION_NOT_FOUND);
    return { programId: deployment.programId, scopeId: deployment.scopeId, deploymentId, revisionId: revision.id, agentId: revision.agentId ?? '', workspaceIds: revision.workspaceIds, channels: deployment.channels };
  }

  private async findOwnedDeployment(actorId: string, deploymentId: string): Promise<GovernanceDeploymentRecord> {
    const deployment = await this.deploymentStore.findById(deploymentId);
    if (!deployment) throw new NotFoundException(ErrorCode.GOVERNANCE_DEPLOYMENT_NOT_FOUND);
    await this.programService.assertOwnedProgram(actorId, deployment.programId);
    await this.accessService.assertScopeAccess(actorId, deployment.programId, deployment.scopeId);
    return deployment;
  }

  private async buildReadiness(deploymentId: string, deployment: GovernanceDeploymentRecord): Promise<GovernanceReadiness> {
    const checks = await this.buildReadinessChecks(deployment);
    const blockers = checks.filter((check) => check.severity === 'blocking' && check.status === 'failed');
    const warnings = checks.filter((check) => check.severity === 'warning' && check.status !== 'passed');
    const score = Math.max(0, Math.round((checks.filter((check) => check.status === 'passed').length / checks.length) * 100));
    return { deploymentId, score, status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ready', blockers, warnings, checks };
  }

  private async buildReadinessChecks(deployment: GovernanceDeploymentRecord): Promise<GovernanceReadinessCheck[]> {
    const passedDryRun = deployment.currentDraftRevisionId
      ? await this.dryRunStore.findPassedByDeploymentAndRevision(deployment.id, deployment.currentDraftRevisionId)
      : null;
    return [
      { key: 'draft_revision', label: 'Draft revision', status: deployment.currentDraftRevisionId ? 'passed' : 'failed', severity: 'blocking', targetType: 'rule' },
      { key: 'dry_run_passed', label: 'Dry-run passed', status: passedDryRun ? 'passed' : 'failed', severity: 'blocking', targetType: 'dry_run' },
      { key: 'published_revision', label: 'Published revision', status: deployment.currentPublishedRevisionId ? 'passed' : 'warning', severity: 'warning', targetType: 'rule' },
    ];
  }

  private async createPublicationAttempt(actorId: string, actorEmail: string, deployment: GovernanceDeploymentRecord, revisionId: string | undefined, dto: PublishGovernanceDeploymentDto, status: GovernancePublicationAttemptStatus, readiness?: GovernanceReadiness, errorCode?: string, errorMessage?: string): Promise<void> {
    await this.attemptStore.insert({
      programId: deployment.programId,
      scopeId: deployment.scopeId,
      deploymentId: deployment.id,
      revisionId,
      triggeredByUserId: actorId,
      triggeredByEmail: actorEmail,
      requestedChannels: dto.channels ?? [],
      allowPartial: Boolean(dto.allowPartial),
      comment: dto.comment,
      status,
      readinessSnapshot: (readiness ?? {}) as Record<string, unknown>,
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

  private toDeploymentResponse(doc: GovernanceDeploymentRecord): GovernanceDeploymentResponse {
    return { id: doc.id, programId: doc.programId, scopeId: doc.scopeId, name: String(doc.name ?? ''), status: String(doc.status ?? ''), currentDraftRevisionId: doc.currentDraftRevisionId, currentPublishedRevisionId: doc.currentPublishedRevisionId, channels: (doc.channels as Record<string, unknown>) ?? {}, createdAt: this.toIso(doc.createdAt), updatedAt: this.toIso(doc.updatedAt) };
  }

  private toRevisionResponse(doc: GovernanceRevisionRecord): GovernanceRevisionResponse {
    const agentId = doc.agentId ?? '';
    return { id: doc.id, deploymentId: doc.deploymentId, revisionNumber: Number(doc.revisionNumber), status: String(doc.status ?? ''), agentId, allowedAgentIds: doc.allowedAgentIds.length ? doc.allowedAgentIds : [agentId].filter(Boolean), workspaceIds: doc.workspaceIds, workspaceBindingSnapshot: doc.workspaceBindingSnapshot ?? {}, configurationFingerprint: doc.configurationFingerprint, scopeSnapshot: doc.scopeSnapshot ?? {}, audienceSnapshot: doc.audienceSnapshot ?? {}, previousAudienceSnapshot: doc.previousAudienceSnapshot ?? {}, createdBy: doc.createdBy, publishedBy: doc.publishedBy, publishedAt: this.toOptionalIso(doc.publishedAt), createdAt: this.toIso(doc.createdAt), updatedAt: this.toIso(doc.updatedAt) };
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
    const matched = await this.bindingStore.filterWorkspaceIdsBoundToScope(programId, uniqueIds, scopeId);
    if (new Set(matched).size !== uniqueIds.length) throw new BadRequestException(ErrorCode.GOVERNANCE_PUBLISH_BLOCKED, 'Every workspace must be mapped to this scope before it can be published');
  }

  private toIso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value ?? ''); }
  private toOptionalIso(value: unknown): string | undefined { return value ? this.toIso(value) : undefined; }
}
