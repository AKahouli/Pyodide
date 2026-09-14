import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import { GovernanceDocument, GovernanceDocumentDocument } from '../schemas/governance-document.schema';
import { GovernanceDocumentEventService } from './governance-document-event.service';

const BATCH_SIZE = 100;

@Injectable()
export class GovernanceDocumentReviewSchedulerService {
  constructor(@InjectModel(GovernanceDocument.name) private readonly model: Model<GovernanceDocumentDocument>, private readonly events: GovernanceDocumentEventService, private readonly features: FeatureVisibilityService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'governance.document-review-due' })
  async scheduleDueReviews(): Promise<void> {
    if (!this.features.isEnabled('dataRoomValidityIntelligence')) return;
    await this.run(new Date());
  }

  async run(now: Date): Promise<number> {
    const due = await this.model.find({ status: { $nin: ['rejected', 'archived'] }, 'validity.nextReviewAt': { $lte: now }, 'validity.businessStatus': { $nin: ['needs_review', 'expired', 'suspended', 'conflicting'] } }).sort({ 'validity.nextReviewAt': 1 }).limit(BATCH_SIZE).exec();
    let marked = 0;
    for (const document of due) {
      const previous = document.validity.businessStatus;
      const updated = await this.model.updateOne({ _id: document._id, 'validity.businessStatus': previous, 'validity.nextReviewAt': document.validity.nextReviewAt }, { $set: { 'validity.businessStatus': 'needs_review' }, $inc: { governanceRevision: 1 } }).exec();
      if (updated.modifiedCount !== 1) continue;
      await this.events.append({ programId: document.programId.toString(), governanceDocumentId: document._id.toString(), documentId: document.documentId.toString(), eventType: 'validity.review_due', before: { businessStatus: previous }, after: { businessStatus: 'needs_review' }, occurredAt: now, deduplicationKey: `review-due:${document.validity.nextReviewAt?.toISOString() ?? 'none'}` });
      marked += 1;
    }
    return marked;
  }
}
