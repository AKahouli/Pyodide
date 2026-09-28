import { Module } from '@nestjs/common';
import { KnowledgeExtractionOrchestratorService } from './services/knowledge-extraction-orchestrator.service';
import { TemporalCandidateRepositoryService } from './services/temporal-candidate-repository.service';
import { KnowledgeAssessmentRepositoryService } from './services/knowledge-assessment-repository.service';
import { KnowledgeAlertRepositoryService } from './services/knowledge-alert-repository.service';
import { KnowledgeRecommendationRepositoryService } from './services/knowledge-recommendation-repository.service';
import { MetadataCandidateRepositoryService } from './services/metadata-candidate-repository.service';

// P6 cutover: the repositories read and write governance.knowledge_* through the global Drizzle connection.
@Module({
  providers: [KnowledgeExtractionOrchestratorService, TemporalCandidateRepositoryService, KnowledgeAssessmentRepositoryService, KnowledgeAlertRepositoryService, KnowledgeRecommendationRepositoryService, MetadataCandidateRepositoryService],
  exports: [KnowledgeExtractionOrchestratorService, TemporalCandidateRepositoryService, KnowledgeAssessmentRepositoryService, KnowledgeAlertRepositoryService, KnowledgeRecommendationRepositoryService, MetadataCandidateRepositoryService],
})
export class KnowledgeIntelligenceModule {}
