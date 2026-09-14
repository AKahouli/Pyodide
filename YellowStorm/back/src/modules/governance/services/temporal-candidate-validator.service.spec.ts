import { TemporalCandidateValidatorService } from './temporal-candidate-validator.service';
import type { ValidityEvidence } from '../domain/document-validity';
import type { TemporalCandidate } from '../domain/temporal-candidate';

const evidence: ValidityEvidence = { id: 'e1', field: 'effectiveUntil', value: '2027-12-31', origin: 'document_metadata', confidence: 0.9, documentId: 'document-1' };
const candidate = (patch: Partial<TemporalCandidate> = {}): TemporalCandidate => ({ candidateId: 'c1', field: 'effectiveUntil', value: '2027-12-31', interpretation: 'business_end', confidence: 0.9, evidenceRefs: ['e1'], reasoningSummary: 'Explicit end date', criticality: 'high', ...patch });

describe('TemporalCandidateValidatorService', () => {
  const service = new TemporalCandidateValidatorService({ isEnabled: () => true } as never);

  it('accepts a strict date backed by matching evidence', () => {
    expect(service.validate(candidate(), { evidence: [evidence] }).status).toBe('accepted_candidate');
  });

  it.each([
    [candidate({ value: '31/12/2027' }), {}, 'date_invalid'],
    [candidate({ value: '2026-02-31' }), {}, 'date_invalid'],
    [candidate({ value: '2026-02-31T00:00:00Z' }), {}, 'date_invalid'],
    [candidate({ value: undefined }), {}, 'candidate_value_missing'],
    [candidate({ evidenceRefs: ['missing'] }), {}, 'evidence_missing'],
    [candidate({ interpretation: 'publication_date' }), {}, 'publication_not_expiry'],
    [candidate({ interpretation: 'relative_duration' }), {}, 'relative_duration_anchor_missing'],
    [candidate({ interpretation: 'until_funds_exhausted' }), {}, 'funds_expiry_fabricated'],
    [candidate({ interpretation: 'until_replaced', value: undefined, mode: 'until_replaced' }), {}, 'review_schedule_required'],
  ])('rejects invalid temporal semantics', (input, context, code) => {
    const result = service.validate(input as TemporalCandidate, { evidence: [evidence], ...context });
    expect(result.status).toBe('rejected');
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  it('marks competing accepted values as conflicting', () => {
    const secondEvidence = { ...evidence, id: 'e2', value: '2028-01-31' };
    const results = service.validateSet([candidate(), candidate({ candidateId: 'c2', value: '2028-01-31', evidenceRefs: ['e2'] })], { evidence: [evidence, secondEvidence] });
    expect(results.map((result) => result.status)).toEqual(['conflicting', 'conflicting']);
  });

  it('rejects invalid runtime enums, confidence, and mismatched evidence fields', () => {
    const result = service.validate(candidate({ field: 'validityMode', mode: 'bogus' as TemporalCandidate['mode'], value: undefined, confidence: 2 }), { evidence: [evidence] });
    expect(result.status).toBe('rejected');
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['candidate_mode_invalid', 'candidate_confidence_invalid', 'evidence_field_mismatch']));
  });
});
