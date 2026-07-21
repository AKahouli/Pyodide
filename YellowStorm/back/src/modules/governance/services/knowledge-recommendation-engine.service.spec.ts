import type { KnowledgeAssessmentContext, KnowledgeAssessmentDimensions } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import { KnowledgeRecommendationEngineService } from './knowledge-recommendation-engine.service';

describe('KnowledgeRecommendationEngineService', () => {
  it('creates stable, explainable recommendations without inventing usage or graph signals', () => {
    const context: KnowledgeAssessmentContext = { source: { id: 'source-1', title: 'document.pdf', sourceType: 'pdf', status: 'draft', visibility: 'scope_specific', scopeIds: ['scope-1'], metadata: {} }, version: { id: 'version-1', lifecycleStatus: 'captured', technicalStatus: 'failed', documentId: 'document-1', capturedAt: new Date(), extractedMetadata: {}, validity: { mode: 'unknown', businessStatus: 'unknown' } }, now: new Date() };
    const warning = { score: 40, status: 'warning' as const, factors: [] };
    const dimensions = { businessValidity: warning, freshness: warning, availability: warning, integrity: warning, searchQuality: warning, governanceQuality: warning } satisfies KnowledgeAssessmentDimensions;
    const result = new KnowledgeRecommendationEngineService().build(context, dimensions);
    expect(result.map((item) => item.type)).toEqual(['assign_owner', 'confirm_validity', 'reindex', 'enrich_metadata']);
    expect(new Set(result.map((item) => item.deduplicationKey)).size).toBe(result.length);
  });
});
