import { TemporalCandidateExtractorService } from './temporal-candidate-extractor.service';

describe('TemporalCandidateExtractorService', () => {
  const service = new TemporalCandidateExtractorService();
  it('extracts strict evidence-backed start and end dates', () => {
    const result = service.extract([{ id: 'e1', field: 'effectiveFrom', origin: 'logical_search', confidence: 0.8, excerpt: 'Effective from 2026-01-01.', documentId: 'document-1' }, { id: 'e2', field: 'effectiveUntil', origin: 'logical_search', confidence: 0.8, excerpt: 'Valid until 31/12/2026.', documentId: 'document-1' }]);
    expect(result.map((item) => [item.candidate.field, item.candidate.value])).toEqual([['effectiveFrom', '2026-01-01'], ['effectiveUntil', '2026-12-31']]);
    expect(result.every((item) => item.candidate.evidenceRefs[0] === item.evidence.id)).toBe(true);
  });
  it('does not treat an unlabelled date as validity', () => {
    expect(service.extract([{ id: 'e1', field: 'publishedAt', origin: 'logical_search', confidence: 0.8, excerpt: 'Document 2026-01-01.', documentId: 'document-1' }])).toEqual([]);
  });
});
