import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { GovernanceDeployment, GovernanceDeploymentDocument } from '../schemas/governance-deployment.schema';
import { GovernanceDeploymentRevision, GovernanceDeploymentRevisionDocument } from '../schemas/governance-deployment-revision.schema';
import { GovernanceScope, GovernanceScopeDocument } from '../schemas/governance-scope.schema';
import { GovernanceWorkspaceBinding, GovernanceWorkspaceBindingDocument } from '../schemas/governance-workspace-binding.schema';

type AudienceSnapshot = { mode: 'all_authenticated' | 'restricted'; userIds: string[]; groupIds: string[] };

export interface PrepareGovernanceDraftOptions {
  previousAudience?: AudienceSnapshot;
}

@Injectable()
export class GovernanceDraftPreparationService {
  constructor(
    @InjectModel(GovernanceScope.name) private readonly scopeModel: Model<GovernanceScopeDocument>,
    @InjectModel(GovernanceWorkspaceBinding.name) private readonly bindingModel: Model<GovernanceWorkspaceBindingDocument>,
    @InjectModel(GovernanceDeployment.name) private readonly deploymentModel: Model<GovernanceDeploymentDocument>,
    @InjectModel(GovernanceDeploymentRevision.name) private readonly revisionModel: Model<GovernanceDeploymentRevisionDocument>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async prepare(actorId: string, actorEmail: string, programId: string, scopeId: string, options: PrepareGovernanceDraftOptions = {}): Promise<void> {
    const [scope, deployment, bindings] = await Promise.all([
      this.scopeModel.findOne({ _id: new Types.ObjectId(scopeId), programId: new Types.ObjectId(programId) }).lean().exec(),
      this.deploymentModel.findOne({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId) }).exec(),
      this.bindingModel.find({ programId: new Types.ObjectId(programId), enabled: true, $or: [{ visibility: 'program_shared' }, { scopeIds: new Types.ObjectId(scopeId) }] }).select('_id workspaceId visibility ingestionMode defaults').lean().exec(),
    ]);
    if (!scope || !deployment || deployment.status === 'archived') return;

    const allowedAgentIds = (scope.agentIds ?? []).map(String);
    const workspaceIds = [...new Set(bindings.map((binding) => binding.workspaceId.toString()))].sort();
    const workspaceBindingSnapshot = Object.fromEntries(bindings.map((binding) => [binding._id.toString(), { workspaceId: binding.workspaceId.toString(), visibility: binding.visibility, ingestionMode: binding.ingestionMode, defaults: binding.defaults ?? {} }] as const).sort(([a], [b]) => a.localeCompare(b)));
    const scopeSnapshot = {
      name: scope.name,
      type: scope.type,
      status: scope.status,
      classification: (scope.metadata as { classification?: Record<string, unknown> } | undefined)?.classification ?? {},
    };
    const audienceSnapshot = this.toAudienceSnapshot(scope.audience);
    const configuration = { allowedAgentIds: [...allowedAgentIds].sort(), workspaceIds, workspaceBindingSnapshot, scopeSnapshot, audienceSnapshot };
    const configurationFingerprint = createHash('sha256').update(JSON.stringify(configuration)).digest('hex');
    const currentDraft = deployment.currentDraftRevisionId ? await this.revisionModel.findById(deployment.currentDraftRevisionId).lean().exec() : null;
    if (currentDraft?.configurationFingerprint === configurationFingerprint) return;

    const existingRevisionCount = await this.revisionModel.countDocuments({ deploymentId: deployment._id });
    await this.deploymentModel.updateOne({ _id: deployment._id }, { $max: { revisionSequence: existingRevisionCount } }).exec();
    const sequencedDeployment = await this.deploymentModel.findOneAndUpdate(
      { _id: deployment._id, currentDraftRevisionId: deployment.currentDraftRevisionId },
      { $inc: { revisionSequence: 1 } },
      { new: true },
    ).exec();
    if (!sequencedDeployment) return this.prepare(actorId, actorEmail, programId, scopeId, options);
    const revisionNumber = sequencedDeployment.revisionSequence;
    const revision = await this.revisionModel.create({
      deploymentId: deployment._id,
      revisionNumber,
      status: 'draft',
      agentId: allowedAgentIds[0] ? new Types.ObjectId(allowedAgentIds[0]) : undefined,
      allowedAgentIds: allowedAgentIds.map((id) => new Types.ObjectId(id)),
      workspaceIds: workspaceIds.map((id) => new Types.ObjectId(id)),
      agentSnapshot: {},
      workspaceBindingSnapshot,
      channelSnapshot: deployment.channels ?? {},
      configurationFingerprint,
      scopeSnapshot,
      audienceSnapshot,
      previousAudienceSnapshot: currentDraft?.previousAudienceSnapshot && Object.keys(currentDraft.previousAudienceSnapshot).length > 0
        ? currentDraft.previousAudienceSnapshot
        : (options.previousAudience ?? {}),
      createdBy: new Types.ObjectId(actorId),
    });
    const draftSwap = await this.deploymentModel.updateOne({ _id: deployment._id, revisionSequence: revisionNumber }, { $set: { currentDraftRevisionId: revision._id } }).exec();
    if (draftSwap.modifiedCount !== 1) {
      await this.revisionModel.deleteOne({ _id: revision._id, status: 'draft' }).exec();
      return this.prepare(actorId, actorEmail, programId, scopeId, options);
    }
    await Promise.all([
      this.scopeModel.updateOne({ _id: scope._id }, {
        $set: {
          'metadata.review.status': 'in_review',
        },
      }).exec(),
    ]);
    this.auditLogService.logSuccess({
      actorId,
      actorEmail,
      action: 'governance.revision.prepared',
      targetType: 'governance_revision',
      targetId: revision._id.toString(),
      metadata: { programId, scopeId, deploymentId: deployment._id.toString(), configurationFingerprint },
    });
  }

  private toAudienceSnapshot(audience: { mode?: string; userIds?: Types.ObjectId[]; groupIds?: Types.ObjectId[] } | undefined): AudienceSnapshot {
    return {
      mode: audience?.mode === 'all_authenticated' ? 'all_authenticated' : 'restricted',
      userIds: (audience?.userIds ?? []).map(String).sort(),
      groupIds: (audience?.groupIds ?? []).map(String).sort(),
    };
  }
}
