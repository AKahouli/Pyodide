import { Injectable } from '@nestjs/common';
import type { AssessmentFactor, KnowledgeAssessmentContext, KnowledgeEvaluator } from '@modules/knowledge-intelligence/domain/knowledge-steward';
import { dimension, numberValue, stringValue, unknownFactor } from './knowledge-evaluator.utils';

@Injectable()
export class SearchQualityEvaluator implements KnowledgeEvaluator {
  readonly key = 'searchQuality' as const;
  async evaluate(context: KnowledgeAssessmentContext) {
    const metadata = context.document.metadata;
    const factors: AssessmentFactor[] = [];
    const knownScores: number[] = [];
    const ready = context.document.indexingStatus === 'ready' ? 100 : 0;
    knownScores.push(ready); factors.push({ code: 'search.index_readiness', contribution: ready, message: ready ? 'The document is indexed and ready.' : 'The document is not ready for search.' });
    const language = stringValue(metadata.language) ?? stringValue(metadata.detected_language);
    const languageScore = language ? 100 : 40;
    knownScores.push(languageScore); factors.push({ code: language ? 'search.language_detected' : 'search.language_missing', contribution: languageScore, message: language ? `Detected language: ${language}.` : 'No language was detected.' });
    const metadataCount = numberValue(metadata.metadataCount) ?? Object.keys(metadata).length;
    const metadataScore = Math.min(100, metadataCount * 12.5);
    knownScores.push(metadataScore); factors.push({ code: 'search.metadata_coverage', contribution: metadataScore, message: `${metadataCount} metadata field(s) are available.` });
    const genericTitle = /^(document|file|untitled|scan|parkour)(\.[a-z0-9]+)?$/i.test(context.document.originalName.trim());
    const titleScore = genericTitle || context.document.originalName.trim().length < 5 ? 35 : 100;
    knownScores.push(titleScore); factors.push({ code: titleScore === 100 ? 'search.title_descriptive' : 'search.title_generic', contribution: titleScore, message: titleScore === 100 ? 'The document title is descriptive.' : 'The document title is generic.' });
    factors.push(
      unknownFactor('search.sections_unknown', 'Section count is not available from the current indexing contract.'),
      unknownFactor('search.blocks_unknown', 'Block count is not available from the current indexing contract.'),
      unknownFactor('search.concepts_unknown', 'Concept count is not available from the current indexing contract.'),
      unknownFactor('search.graph_degree_unknown', 'Graph degree is not available from the current indexing contract.'),
      unknownFactor('search.citation_resolution_unknown', 'Citation-resolution quality is not available yet.'),
      unknownFactor('search.duplicate_probability_unknown', 'Duplicate probability is not available yet.'),
      unknownFactor('search.document_isolation_unknown', 'Document-isolation verification belongs to the governed-search phase.'),
    );
    return dimension(knownScores.reduce((sum, value) => sum + value, 0) / knownScores.length, factors);
  }
}
