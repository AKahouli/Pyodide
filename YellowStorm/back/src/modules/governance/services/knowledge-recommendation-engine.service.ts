import { Injectable } from '@nestjs/common';
import type { KnowledgeAssessmentContext, KnowledgeAssessmentDimensions } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import type { KnowledgeRecommendationInput } from '@modules/knowledge-intelligence/services/knowledge-recommendation-repository.service';

@Injectable()
export class KnowledgeRecommendationEngineService {
  build(context: KnowledgeAssessmentContext, dimensions: KnowledgeAssessmentDimensions): KnowledgeRecommendationInput[] {
    const base = { programId: '', scopeIds: context.source.scopeIds, sourceId: context.source.id, sourceVersionId: context.version.id, alertIds: [] as string[] };
    const output: KnowledgeRecommendationInput[] = [];
    const add = (item: Omit<KnowledgeRecommendationInput, keyof typeof base | 'deduplicationKey'>) => output.push({ ...base, ...item, deduplicationKey: `${context.version.id}:recommendation-v1:${item.type}` });
    if (!context.source.ownerUserId) add({ type: 'assign_owner', priority: context.version.lifecycleStatus === 'published' ? 'high' : 'medium', reason: 'The source has no accountable owner.', impactSummary: 'Review and publication decisions may lack clear ownership.', proposedAction: { kind: 'open_source_ownership' } });
    if (context.version.validity.businessStatus === 'unknown') add({ type: 'confirm_validity', priority: 'high', reason: 'Business validity is unknown.', impactSummary: 'The source may be used without a confirmed application period.', proposedAction: { kind: 'open_source_validity' } });
    if (context.version.validity.businessStatus === 'needs_review') add({ type: 'schedule_review', priority: 'high', reason: 'The configured review is overdue.', impactSummary: 'A reviewer should reassess the source before future publication.', proposedAction: { kind: 'recalculate_review', reviewFrequencyDays: context.version.validity.reviewFrequencyDays ?? context.source.reviewFrequencyDays ?? 30 } });
    if (context.version.validity.businessStatus === 'conflicting') add({ type: 'resolve_conflict', priority: 'critical', reason: 'Validity evidence is conflicting.', impactSummary: 'Critical dates must be resolved by a reviewer.', proposedAction: { kind: 'open_source_validity' } });
    if (context.version.technicalStatus === 'failed' && context.version.documentId) add({ type: 'reindex', priority: 'high', reason: 'Document indexing failed.', impactSummary: 'The source cannot participate reliably in retrieval.', proposedAction: { kind: 'queue_reindex', documentId: context.version.documentId } });
    if (dimensions.searchQuality.score < 60) add({ type: 'enrich_metadata', priority: 'medium', reason: 'Observable search-quality signals are weak.', impactSummary: 'Better governed metadata may improve discovery and retrieval.', proposedAction: { kind: 'review_metadata_candidates' } });
    if (!context.version.validity.nextReviewAt && context.version.validity.businessStatus !== 'unknown') add({ type: 'schedule_review', priority: 'medium', reason: 'No next review is scheduled.', impactSummary: 'The source can become stale without an administrative reminder.', proposedAction: { kind: 'recalculate_review', reviewFrequencyDays: context.version.validity.reviewFrequencyDays ?? context.source.reviewFrequencyDays ?? 30 } });
    return output;
  }
}
