import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { KnowledgeAssessmentContext } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import type { MetadataCandidateInput } from '@modules/knowledge-intelligence/services/metadata-candidate-repository.service';

@Injectable()
export class MetadataCandidateEngineService {
  build(programId: string, context: KnowledgeAssessmentContext): MetadataCandidateInput[] {
    const governanceMetadata = context.governance.metadata;
    const extracted = context.document.metadata;
    const candidates: MetadataCandidateInput[] = [];
    const observed: Array<{ key: string; value: unknown; confidence: number }> = [
      { key: 'title', value: extracted.title, confidence: 0.9 },
      { key: 'language', value: extracted.language ?? extracted.detected_language, confidence: 0.95 },
      { key: 'publisher', value: extracted.publisher, confidence: 0.8 },
      { key: 'author', value: extracted.author, confidence: 0.8 },
      { key: 'version', value: extracted.version, confidence: 0.75 },
    ];
    for (const item of observed) {
      if (typeof item.value !== 'string' || !item.value.trim() || governanceMetadata[item.key] === item.value.trim()) continue;
      const proposedValue = item.value.trim().slice(0, 1000);
      const candidateKey = createHash('sha256').update(`${context.document.id}:${item.key}:${proposedValue}`).digest('hex');
      candidates.push({ programId, scopeIds: context.binding.scopeIds, documentId: context.document.id, key: item.key, proposedValue, candidateType: 'document', confidence: item.confidence, riskLevel: item.key === 'title' ? 'medium' : 'low', evidenceRefs: [`document:${context.document.id}:metadata.${item.key}`], candidateKey });
    }
    return candidates;
  }
}
