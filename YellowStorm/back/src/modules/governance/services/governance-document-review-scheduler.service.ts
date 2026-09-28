import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import { GovernanceDocumentEventService } from './governance-document-event.service';
import { PgGovernanceTransactionRunner } from '../persistence/postgres/pg-transaction-runner';
import { PgGovernanceDocumentStore } from '../persistence/postgres/pg-document.store';

const BATCH_SIZE = 100;

@Injectable()
export class GovernanceDocumentReviewSchedulerService {
  constructor(
    private readonly documentStore: PgGovernanceDocumentStore,
    private readonly events: GovernanceDocumentEventService,
    private readonly features: FeatureVisibilityService,
    private readonly tx: PgGovernanceTransactionRunner,
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
      const rawStatus = document.validity.businessStatus as string | null | undefined;
      // Same normalisation as the promoted column: '' / null / missing -> undefined (NULL).
      const previous = rawStatus === null || rawStatus === '' ? undefined : rawStatus;
      const previousNextReviewAt = (document.validity.nextReviewAt as Date | string | undefined) ?? null;
      const parsedDue = previousNextReviewAt instanceof Date ? previousNextReviewAt : previousNextReviewAt ? new Date(previousNextReviewAt) : null;
      const observedDue = parsedDue && !Number.isNaN(parsedDue.getTime()) ? parsedDue : null;
      // Optimistic guard: skip when another writer changed the business status
      // or the review date between the selection and this update.
      const updated = await this.tx.run(async () => {
        const marked = await this.documentStore.markNeedsReviewIfUnchanged(document.id, previous, observedDue);
        if (!marked) return false;
        await this.events.append({ programId: document.programId, governanceDocumentId: document.id, documentId: document.documentId, eventType: 'validity.review_due', before: { businessStatus: previous }, after: { businessStatus: 'needs_review' }, occurredAt: now, deduplicationKey: `review-due:${observedDue?.toISOString() ?? 'none'}` });
        return true;
      });
      if (!updated) continue;
      marked += 1;
    }
    return marked;
  }
}
