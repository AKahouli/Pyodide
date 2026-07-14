import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { GovernanceSourceVersion, GovernanceSourceVersionDocument } from '../schemas/governance-source-version.schema';
import { GovernanceSourceEventService } from './governance-source-event.service';

const BATCH_SIZE = 100;

interface DueReviewVersion {
  _id: Types.ObjectId;
  programId: Types.ObjectId;
  sourceId: Types.ObjectId;
  validity: { businessStatus: string; nextReviewAt?: Date };
}

@Injectable()
export class GovernanceSourceReviewSchedulerService {
  constructor(
    @InjectModel(GovernanceSourceVersion.name) private readonly versionModel: Model<GovernanceSourceVersionDocument>,
    private readonly events: GovernanceSourceEventService,
    private readonly config: ConfigService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'governance.source-review-due' })
  async scheduleDueReviews(): Promise<void> {
    if (!this.config.get<boolean>('dataRoom.validityIntelligenceEnabled')) return;
    await this.run(new Date());
  }

  async run(now: Date): Promise<number> {
    await this.recoverMissingReviewEvents(now);
    const dueVersions = await this.versionModel.aggregate<DueReviewVersion>([
      { $match: { lifecycleStatus: { $nin: ['rejected', 'superseded'] }, 'validity.nextReviewAt': { $lte: now }, 'validity.businessStatus': { $nin: ['needs_review', 'expired', 'suspended', 'conflicting'] } } },
      { $lookup: { from: 'governance_sources', let: { sourceId: '$sourceId' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$sourceId'] }, isArchived: { $ne: true } } }, { $project: { _id: 1 } }], as: 'activeSource' } },
      { $match: { 'activeSource.0': { $exists: true } } },
      { $lookup: { from: 'governance_source_events', let: { sourceId: '$sourceId', key: { $concat: ['review-due:', { $toString: '$_id' }, ':', { $dateToString: { date: '$validity.nextReviewAt', format: '%Y-%m-%dT%H:%M:%S.%LZ', timezone: 'UTC' } }] } }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$sourceId', '$$sourceId'] }, { $eq: ['$deduplicationKey', '$$key'] }] } } }, { $limit: 1 }], as: 'reviewDueEvent' } },
      { $match: { 'reviewDueEvent.0': { $exists: false } } },
      { $sort: { 'validity.nextReviewAt': 1 } },
      { $limit: BATCH_SIZE },
      { $project: { activeSource: 0, reviewDueEvent: 0 } },
    ]).exec();
    if (dueVersions.length === 0) return 0;
    let marked = 0;
    for (const version of dueVersions) {
      const session = await this.connection.startSession();
      try {
        let transitioned = false;
        await session.withTransaction(async () => {
          const update = await this.versionModel.updateOne({ _id: version._id, 'validity.businessStatus': version.validity.businessStatus, 'validity.nextReviewAt': version.validity.nextReviewAt }, { $set: { 'validity.businessStatus': 'needs_review' } }, { session }).exec();
          if (update.modifiedCount !== 1) return;
          await this.events.append({ programId: version.programId.toString(), sourceId: version.sourceId.toString(), versionId: version._id.toString(), eventType: 'validity.review_due', actorType: 'system', occurredAt: now, before: { businessStatus: version.validity.businessStatus }, after: { businessStatus: 'needs_review' }, deduplicationKey: `review-due:${version._id.toString()}:${version.validity.nextReviewAt?.toISOString() ?? 'none'}`, session });
          transitioned = true;
        });
        if (transitioned) marked += 1;
      } catch (error) {
        if (!this.isTransactionUnavailable(error)) throw error;
        if (await this.transitionWithoutTransaction(version, now)) marked += 1;
      } finally {
        await session.endSession();
      }
    }
    return marked;
  }

  private async recoverMissingReviewEvents(now: Date): Promise<void> {
    const versions = await this.versionModel.aggregate<DueReviewVersion>([
      { $match: { lifecycleStatus: { $nin: ['rejected', 'superseded'] }, 'validity.nextReviewAt': { $lte: now }, 'validity.businessStatus': 'needs_review' } },
      { $lookup: { from: 'governance_sources', let: { sourceId: '$sourceId' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$sourceId'] }, isArchived: { $ne: true } } }, { $project: { _id: 1 } }], as: 'activeSource' } },
      { $match: { 'activeSource.0': { $exists: true } } },
      { $lookup: { from: 'governance_source_events', let: { sourceId: '$sourceId', key: { $concat: ['review-due:', { $toString: '$_id' }, ':', { $dateToString: { date: '$validity.nextReviewAt', format: '%Y-%m-%dT%H:%M:%S.%LZ', timezone: 'UTC' } }] } }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$sourceId', '$$sourceId'] }, { $eq: ['$deduplicationKey', '$$key'] }] } } }, { $limit: 1 }], as: 'reviewDueEvent' } },
      { $match: { 'reviewDueEvent.0': { $exists: false } } },
      { $sort: { 'validity.nextReviewAt': 1 } },
      { $limit: BATCH_SIZE },
      { $project: { activeSource: 0, reviewDueEvent: 0 } },
    ]).exec();
    for (const version of versions) {
      await this.events.append({ programId: version.programId.toString(), sourceId: version.sourceId.toString(), versionId: version._id.toString(), eventType: 'validity.review_due', actorType: 'system', occurredAt: now, before: { businessStatus: 'needs_review' }, after: { businessStatus: 'needs_review' }, metadata: { recovered: true }, deduplicationKey: `review-due:${version._id.toString()}:${version.validity.nextReviewAt?.toISOString() ?? 'none'}` });
    }
  }

  private async transitionWithoutTransaction(version: DueReviewVersion, now: Date): Promise<boolean> {
    const filter = { _id: version._id, 'validity.businessStatus': version.validity.businessStatus, 'validity.nextReviewAt': version.validity.nextReviewAt };
    const update = await this.versionModel.updateOne(filter, { $set: { 'validity.businessStatus': 'needs_review' } }).exec();
    if (update.modifiedCount !== 1) return false;
    try {
      await this.events.append({ programId: version.programId.toString(), sourceId: version.sourceId.toString(), versionId: version._id.toString(), eventType: 'validity.review_due', actorType: 'system', occurredAt: now, before: { businessStatus: version.validity.businessStatus }, after: { businessStatus: 'needs_review' }, deduplicationKey: `review-due:${version._id.toString()}:${version.validity.nextReviewAt?.toISOString() ?? 'none'}` });
      return true;
    } catch (error) {
      await this.versionModel.updateOne({ _id: version._id, 'validity.businessStatus': 'needs_review', 'validity.nextReviewAt': version.validity.nextReviewAt }, { $set: { 'validity.businessStatus': version.validity.businessStatus } }).exec();
      throw error;
    }
  }

  private isTransactionUnavailable(error: unknown): boolean {
    return error instanceof Error && /Transaction numbers are only allowed|does not support transactions|replica set/i.test(error.message);
  }
}
