import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { KnowledgeExtractionJob, KnowledgeExtractionJobDocument, type KnowledgeExtractionJobStatus, type KnowledgeExtractionJobType } from '../schemas/knowledge-extraction-job.schema';

export interface EnqueueKnowledgeExtractionJobInput { programId: string; documentId: string; connectorId: string; requestedByUserId: string; jobType: KnowledgeExtractionJobType; inputHash: string; engineVersion: string }

@Injectable()
export class KnowledgeExtractionOrchestratorService {
  constructor(@InjectModel(KnowledgeExtractionJob.name) private readonly model: Model<KnowledgeExtractionJobDocument>) {}

  async enqueue(input: EnqueueKnowledgeExtractionJobInput): Promise<KnowledgeExtractionJobDocument> {
    const identity = { programId: new Types.ObjectId(input.programId), documentId: new Types.ObjectId(input.documentId), jobType: input.jobType, inputHash: input.inputHash, engineVersion: input.engineVersion };
    try {
      return await this.model.findOneAndUpdate(identity, { $setOnInsert: { ...identity, connectorId: new Types.ObjectId(input.connectorId), requestedByUserId: new Types.ObjectId(input.requestedByUserId), status: 'pending', attempts: 0 } }, { new: true, upsert: true, setDefaultsOnInsert: true }).exec();
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) throw error;
      const existing = await this.model.findOne(identity).exec();
      if (!existing) throw error;
      return existing;
    }
  }

  async retryLatestFailedForDocument(documentId: string, connectorId: string, requestedByUserId: string): Promise<KnowledgeExtractionJobDocument | null> {
    return this.model.findOneAndUpdate({ documentId: new Types.ObjectId(documentId), connectorId: new Types.ObjectId(connectorId), status: 'failed' }, { $set: { status: 'pending', attempts: 0, requestedByUserId: new Types.ObjectId(requestedByUserId) }, $unset: { error: 1, startedAt: 1, completedAt: 1, leaseExpiresAt: 1, leaseToken: 1, nextAttemptAt: 1 } }, { new: true, sort: { createdAt: -1 } }).exec();
  }

  async markRunning(jobId: string): Promise<KnowledgeExtractionJobDocument | null> { return this.setStatus(jobId, ['pending', 'failed'], 'running', { $inc: { attempts: 1 }, $set: { startedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 300_000), leaseToken: randomUUID(), error: undefined, completedAt: undefined } }); }

  async claimNext(jobTypes: KnowledgeExtractionJobType[]): Promise<KnowledgeExtractionJobDocument | null> {
    const now = new Date();
    await this.model.updateMany({ status: 'running', attempts: { $gte: 5 }, leaseExpiresAt: { $lte: now } }, { $set: { status: 'failed', completedAt: now, leaseToken: undefined, leaseExpiresAt: undefined, error: 'The extraction job exhausted its retry limit after a worker lease expired.' } }).exec();
    return this.model.findOneAndUpdate({ jobType: { $in: jobTypes }, attempts: { $lt: 5 }, $or: [{ status: 'pending' }, { status: 'failed', nextAttemptAt: { $lte: now } }, { status: 'running', leaseExpiresAt: { $lte: now } }] }, { $set: { status: 'running', startedAt: now, leaseExpiresAt: new Date(now.getTime() + 300_000), leaseToken: randomUUID(), error: undefined, completedAt: undefined }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } }).exec();
  }

  async markCompleted(jobId: string, leaseToken: string): Promise<KnowledgeExtractionJobDocument | null> { return this.model.findOneAndUpdate({ _id: jobId, status: 'running', leaseToken }, { $set: { status: 'completed', completedAt: new Date() }, $unset: { leaseExpiresAt: 1, leaseToken: 1, error: 1, nextAttemptAt: 1 } }, { new: true }).exec(); }
  async markFailed(jobId: string, leaseToken: string, error: string, attempts = 1): Promise<KnowledgeExtractionJobDocument | null> { const delay = Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000); return this.setClaimedStatus(jobId, leaseToken, 'failed', { completedAt: new Date(), leaseExpiresAt: undefined, leaseToken: undefined, nextAttemptAt: new Date(Date.now() + delay), error: error.slice(0, 2000) }); }
  async heartbeat(jobId: string, leaseToken: string): Promise<boolean> { return (await this.model.updateOne({ _id: jobId, status: 'running', leaseToken }, { $set: { leaseExpiresAt: new Date(Date.now() + 300_000) } }).exec()).modifiedCount === 1; }
  async purgeDocument(documentId: string, session?: ClientSession): Promise<void> { await this.model.deleteMany({ documentId: new Types.ObjectId(documentId) }, { session }).exec(); }
  async latestForDocument(documentId: string): Promise<KnowledgeExtractionJobDocument | null> { return this.model.findOne({ documentId: new Types.ObjectId(documentId) }).sort({ createdAt: -1 }).exec(); }

  private async setClaimedStatus(jobId: string, leaseToken: string, status: KnowledgeExtractionJobStatus, values: Record<string, unknown>): Promise<KnowledgeExtractionJobDocument | null> { return this.model.findOneAndUpdate({ _id: jobId, status: 'running', leaseToken }, { $set: { ...values, status } }, { new: true }).exec(); }
  private async setStatus(jobId: string, expected: KnowledgeExtractionJobStatus[], status: KnowledgeExtractionJobStatus, update: Record<string, unknown>): Promise<KnowledgeExtractionJobDocument | null> { return this.model.findOneAndUpdate({ _id: jobId, status: { $in: expected } }, { ...update, $set: { ...(update.$set as Record<string, unknown>), status } }, { new: true }).exec(); }
  private isDuplicateKeyError(error: unknown): error is { code: number } { return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000; }
}
