import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceDeploymentRevision, GovernanceDeploymentRevisionDocument } from './schemas/governance-deployment-revision.schema';
import { REVISION_STORE, type GovernanceRevisionCreateInput, type GovernanceRevisionPatch, type RevisionStore } from '../revision-store';
import type { GovernanceRevisionRecord } from '../governance-records';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function revisionToRecord(doc: Row): GovernanceRevisionRecord {
  return {
    id: doc._id.toString(),
    deploymentId: doc.deploymentId.toString(),
    revisionNumber: doc.revisionNumber,
    status: doc.status,
    agentId: doc.agentId?.toString(),
    allowedAgentIds: (doc.allowedAgentIds ?? []).map((id: Types.ObjectId) => id.toString()),
    workspaceIds: (doc.workspaceIds ?? []).map((id: Types.ObjectId) => id.toString()),
    agentSnapshot: doc.agentSnapshot ?? {},
    workspaceBindingSnapshot: doc.workspaceBindingSnapshot ?? {},
    channelSnapshot: doc.channelSnapshot ?? {},
    scopeSnapshot: doc.scopeSnapshot ?? {},
    audienceSnapshot: doc.audienceSnapshot ?? {},
    previousAudienceSnapshot: doc.previousAudienceSnapshot ?? {},
    configurationFingerprint: doc.configurationFingerprint,
    createdBy: doc.createdBy.toString(),
    approvedBy: doc.approvedBy?.toString(),
    publishedBy: doc.publishedBy?.toString(),
    publishedAt: doc.publishedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function objectIds(ids: string[] | undefined): Types.ObjectId[] | undefined {
  return ids ? ids.map((id) => new Types.ObjectId(id)) : undefined;
}

@Injectable()
export class MongoRevisionStore implements RevisionStore {
  constructor(@InjectModel(GovernanceDeploymentRevision.name) private readonly model: Model<GovernanceDeploymentRevisionDocument>) {}

  async insert(input: GovernanceRevisionCreateInput): Promise<GovernanceRevisionRecord> {
    const created = await this.model.create({
      ...input,
      deploymentId: new Types.ObjectId(input.deploymentId),
      agentId: input.agentId ? new Types.ObjectId(input.agentId) : undefined,
      allowedAgentIds: objectIds(input.allowedAgentIds) ?? [],
      workspaceIds: objectIds(input.workspaceIds) ?? [],
      createdBy: new Types.ObjectId(input.createdBy),
    });
    return revisionToRecord(created);
  }

  async countByDeployment(deploymentId: string): Promise<number> {
    return this.model.countDocuments({ deploymentId: new Types.ObjectId(deploymentId) });
  }

  async findById(revisionId: string): Promise<GovernanceRevisionRecord | null> {
    const found = await this.model.findById(revisionId).lean().exec();
    return found ? revisionToRecord(found) : null;
  }

  async findByDeploymentAndId(deploymentId: string, revisionId: string): Promise<GovernanceRevisionRecord | null> {
    const found = await this.model.findOne({ _id: new Types.ObjectId(revisionId), deploymentId: new Types.ObjectId(deploymentId) }).exec();
    return found ? revisionToRecord(found) : null;
  }

  async listByDeployment(deploymentId: string): Promise<GovernanceRevisionRecord[]> {
    const revisions = await this.model.find({ deploymentId: new Types.ObjectId(deploymentId) }).sort({ revisionNumber: -1 }).lean().exec();
    return revisions.map(revisionToRecord);
  }

  async listByIds(revisionIds: string[]): Promise<GovernanceRevisionRecord[]> {
    if (revisionIds.length === 0) return [];
    const revisions = await this.model.find({ _id: { $in: revisionIds.map((id) => new Types.ObjectId(id)) } }).lean().exec();
    return revisions.map(revisionToRecord);
  }

  async update(revisionId: string, patch: GovernanceRevisionPatch): Promise<GovernanceRevisionRecord | null> {
    const revision = await this.model.findById(revisionId).exec();
    if (!revision) return null;
    if (patch.agentId !== undefined) revision.agentId = new Types.ObjectId(patch.agentId);
    if (patch.allowedAgentIds !== undefined) revision.allowedAgentIds = patch.allowedAgentIds.map((id) => new Types.ObjectId(id));
    if (patch.workspaceIds !== undefined) revision.workspaceIds = patch.workspaceIds.map((id) => new Types.ObjectId(id));
    if (patch.agentSnapshot !== undefined) revision.agentSnapshot = patch.agentSnapshot;
    if (patch.status !== undefined) revision.status = patch.status;
    if (patch.publishedBy !== undefined) revision.publishedBy = patch.publishedBy ? new Types.ObjectId(patch.publishedBy) : undefined;
    if (patch.publishedAt !== undefined) revision.publishedAt = patch.publishedAt ?? undefined;
    await revision.save();
    return revisionToRecord(revision);
  }

  async findPreviousPublished(deploymentId: string, excludeRevisionId: string): Promise<GovernanceRevisionRecord | null> {
    const found = await this.model
      .findOne({ deploymentId: new Types.ObjectId(deploymentId), status: 'published', _id: { $ne: new Types.ObjectId(excludeRevisionId) } })
      .sort({ publishedAt: -1 })
      .exec();
    return found ? revisionToRecord(found) : null;
  }

  async deleteByIdAndStatus(revisionId: string, status: GovernanceRevisionRecord['status']): Promise<boolean> {
    const result = await this.model.deleteOne({ _id: new Types.ObjectId(revisionId), status }).exec();
    return result.deletedCount === 1;
  }

  async deleteByDeploymentIds(deploymentIds: string[]): Promise<void> {
    if (deploymentIds.length === 0) return;
    await this.model.deleteMany({ deploymentId: { $in: deploymentIds.map((id) => new Types.ObjectId(id)) } }).exec();
  }
}
