import type { KnowledgeAssessmentContext, KnowledgeAssessmentDimensions } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import { KnowledgeRecommendationEngineService } from './knowledge-recommendation-engine.service';

describe('KnowledgeRecommendationEngineService', () => {
  it('creates stable, explainable recommendations without inventing usage or graph signals', () => {
    const context: KnowledgeAssessmentContext = { document: { id: 'document-1', workspaceId: 'workspace-1', originalName: 'document.pdf', mimeType: 'application/pdf', type: 'doc', status: 'completed', indexingStatus: 'failed', updatedAt: new Date(), metadata: {} }, governance: { status: 'captured', validity: { mode: 'unknown', businessStatus: 'unknown' }, tags: [], metadata: {} }, binding: { visibility: 'scope_specific', scopeIds: ['scope-1'], ingestionMode: 'assisted' }, now: new Date() };
    const warning = { score: 40, status: 'warning' as const, factors: [] };
    const dimensions = { businessValidity: warning, freshness: warning, availability: warning, integrity: warning, searchQuality: warning, governanceQuality: warning } satisfies KnowledgeAssessmentDimensions;
    const result = new KnowledgeRecommendationEngineService().build(context, dimensions);
    expect(result.map((item) => item.type)).toEqual(['assign_owner', 'confirm_validity', 'reindex', 'enrich_metadata']);
    expect(new Set(result.map((item) => item.deduplicationKey)).size).toBe(result.length);
  });
});
