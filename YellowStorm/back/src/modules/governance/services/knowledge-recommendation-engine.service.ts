import { Injectable } from '@nestjs/common';
import type { KnowledgeAssessmentContext, KnowledgeAssessmentDimensions } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import type { KnowledgeRecommendationInput } from '@modules/knowledge-intelligence/services/knowledge-recommendation-repository.service';

@Injectable()
export class KnowledgeRecommendationEngineService {
  build(context: KnowledgeAssessmentContext, dimensions: KnowledgeAssessmentDimensions): KnowledgeRecommendationInput[] {
    const base = { programId: '', scopeIds: context.binding.scopeIds, documentId: context.document.id, alertIds: [] as string[] };
    const output: KnowledgeRecommendationInput[] = [];
    const add = (item: Omit<KnowledgeRecommendationInput, keyof typeof base | 'deduplicationKey'>) => output.push({ ...base, ...item, deduplicationKey: `${context.document.id}:recommendation-v1:${item.type}` });
    if (!context.governance.ownerUserId) add({ type: 'assign_owner', priority: context.governance.status === 'published' ? 'high' : 'medium', reason: 'The document has no accountable owner.', impactSummary: 'Review and publication decisions may lack clear ownership.', proposedAction: { kind: 'open_document_ownership' } });
    if (context.governance.validity.businessStatus === 'unknown') add({ type: 'confirm_validity', priority: 'high', reason: 'Business validity is unknown.', impactSummary: 'The document may be used without a confirmed application period.', proposedAction: { kind: 'open_document_validity' } });
    if (context.governance.validity.businessStatus === 'needs_review') add({ type: 'schedule_review', priority: 'high', reason: 'The configured review is overdue.', impactSummary: 'A reviewer should reassess the document before future publication.', proposedAction: { kind: 'recalculate_review', reviewFrequencyDays: context.governance.validity.reviewFrequencyDays ?? 30 } });
    if (context.governance.validity.businessStatus === 'conflicting') add({ type: 'resolve_conflict', priority: 'critical', reason: 'Validity evidence is conflicting.', impactSummary: 'Critical dates must be resolved by a reviewer.', proposedAction: { kind: 'open_document_validity' } });
    if (context.document.indexingStatus === 'failed') add({ type: 'reindex', priority: 'high', reason: 'Document indexing failed.', impactSummary: 'The document cannot participate reliably in retrieval.', proposedAction: { kind: 'queue_reindex', documentId: context.document.id } });
    if (dimensions.searchQuality.score < 60) add({ type: 'enrich_metadata', priority: 'medium', reason: 'Observable search-quality signals are weak.', impactSummary: 'Better governed metadata may improve discovery and retrieval.', proposedAction: { kind: 'review_metadata_candidates' } });
    if (!context.governance.validity.nextReviewAt && context.governance.validity.businessStatus !== 'unknown') add({ type: 'schedule_review', priority: 'medium', reason: 'No next review is scheduled.', impactSummary: 'The document can become stale without an administrative reminder.', proposedAction: { kind: 'recalculate_review', reviewFrequencyDays: context.governance.validity.reviewFrequencyDays ?? 30 } });
    return output;
  }
}
