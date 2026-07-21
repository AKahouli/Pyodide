import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { KnowledgePriority, KnowledgeRecommendationType } from '../domain/knowledge-steward';
import { KnowledgeRecommendation, KnowledgeRecommendationDocument, type KnowledgeRecommendationStatus } from '../schemas/knowledge-recommendation.schema';

export interface KnowledgeRecommendationInput { programId: string; scopeIds: string[]; sourceId: string; sourceVersionId: string; alertIds: string[]; type: KnowledgeRecommendationType; priority: KnowledgePriority; reason: string; impactSummary: string; proposedAction?: Record<string, unknown>; deduplicationKey: string; }

@Injectable()
export class KnowledgeRecommendationRepositoryService {
  constructor(@InjectModel(KnowledgeRecommendation.name) private readonly model: Model<KnowledgeRecommendationDocument>) {}

  async synchronize(sourceVersionId: string, recommendations: KnowledgeRecommendationInput[]): Promise<void> {
    const keys = recommendations.map((item) => item.deduplicationKey);
    await Promise.all(recommendations.map((item) => this.synchronizeOne(item)));
    await this.model.updateMany({ sourceVersionId: new Types.ObjectId(sourceVersionId), status: 'proposed', deduplicationKey: { $nin: keys } }, { $set: { status: 'superseded' } }).exec();
  }

  async list(programId: string, filter: { scopeIds?: string[]; status?: KnowledgeRecommendationStatus; priority?: KnowledgePriority }): Promise<KnowledgeRecommendationDocument[]> {
    const query: Record<string, unknown> = { programId: new Types.ObjectId(programId) };
    if (filter.scopeIds && !filter.scopeIds.includes('*')) query.$or = [{ scopeIds: { $in: filter.scopeIds.map((id) => new Types.ObjectId(id)) } }, { scopeIds: { $size: 0 } }];
    if (filter.status) query.status = filter.status;
    if (filter.priority) query.priority = filter.priority;
    return this.model.find(query).sort({ status: 1, priority: 1, createdAt: -1 }).limit(500).exec();
  }

  async decide(programId: string, id: string, actorId: string, action: 'accept' | 'reject', accessibleScopeIds: string[], reason?: string): Promise<KnowledgeRecommendationDocument | null> {
    const scopeFilter = accessibleScopeIds.includes('*') ? {} : { $or: [{ scopeIds: { $in: accessibleScopeIds.map((scopeId) => new Types.ObjectId(scopeId)) } }, { scopeIds: { $size: 0 } }] };
    return this.model.findOneAndUpdate({ _id: new Types.ObjectId(id), programId: new Types.ObjectId(programId), status: 'proposed', ...scopeFilter }, { $set: { status: action === 'accept' ? 'accepted' : 'rejected', decidedBy: new Types.ObjectId(actorId), decidedAt: new Date(), decisionReason: reason } }, { new: true }).exec();
  }

  async beginApply(programId: string, id: string, accessibleScopeIds: string[]): Promise<KnowledgeRecommendationDocument | null> {
    const now = new Date();
    const scopeFilter = accessibleScopeIds.includes('*') ? {} : { $or: [{ scopeIds: { $in: accessibleScopeIds.map((scopeId) => new Types.ObjectId(scopeId)) } }, { scopeIds: { $size: 0 } }] };
    return this.model.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        programId: new Types.ObjectId(programId),
        status: 'accepted',
        $and: [
          scopeFilter,
          { $or: [{ applicationToken: { $exists: false } }, { applicationLeaseExpiresAt: { $lte: now } }] },
        ],
      },
      { $set: { applicationToken: randomUUID(), applicationLeaseExpiresAt: new Date(now.getTime() + 120_000) } },
      { new: true },
    ).exec();
  }

  async markApplied(id: string, actorId: string, applicationToken: string, session?: ClientSession): Promise<KnowledgeRecommendationDocument | null> {
    return this.model.findOneAndUpdate(
      { _id: new Types.ObjectId(id), status: 'accepted', applicationToken },
      { $set: { status: 'applied', appliedBy: new Types.ObjectId(actorId), appliedAt: new Date() }, $unset: { applicationToken: 1, applicationLeaseExpiresAt: 1 } },
      { new: true, session },
    ).exec();
  }

  async releaseApplication(id: string, applicationToken: string): Promise<void> {
    await this.model.updateOne(
      { _id: new Types.ObjectId(id), status: 'accepted', applicationToken },
      { $unset: { applicationToken: 1, applicationLeaseExpiresAt: 1 } },
    ).exec();
  }

  private async synchronizeOne(item: KnowledgeRecommendationInput): Promise<void> {
    const key = { programId: new Types.ObjectId(item.programId), deduplicationKey: item.deduplicationKey };
    const mutable = { scopeIds: item.scopeIds.map((id) => new Types.ObjectId(id)), sourceId: new Types.ObjectId(item.sourceId), sourceVersionId: new Types.ObjectId(item.sourceVersionId), alertIds: item.alertIds.map((id) => new Types.ObjectId(id)), type: item.type, priority: item.priority, reason: item.reason, impactSummary: item.impactSummary, proposedAction: item.proposedAction };
    const existing = await this.model.findOne(key).select('_id').lean().exec();
    if (existing) {
      await this.model.updateOne({ _id: existing._id, status: 'proposed' }, { $set: mutable }).exec();
      return;
    }
    try {
      await this.model.findOneAndUpdate(key, { $setOnInsert: { ...key, ...mutable, status: 'proposed' } }, { upsert: true, setDefaultsOnInsert: true }).exec();
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      await this.model.updateOne({ ...key, status: 'proposed' }, { $set: mutable }).exec();
    }
  }
}
