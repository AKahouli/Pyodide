import { Injectable } from '@nestjs/common';
import type { AssessmentFactor, KnowledgeAssessmentContext, KnowledgeEvaluator } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import { dimension } from './knowledge-evaluator.utils';

@Injectable()
export class GovernanceQualityEvaluator implements KnowledgeEvaluator {
  readonly key = 'governanceQuality' as const;
  async evaluate(context: KnowledgeAssessmentContext) {
    const factors: AssessmentFactor[] = [];
    const scores: number[] = [];
    const owner = context.governance.ownerUserId ? 100 : 0;
    scores.push(owner); factors.push({ code: owner ? 'governance.owner_assigned' : 'governance.owner_missing', contribution: owner, message: owner ? 'A document owner is assigned.' : 'No document owner is assigned.' });
    const scope = context.binding.visibility === 'program_shared' || context.binding.scopeIds.length > 0 ? 100 : 0;
    scores.push(scope); factors.push({ code: scope ? 'governance.scope_defined' : 'governance.scope_missing', contribution: scope, message: scope ? 'Document scope is defined by its workspace binding.' : 'Document scope is missing.' });
    const lifecycle = ['approved', 'published'].includes(context.governance.status) ? 100 : context.governance.status === 'to_review' ? 70 : 45;
    scores.push(lifecycle); factors.push({ code: `governance.lifecycle_${context.governance.status}`, contribution: lifecycle, message: `Lifecycle status is ${context.governance.status}.` });
    const schedule = context.governance.validity.nextReviewAt || context.governance.validity.reviewFrequencyDays ? 100 : 25;
    scores.push(schedule); factors.push({ code: schedule === 100 ? 'governance.review_configured' : 'governance.review_missing', contribution: schedule, message: schedule === 100 ? 'Review governance is configured.' : 'Review governance is not configured.' });
    return dimension(scores.reduce((sum, value) => sum + value, 0) / scores.length, factors);
  }
}
