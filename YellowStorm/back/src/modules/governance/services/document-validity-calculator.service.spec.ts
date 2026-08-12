import { DocumentValidityCalculatorService } from './document-validity-calculator.service';
import type { DocumentValidity } from '../domain/document-validity';

const baseValidity = (): DocumentValidity => ({ mode: 'unknown', businessStatus: 'unknown', confidence: 0, evidence: [], manuallyOverridden: false });

describe('DocumentValidityCalculatorService', () => {
  const service = new DocumentValidityCalculatorService();
  const now = new Date('2026-07-13T12:00:00.000Z');
  it('keeps unknown validity explicit', () => expect(service.computeBusinessStatus(baseValidity(), now)).toBe('unknown'));
  it('derives scheduled, valid, review-needed, and expired states deterministically', () => {
    expect(service.computeBusinessStatus({ ...baseValidity(), mode: 'fixed_date', effectiveFrom: new Date('2026-07-14T00:00:00.000Z'), effectiveUntil: new Date('2026-08-01T00:00:00.000Z') }, now)).toBe('scheduled');
    expect(service.computeBusinessStatus({ ...baseValidity(), mode: 'open_ended', nextReviewAt: new Date('2026-07-12T00:00:00.000Z') }, now)).toBe('needs_review');
    expect(service.computeBusinessStatus({ ...baseValidity(), mode: 'fixed_date', effectiveUntil: new Date('2026-07-13T12:00:00.000Z') }, now)).toBe('expired');
  });
  it('rejects inconsistent ranges', () => expect(service.validateValidityState({ ...baseValidity(), mode: 'fixed_date', effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), effectiveUntil: new Date('2026-07-01T00:00:00.000Z') }).valid).toBe(false));
});
