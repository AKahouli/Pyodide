import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KnowledgeExtractionJob, KnowledgeExtractionJobSchema } from './schemas/knowledge-extraction-job.schema';
import { KnowledgeExtractionOrchestratorService } from './services/knowledge-extraction-orchestrator.service';
import { TemporalCandidateRecord, TemporalCandidateRecordSchema } from './schemas/temporal-candidate-record.schema';
import { TemporalCandidateRepositoryService } from './services/temporal-candidate-repository.service';
import { KnowledgeAssessment, KnowledgeAssessmentSchema } from './schemas/knowledge-assessment.schema';
import { KnowledgeAlert, KnowledgeAlertSchema } from './schemas/knowledge-alert.schema';
import { KnowledgeRecommendation, KnowledgeRecommendationSchema } from './schemas/knowledge-recommendation.schema';
import { MetadataCandidate, MetadataCandidateSchema } from './schemas/metadata-candidate.schema';
import { KnowledgeAssessmentRepositoryService } from './services/knowledge-assessment-repository.service';
import { KnowledgeAlertRepositoryService } from './services/knowledge-alert-repository.service';
import { KnowledgeRecommendationRepositoryService } from './services/knowledge-recommendation-repository.service';
import { MetadataCandidateRepositoryService } from './services/metadata-candidate-repository.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: KnowledgeExtractionJob.name, schema: KnowledgeExtractionJobSchema },
    { name: TemporalCandidateRecord.name, schema: TemporalCandidateRecordSchema },
    { name: KnowledgeAssessment.name, schema: KnowledgeAssessmentSchema },
    { name: KnowledgeAlert.name, schema: KnowledgeAlertSchema },
    { name: KnowledgeRecommendation.name, schema: KnowledgeRecommendationSchema },
    { name: MetadataCandidate.name, schema: MetadataCandidateSchema },
  ])],
  providers: [KnowledgeExtractionOrchestratorService, TemporalCandidateRepositoryService, KnowledgeAssessmentRepositoryService, KnowledgeAlertRepositoryService, KnowledgeRecommendationRepositoryService, MetadataCandidateRepositoryService],
  exports: [KnowledgeExtractionOrchestratorService, TemporalCandidateRepositoryService, KnowledgeAssessmentRepositoryService, KnowledgeAlertRepositoryService, KnowledgeRecommendationRepositoryService, MetadataCandidateRepositoryService],
})
export class KnowledgeIntelligenceModule {}
