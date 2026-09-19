import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceDryRun, GovernanceDryRunDocument } from './schemas/governance-dry-run.schema';
import { DRY_RUN_STORE, type GovernanceDryRunCreateInput, type GovernanceDryRunPatch, type DryRunStore } from '../dry-run-store';
import type { GovernanceDryRunRecord } from '../governance-records';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function dryRunToRecord(doc: Row): GovernanceDryRunRecord {
  return {
    id: doc._id.toString(),
    programId: doc.programId.toString(),
    scopeId: doc.scopeId.toString(),
    deploymentId: doc.deploymentId.toString(),
    revisionId: doc.revisionId.toString(),
    conversationId: doc.conversationId?.toString(),
    testerId: doc.testerId.toString(),
    status: doc.status,
    executionMode: doc.executionMode,
    testCases: doc.testCases ?? [],
    checks: doc.checks ?? {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class MongoDryRunStore implements DryRunStore {
  constructor(@InjectModel(GovernanceDryRun.name) private readonly model: Model<GovernanceDryRunDocument>) {}

  async insert(input: GovernanceDryRunCreateInput): Promise<GovernanceDryRunRecord> {
    const created = await this.model.create({
      ...input,
      programId: new Types.ObjectId(input.programId),
      scopeId: new Types.ObjectId(input.scopeId),
      deploymentId: new Types.ObjectId(input.deploymentId),
      revisionId: new Types.ObjectId(input.revisionId),
      conversationId: input.conversationId ? new Types.ObjectId(input.conversationId) : undefined,
      testerId: new Types.ObjectId(input.testerId),
    });
    return dryRunToRecord(created);
  }

  async findById(dryRunId: string): Promise<GovernanceDryRunRecord | null> {
    const found = await this.model.findById(dryRunId).exec();
    return found ? dryRunToRecord(found) : null;
  }

  async findContinuation(deploymentId: string, revisionId: string, conversationId: string, testerId: string): Promise<GovernanceDryRunRecord | null> {
    const found = await this.model
      .findOne({
        deploymentId: new Types.ObjectId(deploymentId),
        revisionId: new Types.ObjectId(revisionId),
        conversationId: new Types.ObjectId(conversationId),
        testerId: new Types.ObjectId(testerId),
      })
      .lean()
      .exec();
    return found ? dryRunToRecord(found) : null;
  }

  async findLatestByDeployment(deploymentId: string): Promise<GovernanceDryRunRecord | null> {
    const found = await this.model.findOne({ deploymentId: new Types.ObjectId(deploymentId) }).sort({ createdAt: -1 }).lean().exec();
    return found ? dryRunToRecord(found) : null;
  }

  async findPassedByDeploymentAndRevision(deploymentId: string, revisionId: string): Promise<GovernanceDryRunRecord | null> {
    const found = await this.model
      .findOne({ deploymentId: new Types.ObjectId(deploymentId), revisionId: new Types.ObjectId(revisionId), status: 'passed' })
      .select('_id')
      .lean()
      .exec();
    return found ? dryRunToRecord(found) : null;
  }

  async listByDeployment(deploymentId: string): Promise<GovernanceDryRunRecord[]> {
    const dryRuns = await this.model.find({ deploymentId: new Types.ObjectId(deploymentId) }).sort({ createdAt: -1 }).lean().exec();
    return dryRuns.map(dryRunToRecord);
  }

  async update(dryRunId: string, patch: GovernanceDryRunPatch): Promise<GovernanceDryRunRecord | null> {
    const dryRun = await this.model.findById(dryRunId).exec();
    if (!dryRun) return null;
    if (patch.status !== undefined) dryRun.status = patch.status;
    if (patch.checks !== undefined) dryRun.checks = patch.checks as never;
    await dryRun.save();
    return dryRunToRecord(dryRun);
  }

  async deleteByProgramAndScope(programId: string, scopeId: string): Promise<void> {
    await this.model.deleteMany({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId) }).exec();
  }
}
