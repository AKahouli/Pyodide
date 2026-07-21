import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { KnowledgeExtractionJob, KnowledgeExtractionJobDocument, type KnowledgeExtractionJobStatus, type KnowledgeExtractionJobType } from '../schemas/knowledge-extraction-job.schema';

export interface EnqueueKnowledgeExtractionJobInput {
  programId: string;
  sourceId: string;
  sourceVersionId: string;
  connectorId: string;
  requestedByUserId: string;
  jobType: KnowledgeExtractionJobType;
  inputHash: string;
  engineVersion: string;
}

@Injectable()
export class KnowledgeExtractionOrchestratorService {
  constructor(@InjectModel(KnowledgeExtractionJob.name) private readonly jobModel: Model<KnowledgeExtractionJobDocument>) {}

  async enqueue(input: EnqueueKnowledgeExtractionJobInput): Promise<KnowledgeExtractionJobDocument> {
    const identity = { sourceVersionId: new Types.ObjectId(input.sourceVersionId), jobType: input.jobType, inputHash: input.inputHash, engineVersion: input.engineVersion };
    try {
      return await this.jobModel.findOneAndUpdate(
        identity,
        { $setOnInsert: { programId: new Types.ObjectId(input.programId), sourceId: new Types.ObjectId(input.sourceId), sourceVersionId: new Types.ObjectId(input.sourceVersionId), connectorId: new Types.ObjectId(input.connectorId), requestedByUserId: new Types.ObjectId(input.requestedByUserId), jobType: input.jobType, inputHash: input.inputHash, engineVersion: input.engineVersion, status: 'pending', attempts: 0 } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).exec();
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) throw error;
      const existing = await this.jobModel.findOne(identity).exec();
      if (!existing) throw error;
      return existing;
    }
  }

  async retryLatestFailedForVersion(sourceVersionId: string, connectorId: string, requestedByUserId: string): Promise<KnowledgeExtractionJobDocument | null> {
    return this.jobModel.findOneAndUpdate(
      { sourceVersionId: new Types.ObjectId(sourceVersionId), connectorId: new Types.ObjectId(connectorId), status: 'failed' },
      {
        $set: { status: 'pending', attempts: 0, requestedByUserId: new Types.ObjectId(requestedByUserId) },
        $unset: { error: 1, startedAt: 1, completedAt: 1, leaseExpiresAt: 1, leaseToken: 1, nextAttemptAt: 1 },
      },
      { new: true, sort: { createdAt: -1 } },
    ).exec();
  }

  async markRunning(jobId: string): Promise<KnowledgeExtractionJobDocument | null> {
    return this.setStatus(jobId, ['pending', 'failed'], 'running', { $inc: { attempts: 1 }, $set: { startedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 300_000), leaseToken: randomUUID(), error: undefined, completedAt: undefined } });
  }

  async claimNext(jobTypes: KnowledgeExtractionJobType[]): Promise<KnowledgeExtractionJobDocument | null> {
    const now = new Date();
    await this.jobModel.updateMany({ status: 'running', attempts: { $gte: 5 }, leaseExpiresAt: { $lte: now } }, { $set: { status: 'failed', completedAt: now, leaseToken: undefined, leaseExpiresAt: undefined, error: 'The extraction job exhausted its retry limit after a worker lease expired.' } }).exec();
    const leaseToken = randomUUID();
    return this.jobModel.findOneAndUpdate(
      { jobType: { $in: jobTypes }, attempts: { $lt: 5 }, $or: [{ status: 'pending' }, { status: 'failed', nextAttemptAt: { $lte: now } }, { status: 'running', leaseExpiresAt: { $lte: now } }] },
      { $set: { status: 'running', startedAt: now, leaseExpiresAt: new Date(now.getTime() + 300_000), leaseToken, error: undefined, completedAt: undefined }, $inc: { attempts: 1 } },
      { new: true, sort: { createdAt: 1 } },
    ).exec();
  }

  async markCompleted(jobId: string, leaseToken: string): Promise<KnowledgeExtractionJobDocument | null> {
    return this.jobModel.findOneAndUpdate(
      { _id: jobId, status: 'running', leaseToken },
      { $set: { status: 'completed', completedAt: new Date() }, $unset: { leaseExpiresAt: 1, leaseToken: 1, error: 1, nextAttemptAt: 1 } },
      { new: true },
    ).exec();
  }

  async markFailed(jobId: string, leaseToken: string, error: string, attempts = 1): Promise<KnowledgeExtractionJobDocument | null> {
    const retryDelayMs = Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
    return this.setClaimedStatus(jobId, leaseToken, 'failed', { completedAt: new Date(), leaseExpiresAt: undefined, leaseToken: undefined, nextAttemptAt: new Date(Date.now() + retryDelayMs), error: error.slice(0, 2000) });
  }

  private async setClaimedStatus(jobId: string, leaseToken: string, status: KnowledgeExtractionJobStatus, values: Record<string, unknown>): Promise<KnowledgeExtractionJobDocument | null> { return this.jobModel.findOneAndUpdate({ _id: jobId, status: 'running', leaseToken }, { $set: { ...values, status } }, { new: true }).exec(); }

  async heartbeat(jobId: string, leaseToken: string): Promise<boolean> { const result = await this.jobModel.updateOne({ _id: jobId, status: 'running', leaseToken }, { $set: { leaseExpiresAt: new Date(Date.now() + 300_000) } }).exec(); return result.modifiedCount === 1; }

  async purgeSource(sourceId: string, session?: import('mongoose').ClientSession): Promise<void> { await this.jobModel.deleteMany({ sourceId: new Types.ObjectId(sourceId) }, { session }).exec(); }
  async latestForVersion(sourceVersionId: string): Promise<KnowledgeExtractionJobDocument | null> { return this.jobModel.findOne({ sourceVersionId: new Types.ObjectId(sourceVersionId) }).sort({ createdAt: -1 }).exec(); }

  private async setStatus(jobId: string, expectedStatuses: KnowledgeExtractionJobStatus[], status: KnowledgeExtractionJobStatus, update: Record<string, unknown>): Promise<KnowledgeExtractionJobDocument | null> {
    return this.jobModel.findOneAndUpdate({ _id: jobId, status: { $in: expectedStatuses } }, { ...update, $set: { ...(update.$set as Record<string, unknown>), status } }, { new: true }).exec();
  }

  private isDuplicateKeyError(error: unknown): error is { code: number } {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000;
  }
}
