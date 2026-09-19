import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceDeployment, GovernanceDeploymentDocument } from './schemas/governance-deployment.schema';
import { DEPLOYMENT_STORE, type GovernanceDeploymentCreateInput, type GovernanceDeploymentPatch, type DeploymentStore } from '../deployment-store';
import type { GovernanceDeploymentRecord } from '../governance-records';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function deploymentToRecord(doc: Row): GovernanceDeploymentRecord {
  return {
    id: doc._id.toString(),
    programId: doc.programId.toString(),
    scopeId: doc.scopeId.toString(),
    name: doc.name,
    status: doc.status,
    currentDraftRevisionId: doc.currentDraftRevisionId?.toString(),
    currentPublishedRevisionId: doc.currentPublishedRevisionId?.toString(),
    revisionSequence: doc.revisionSequence ?? 0,
    channels: doc.channels ?? {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class MongoDeploymentStore implements DeploymentStore {
  constructor(@InjectModel(GovernanceDeployment.name) private readonly model: Model<GovernanceDeploymentDocument>) {}

  async insert(input: GovernanceDeploymentCreateInput): Promise<GovernanceDeploymentRecord> {
    const created = await this.model.create({
      programId: new Types.ObjectId(input.programId),
      scopeId: new Types.ObjectId(input.scopeId),
      name: input.name,
      status: 'draft',
      channels: input.channels ?? {},
    });
    return deploymentToRecord(created);
  }

  async findById(deploymentId: string): Promise<GovernanceDeploymentRecord | null> {
    const found = await this.model.findById(deploymentId).exec();
    return found ? deploymentToRecord(found) : null;
  }

  async findByProgramAndScope(programId: string, scopeId: string): Promise<GovernanceDeploymentRecord | null> {
    const found = await this.model.findOne({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId) }).exec();
    return found ? deploymentToRecord(found) : null;
  }

  async listByProgramScopes(programId: string, scopeIds: string[] | '*'): Promise<GovernanceDeploymentRecord[]> {
    const filter = scopeIds === '*' ? { programId: new Types.ObjectId(programId) } : { programId: new Types.ObjectId(programId), scopeId: { $in: scopeIds.map((id) => new Types.ObjectId(id)) } };
    const deployments = await this.model.find(filter).sort({ updatedAt: -1 }).lean().exec();
    return deployments.map(deploymentToRecord);
  }

  async listPublishedByScopes(scopeIds: string[]): Promise<GovernanceDeploymentRecord[]> {
    const deployments = await this.model
      .find({ scopeId: { $in: scopeIds.map((id) => new Types.ObjectId(id)) }, status: 'published', currentPublishedRevisionId: { $exists: true } })
      .lean()
      .exec();
    return deployments.map(deploymentToRecord);
  }

  async listByProgram(programId: string): Promise<GovernanceDeploymentRecord[]> {
    const deployments = await this.model.find({ programId: new Types.ObjectId(programId) }).lean().exec();
    return deployments.map(deploymentToRecord);
  }

  async update(deploymentId: string, patch: GovernanceDeploymentPatch): Promise<GovernanceDeploymentRecord | null> {
    const deployment = await this.model.findById(deploymentId).exec();
    if (!deployment) return null;
    if (patch.name !== undefined) deployment.name = patch.name;
    if (patch.channels !== undefined) deployment.channels = patch.channels as never;
    if (patch.status !== undefined) deployment.status = patch.status;
    if (patch.currentPublishedRevisionId !== undefined) deployment.currentPublishedRevisionId = new Types.ObjectId(patch.currentPublishedRevisionId);
    if (patch.currentDraftRevisionId !== undefined) deployment.currentDraftRevisionId = new Types.ObjectId(patch.currentDraftRevisionId);
    await deployment.save();
    return deploymentToRecord(deployment);
  }

  async suspendPublished(programId: string, scopeId: string): Promise<boolean> {
    const result = await this.model
      .updateOne({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId), status: 'published' }, { $set: { status: 'suspended' } })
      .exec();
    return result.modifiedCount > 0;
  }

  async publishGuarded(deploymentId: string, draftRevisionId: string, revisionId: string): Promise<GovernanceDeploymentRecord | null> {
    const updated = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(deploymentId), currentDraftRevisionId: new Types.ObjectId(draftRevisionId), currentPublishedRevisionId: { $ne: new Types.ObjectId(revisionId) } },
        { $set: { currentPublishedRevisionId: new Types.ObjectId(revisionId), status: 'published' } },
        { new: true },
      )
      .exec();
    return updated ? deploymentToRecord(updated) : null;
  }

  async maxRevisionSequence(deploymentId: string, min: number): Promise<void> {
    await this.model.updateOne({ _id: new Types.ObjectId(deploymentId) }, { $max: { revisionSequence: min } }).exec();
  }

  async incrementRevisionSequenceGuarded(deploymentId: string, expectedDraftRevisionId: string | null | undefined): Promise<GovernanceDeploymentRecord | null> {
    const filter: Record<string, unknown> = { _id: new Types.ObjectId(deploymentId) };
    // undefined = pointer unknown at read time — matches Mongoose stripping undefined filters.
    if (expectedDraftRevisionId !== undefined) filter.currentDraftRevisionId = expectedDraftRevisionId ? new Types.ObjectId(expectedDraftRevisionId) : null;
    const updated = await this.model.findOneAndUpdate(filter, { $inc: { revisionSequence: 1 } }, { new: true }).exec();
    return updated ? deploymentToRecord(updated) : null;
  }

  async setDraftRevisionIfSequence(deploymentId: string, revisionSequence: number, revisionId: string): Promise<boolean> {
    const result = await this.model
      .updateOne({ _id: new Types.ObjectId(deploymentId), revisionSequence }, { $set: { currentDraftRevisionId: new Types.ObjectId(revisionId) } })
      .exec();
    return result.modifiedCount === 1;
  }

  async deleteByProgramAndScope(programId: string, scopeId: string): Promise<void> {
    await this.model.deleteMany({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId) }).exec();
  }

  async deleteByIds(deploymentIds: string[]): Promise<void> {
    if (deploymentIds.length === 0) return;
    await this.model.deleteMany({ _id: { $in: deploymentIds.map((id) => new Types.ObjectId(id)) } }).exec();
  }
}
