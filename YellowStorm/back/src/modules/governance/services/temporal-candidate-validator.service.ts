import { Injectable } from '@nestjs/common';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import type { TemporalCandidate, TemporalValidationContext, TemporalValidationIssue, TemporalValidationResult } from '../domain/temporal-candidate';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z)?$/;

@Injectable()
export class TemporalCandidateValidatorService {
  constructor(private readonly features: FeatureVisibilityService) {}
  validate(candidate: TemporalCandidate, context: TemporalValidationContext): TemporalValidationResult {
    if (!this.features.isEnabled('dataRoomValidityIntelligence')) return { status: 'rejected', issues: [this.blocking('validity_intelligence_disabled', 'Validity intelligence is disabled.')] };
    const issues: TemporalValidationIssue[] = [];
    const threshold = context.confidenceThreshold ?? 0.7;
    const evidence = context.evidence.filter((item) => candidate.evidenceRefs.includes(item.id));
    if (!['effectiveFrom', 'effectiveUntil', 'publishedAt', 'modifiedAt', 'validityMode'].includes(candidate.field)) issues.push(this.blocking('candidate_field_invalid', 'Candidate field is unsupported.'));
    if (!['business_start', 'business_end', 'application_deadline', 'publication_date', 'document_revision_date', 'relative_duration', 'until_replaced', 'until_funds_exhausted', 'unknown'].includes(candidate.interpretation)) issues.push(this.blocking('candidate_interpretation_invalid', 'Candidate interpretation is unsupported.'));
    if (!['low', 'medium', 'high'].includes(candidate.criticality)) issues.push(this.blocking('candidate_criticality_invalid', 'Candidate criticality is unsupported.'));
    if (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) issues.push(this.blocking('candidate_confidence_invalid', 'Candidate confidence must be between 0 and 1.'));
    if (candidate.mode && !['fixed_date', 'relative_duration', 'until_replaced', 'until_funds_exhausted', 'open_ended', 'unknown'].includes(candidate.mode)) issues.push(this.blocking('candidate_mode_invalid', 'Candidate validity mode is unsupported.'));
    if (candidate.field === 'validityMode' ? !candidate.mode : !candidate.value) issues.push(this.blocking('candidate_value_missing', 'The candidate must provide a value or validity mode.'));
    if (candidate.evidenceRefs.length === 0 || evidence.length !== candidate.evidenceRefs.length) issues.push(this.blocking('evidence_missing', 'Every candidate must reference available evidence.'));
    if (evidence.some((item) => item.field !== candidate.field)) issues.push(this.blocking('evidence_field_mismatch', 'Referenced evidence must support the candidate field.'));
    if (candidate.value && this.isDateField(candidate.field) && !this.isStrictDate(candidate.value)) issues.push(this.blocking('date_invalid', 'The candidate date must be a strict ISO date.'));
    if (candidate.field === 'effectiveUntil' && candidate.interpretation === 'publication_date') issues.push(this.blocking('publication_not_expiry', 'A publication date cannot be used as an expiry date.'));
    if (candidate.interpretation === 'relative_duration' && !context.relativeDurationAnchor) issues.push(this.blocking('relative_duration_anchor_missing', 'Relative duration requires an anchor date.'));
    if (candidate.interpretation === 'until_funds_exhausted' && candidate.value) issues.push(this.blocking('funds_expiry_fabricated', 'Funds exhaustion cannot fabricate a fixed end date.'));
    if (candidate.interpretation === 'until_replaced' && !context.reviewFrequencyDays) issues.push(this.blocking('review_schedule_required', 'Until-replaced validity requires a review schedule.'));
    if (candidate.value && evidence.length > 0 && !evidence.some((item) => String(item.value ?? '').includes(candidate.value!) || item.excerpt?.includes(candidate.value!))) issues.push(this.blocking('evidence_value_mismatch', 'Referenced evidence does not contain the proposed value.'));
    if (candidate.confidence < threshold) issues.push({ code: 'confidence_below_threshold', severity: 'warning', message: 'Candidate confidence is below policy threshold.' });
    if (issues.some((issue) => issue.severity === 'blocking')) return { status: 'rejected', issues };
    return { status: candidate.confidence < threshold ? 'ambiguous' : 'accepted_candidate', normalizedCandidate: candidate, issues };
  }

  validateSet(candidates: TemporalCandidate[], context: TemporalValidationContext): TemporalValidationResult[] {
    const results = candidates.map((candidate) => this.validate(candidate, context));
    for (const field of new Set(candidates.map((candidate) => candidate.field))) {
      const accepted = candidates.map((candidate, index) => ({ candidate, index })).filter(({ candidate, index }) => candidate.field === field && results[index].status === 'accepted_candidate');
      if (new Set(accepted.map(({ candidate }) => candidate.value ?? candidate.mode)).size > 1) for (const { index } of accepted) results[index] = { ...results[index], status: 'conflicting', issues: [...results[index].issues, this.blocking('candidate_conflict', 'Candidates propose conflicting values for the same field.')] };
    }
    return results;
  }

  private isDateField(field: TemporalCandidate['field']): boolean { return field !== 'validityMode'; }
  private isStrictDate(value: string): boolean { if (!ISO_DATE.test(value)) return false; const parsed = new Date(value); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value.slice(0, 10); }
  private blocking(code: string, message: string): TemporalValidationIssue { return { code, severity: 'blocking', message }; }
}
