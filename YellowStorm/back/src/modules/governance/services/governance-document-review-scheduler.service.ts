import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Inject } from '@nestjs/common';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import { GOVERNANCE_DOCUMENT_STORE, type GovernanceDocumentStore } from '../persistence';
import { GovernanceDocumentEventService } from './governance-document-event.service';

const BATCH_SIZE = 100;

@Injectable()
export class GovernanceDocumentReviewSchedulerService {
  constructor(
    @Inject(GOVERNANCE_DOCUMENT_STORE) private readonly documentStore: GovernanceDocumentStore,
    private readonly events: GovernanceDocumentEventService,
    private readonly features: FeatureVisibilityService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'governance.document-review-due' })
  async scheduleDueReviews(): Promise<void> {
    if (!this.features.isEnabled('dataRoomValidityIntelligence')) return;
    await this.run(new Date());
  }

  async run(now: Date): Promise<number> {
    const due = await this.documentStore.listDueForReview(now, BATCH_SIZE);
    let marked = 0;
    for (const document of due) {
      const previous = document.validity.businessStatus as string | undefined;
      const previousNextReviewAt = (document.validity.nextReviewAt as Date | string | undefined) ?? null;
      const observedDue = previousNextReviewAt instanceof Date ? previousNextReviewAt : previousNextReviewAt ? new Date(previousNextReviewAt) : null;
      // Optimistic guard: skip when another writer changed the business status
      // or the review date between the selection and this update.
      const updated = await this.documentStore.markNeedsReviewIfUnchanged(document.id, previous, observedDue);
      if (!updated) continue;
      await this.events.append({ programId: document.programId, governanceDocumentId: document.id, documentId: document.documentId, eventType: 'validity.review_due', before: { businessStatus: previous }, after: { businessStatus: 'needs_review' }, occurredAt: now, deduplicationKey: `review-due:${observedDue?.toISOString() ?? 'none'}` });
      marked += 1;
    }
    return marked;
  }
}
