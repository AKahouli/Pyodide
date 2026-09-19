import { createHash } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import {
  BINDING_STORE,
  DEPLOYMENT_STORE,
  REVISION_STORE,
  SCOPE_STORE,
  type BindingStore,
  type DeploymentStore,
  type GovernanceRevisionRecord,
  type RevisionStore,
  type ScopeStore,
} from '../persistence';

type AudienceSnapshot = { mode: 'all_authenticated' | 'restricted'; userIds: string[]; groupIds: string[] };

export interface PrepareGovernanceDraftOptions {
  previousAudience?: AudienceSnapshot;
}

@Injectable()
export class GovernanceDraftPreparationService {
  constructor(
    @Inject(SCOPE_STORE) private readonly scopeStore: ScopeStore,
    @Inject(BINDING_STORE) private readonly bindingStore: BindingStore,
    @Inject(DEPLOYMENT_STORE) private readonly deploymentStore: DeploymentStore,
    @Inject(REVISION_STORE) private readonly revisionStore: RevisionStore,
    private readonly auditLogService: AuditLogService,
  ) {}

  async prepare(actorId: string, actorEmail: string, programId: string, scopeId: string, options: PrepareGovernanceDraftOptions = {}): Promise<void> {
    const [scope, deployment, bindings] = await Promise.all([
      this.scopeStore.findByProgramAndId(programId, scopeId),
      this.deploymentStore.findByProgramAndScope(programId, scopeId),
      this.bindingStore.listEnabled(programId, [scopeId]),
    ]);
    if (!scope || !deployment || deployment.status === 'archived') return;

    const allowedAgentIds = scope.agentIds ?? [];
    const workspaceIds = [...new Set(bindings.map((binding) => binding.workspaceId))].sort();
    const workspaceBindingSnapshot = Object.fromEntries(bindings.map((binding) => [binding.id, { workspaceId: binding.workspaceId, visibility: binding.visibility, ingestionMode: binding.ingestionMode, defaults: binding.defaults ?? {} }] as const).sort(([a], [b]) => a.localeCompare(b)));
    const scopeSnapshot = {
      name: scope.name,
      type: scope.type,
      status: scope.status,
      classification: (scope.metadata as { classification?: Record<string, unknown> } | undefined)?.classification ?? {},
    };
    const audienceSnapshot = this.toAudienceSnapshot(scope.audience);
    const configuration = { allowedAgentIds: [...allowedAgentIds].sort(), workspaceIds, workspaceBindingSnapshot, scopeSnapshot, audienceSnapshot };
    const configurationFingerprint = createHash('sha256').update(JSON.stringify(configuration)).digest('hex');
    const currentDraft = deployment.currentDraftRevisionId ? await this.revisionStore.findById(deployment.currentDraftRevisionId) : null;
    if (currentDraft?.configurationFingerprint === configurationFingerprint) return;

    const existingRevisionCount = await this.revisionStore.countByDeployment(deployment.id);
    await this.deploymentStore.maxRevisionSequence(deployment.id, existingRevisionCount);
    const sequencedDeployment = await this.deploymentStore.incrementRevisionSequenceGuarded(deployment.id, deployment.currentDraftRevisionId ?? null);
    if (!sequencedDeployment) return this.prepare(actorId, actorEmail, programId, scopeId, options);
    const revisionNumber = sequencedDeployment.revisionSequence;
    const revision = await this.revisionStore.insert({
      deploymentId: deployment.id,
      revisionNumber,
      status: 'draft',
      agentId: allowedAgentIds[0],
      allowedAgentIds,
      workspaceIds,
      agentSnapshot: {},
      workspaceBindingSnapshot,
      channelSnapshot: (deployment.channels as Record<string, unknown>) ?? {},
      configurationFingerprint,
      scopeSnapshot,
      audienceSnapshot,
      previousAudienceSnapshot: this.previousAudienceFor(currentDraft, options),
      createdBy: actorId,
    });
    const draftSwapped = await this.deploymentStore.setDraftRevisionIfSequence(deployment.id, revisionNumber, revision.id);
    if (!draftSwapped) {
      await this.revisionStore.deleteByIdAndStatus(revision.id, 'draft');
      return this.prepare(actorId, actorEmail, programId, scopeId, options);
    }
    await this.scopeStore.setMetadataReviewStatus(scope.id, 'in_review');
    this.auditLogService.logSuccess({
      actorId,
      actorEmail,
      action: 'governance.revision.prepared',
      targetType: 'governance_revision',
      targetId: revision.id,
      metadata: { programId, scopeId, deploymentId: deployment.id, configurationFingerprint },
    });
  }

  /** Keeps the previous audience snapshot of the last draft when it is non-empty (documented Mongo behaviour). */
  private previousAudienceFor(currentDraft: GovernanceRevisionRecord | null, options: PrepareGovernanceDraftOptions): Record<string, unknown> {
    if (currentDraft?.previousAudienceSnapshot && Object.keys(currentDraft.previousAudienceSnapshot).length > 0) {
      return currentDraft.previousAudienceSnapshot;
    }
    return options.previousAudience ?? {};
  }

  private toAudienceSnapshot(audience: { mode?: string; userIds?: string[]; groupIds?: string[] } | undefined): AudienceSnapshot {
    return {
      mode: audience?.mode === 'all_authenticated' ? 'all_authenticated' : 'restricted',
      userIds: (audience?.userIds ?? []).map(String).sort(),
      groupIds: (audience?.groupIds ?? []).map(String).sort(),
    };
  }
}
