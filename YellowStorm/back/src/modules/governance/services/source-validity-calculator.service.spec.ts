import { SourceValidityCalculatorService } from './source-validity-calculator.service';
import type { SourceValidity } from '../domain/source-validity';

const baseValidity = (): SourceValidity => ({ mode: 'unknown', businessStatus: 'unknown', confidence: 0, evidence: [], manuallyOverridden: false });

describe('SourceValidityCalculatorService', () => {
  const service = new SourceValidityCalculatorService();
  const now = new Date('2026-07-13T12:00:00.000Z');

  it('keeps unknown validity explicit', () => {
    expect(service.computeBusinessStatus(baseValidity(), now)).toBe('unknown');
  });

  it('derives scheduled, valid, review-needed, and expired states deterministically', () => {
    expect(service.computeBusinessStatus({ ...baseValidity(), mode: 'fixed_date', effectiveFrom: new Date('2026-07-14T00:00:00.000Z'), effectiveUntil: new Date('2026-08-01T00:00:00.000Z') }, now)).toBe('scheduled');
    expect(service.computeBusinessStatus({ ...baseValidity(), mode: 'fixed_date', effectiveUntil: new Date('2026-08-01T00:00:00.000Z') }, now)).toBe('valid');
    expect(service.computeBusinessStatus({ ...baseValidity(), mode: 'open_ended', nextReviewAt: new Date('2026-07-12T00:00:00.000Z') }, now)).toBe('needs_review');
    expect(service.computeBusinessStatus({ ...baseValidity(), mode: 'fixed_date', effectiveUntil: new Date('2026-07-13T12:00:00.000Z') }, now)).toBe('expired');
  });

  it('computes review dates and rejects inconsistent ranges', () => {
    expect(service.computeNextReviewAt({ lastReviewedAt: new Date('2026-07-01T00:00:00.000Z'), reviewFrequencyDays: 30 })?.toISOString()).toBe('2026-07-31T00:00:00.000Z');
    expect(service.validateValidityState({ ...baseValidity(), mode: 'fixed_date', effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), effectiveUntil: new Date('2026-07-01T00:00:00.000Z') }).valid).toBe(false);
  });

  it('keeps an inclusive date valid through the end of that UTC day', () => {
    expect(service.computeBusinessStatus({ ...baseValidity(), mode: 'fixed_date', effectiveUntil: new Date('2026-07-13T00:00:00.000Z'), inclusiveEnd: true }, now)).toBe('valid');
    expect(service.computeBusinessStatus({ ...baseValidity(), mode: 'fixed_date', effectiveUntil: new Date('2026-07-12T00:00:00.000Z'), inclusiveEnd: true }, now)).toBe('expired');
  });

  it('rejects invalid date objects', () => {
    expect(service.validateValidityState({ ...baseValidity(), mode: 'fixed_date', effectiveUntil: new Date('invalid') }).valid).toBe(false);
  });

  it('rejects unsupported runtime values from untyped initial validity objects', () => {
    expect(service.validateValidityState({ ...baseValidity(), mode: 'unsupported' as SourceValidity['mode'] }).valid).toBe(false);
    expect(service.validateValidityState({ ...baseValidity(), confidence: 'high' as unknown as number }).valid).toBe(false);
  });
});
