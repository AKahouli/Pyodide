import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { ValidityEvidence } from '../domain/document-validity';
import type { TemporalCandidate, TemporalCandidateField, TemporalInterpretation } from '../domain/temporal-candidate';

const DATE_PATTERN = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b|\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2})\b/g;

@Injectable()
export class TemporalCandidateExtractorService {
  extract(evidence: ValidityEvidence[]): { candidate: TemporalCandidate; evidence: ValidityEvidence }[] {
    const candidates: { candidate: TemporalCandidate; evidence: ValidityEvidence }[] = [];
    for (const item of evidence) {
      const excerpt = item.excerpt ?? '';
      for (const match of excerpt.matchAll(DATE_PATTERN)) {
        const value = this.normalize(match);
        if (!value) continue;
        const intent = this.intent(excerpt.slice(Math.max(0, (match.index ?? 0) - 100), (match.index ?? 0) + match[0].length + 100));
        if (!intent) continue;
        const evidenceItem = { ...item, id: `${item.id}:${intent.field}:${value}`, field: intent.field, value };
        candidates.push({ evidence: evidenceItem, candidate: { candidateId: createHash('sha256').update(evidenceItem.id).digest('hex').slice(0, 32), field: intent.field, value, interpretation: intent.interpretation, confidence: item.confidence, evidenceRefs: [evidenceItem.id], reasoningSummary: intent.summary, criticality: intent.field === 'effectiveUntil' ? 'high' : 'medium' } });
      }
      if (/until\s+(?:replaced|superseded)|jusqu['’]?à\s+(?:remplacement|nouvel ordre)/i.test(excerpt)) {
        const evidenceItem = { ...item, id: `${item.id}:validityMode:until_replaced`, field: 'validityMode' as const, value: 'until_replaced' };
        candidates.push({ evidence: evidenceItem, candidate: { candidateId: createHash('sha256').update(evidenceItem.id).digest('hex').slice(0, 32), field: 'validityMode', mode: 'until_replaced', interpretation: 'until_replaced', confidence: item.confidence, evidenceRefs: [evidenceItem.id], reasoningSummary: 'The source states that it remains valid until it is replaced.', criticality: 'high' } });
      }
    }
    return Array.from(new Map(candidates.map((item) => [`${item.candidate.field}:${item.candidate.value ?? item.candidate.mode}`, item])).values());
  }

  private normalize(match: RegExpMatchArray): string | undefined {
    const year = match[1] ?? match[6]; const month = match[2] ?? match[5]; const day = match[3] ?? match[4];
    const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
  }
  private intent(context: string): { field: TemporalCandidateField; interpretation: TemporalInterpretation; summary: string } | undefined {
    if (/deadline|expires?|expiry|valid\s+until|end\s+date|date\s+limite|échéance|expire|valable\s+jusqu/i.test(context)) return { field: 'effectiveUntil', interpretation: /deadline|date\s+limite|échéance/i.test(context) ? 'application_deadline' : 'business_end', summary: 'An expiry or deadline expression occurs next to this date.' };
    if (/effective\s+(?:from|date)|starts?|valid\s+from|entry\s+into\s+force|prise\s+d['’]?effet|à\s+compter|début/i.test(context)) return { field: 'effectiveFrom', interpretation: 'business_start', summary: 'An effective-start expression occurs next to this date.' };
    if (/published?|publication|publié/i.test(context)) return { field: 'publishedAt', interpretation: 'publication_date', summary: 'A publication expression occurs next to this date.' };
    if (/modified|updated|revised|révisé|mis[e]?\s+à\s+jour/i.test(context)) return { field: 'modifiedAt', interpretation: 'document_revision_date', summary: 'A revision expression occurs next to this date.' };
    return undefined;
  }
}
