import { Injectable } from '@nestjs/common';
import type { KnowledgeAssessmentContext, KnowledgeEvaluator } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import { dimension } from './knowledge-evaluator.utils';

@Injectable()
export class FreshnessEvaluator implements KnowledgeEvaluator {
  readonly key = 'freshness' as const;
  async evaluate(context: KnowledgeAssessmentContext) {
    const nextReview = context.governance.validity.nextReviewAt;
    if (!nextReview) return dimension(45, [{ code: 'freshness.review_unscheduled', contribution: 45, message: 'No next review date is configured.' }]);
    const days = Math.ceil((nextReview.getTime() - context.now.getTime()) / 86_400_000);
    if (days < 0) return dimension(15, [{ code: 'freshness.review_overdue', contribution: 15, message: `Review is overdue by ${Math.abs(days)} day(s).`, evidenceRefs: [`document:${context.document.id}:nextReviewAt`] }]);
    if (days <= 30) return dimension(65, [{ code: 'freshness.review_due_soon', contribution: 65, message: `Review is due in ${days} day(s).`, evidenceRefs: [`document:${context.document.id}:nextReviewAt`] }]);
    return dimension(100, [{ code: 'freshness.review_current', contribution: 100, message: `Review is scheduled in ${days} day(s).`, evidenceRefs: [`document:${context.document.id}:nextReviewAt`] }]);
  }
}
