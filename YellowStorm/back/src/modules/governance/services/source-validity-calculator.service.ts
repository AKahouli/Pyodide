import { BadRequestException, Injectable } from '@nestjs/common';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import type { SourceBusinessValidityStatus, SourceValidity } from '../domain/source-validity';

export interface ReviewScheduleInput { lastReviewedAt?: Date; reviewFrequencyDays?: number; nextReviewAt?: Date; }
export interface ValidityValidationResult { valid: boolean; errors: string[]; }

@Injectable()
export class SourceValidityCalculatorService {
  computeBusinessStatus(validity: SourceValidity, now: Date): SourceBusinessValidityStatus {
    if (validity.businessStatus === 'conflicting' || validity.businessStatus === 'suspended') return validity.businessStatus;
    if (validity.mode === 'unknown') return 'unknown';
    if (validity.effectiveFrom && validity.effectiveFrom > now) return 'scheduled';
    if (validity.effectiveUntil) {
      const expiry = new Date(validity.effectiveUntil);
      if (validity.inclusiveEnd) expiry.setUTCDate(expiry.getUTCDate() + 1);
      if (expiry <= now) return 'expired';
    }
    if (validity.nextReviewAt && validity.nextReviewAt < now) return 'needs_review';
    return 'valid';
  }

  computeNextReviewAt(input: ReviewScheduleInput): Date | undefined {
    if (input.nextReviewAt) return input.nextReviewAt;
    if (!input.lastReviewedAt || !input.reviewFrequencyDays) return undefined;
    const next = new Date(input.lastReviewedAt);
    next.setUTCDate(next.getUTCDate() + input.reviewFrequencyDays);
    return next;
  }

  validateValidityState(validity: SourceValidity): ValidityValidationResult {
    const errors: string[] = [];
    if (!['fixed_date', 'relative_duration', 'until_replaced', 'until_funds_exhausted', 'open_ended', 'unknown'].includes(validity.mode)) errors.push('mode is unsupported');
    if (!['unknown', 'scheduled', 'valid', 'needs_review', 'expired', 'conflicting', 'suspended'].includes(validity.businessStatus)) errors.push('businessStatus is unsupported');
    if (typeof validity.confidence !== 'number' || !Number.isFinite(validity.confidence)) errors.push('confidence must be a finite number');
    if (validity.confidence < 0 || validity.confidence > 1) errors.push('confidence must be between 0 and 1');
    if (typeof validity.manuallyOverridden !== 'boolean') errors.push('manuallyOverridden must be boolean');
    if (!Array.isArray(validity.evidence)) errors.push('evidence must be an array');
    else for (const evidence of validity.evidence) {
      if (!evidence || typeof evidence !== 'object' || typeof evidence.id !== 'string' || !evidence.id) errors.push('evidence id is required');
      if (!['effectiveFrom', 'effectiveUntil', 'publishedAt', 'modifiedAt', 'validityMode'].includes(evidence?.field)) errors.push('evidence field is unsupported');
      if (!['manual', 'technical_metadata', 'http_header', 'html_metadata', 'structured_data', 'document_metadata', 'logical_search', 'llm_extraction', 'policy'].includes(evidence?.origin)) errors.push('evidence origin is unsupported');
      if (typeof evidence?.confidence !== 'number' || !Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1) errors.push('evidence confidence must be between 0 and 1');
    }
    if (validity.reviewFrequencyDays !== undefined && (typeof validity.reviewFrequencyDays !== 'number' || !Number.isInteger(validity.reviewFrequencyDays) || validity.reviewFrequencyDays < 1)) errors.push('reviewFrequencyDays must be a positive integer');
    if (validity.effectiveFrom && Number.isNaN(validity.effectiveFrom.getTime())) errors.push('effectiveFrom must be a valid date');
    if (validity.effectiveUntil && Number.isNaN(validity.effectiveUntil.getTime())) errors.push('effectiveUntil must be a valid date');
    if (validity.lastReviewedAt && Number.isNaN(validity.lastReviewedAt.getTime())) errors.push('lastReviewedAt must be a valid date');
    if (validity.nextReviewAt && Number.isNaN(validity.nextReviewAt.getTime())) errors.push('nextReviewAt must be a valid date');
    if (validity.effectiveFrom && validity.effectiveUntil && validity.effectiveFrom > validity.effectiveUntil) errors.push('effectiveFrom must not be after effectiveUntil');
    if (validity.mode === 'fixed_date' && !validity.effectiveUntil) errors.push('fixed_date validity requires effectiveUntil');
    return { valid: errors.length === 0, errors };
  }

  assertValid(validity: SourceValidity): void {
    const result = this.validateValidityState(validity);
    if (!result.valid) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, result.errors.join('; '));
  }
}
