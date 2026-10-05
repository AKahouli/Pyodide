import { Module, forwardRef } from '@nestjs/common';
import { AgentModule } from '@modules/agent/agent.module';
import { GovernanceRootPublicationService } from './services/governance-root-publication.service';
import { AuthorizationModule } from '@modules/authorization';
import { LoggerModule } from '@modules/logger';
import { ConversationModule } from '@modules/conversation/conversation.module';
import { WidgetChatModule } from '@modules/widget-chat/widget-chat.module';
import { TelegramModule } from '@modules/telegram';
import { UserGroupModule } from '@modules/user-group';
import { UserModule } from '@modules/user/user.module';
import { GovernanceProgramController } from './controllers/governance-program.controller';
import { GovernanceScopeController } from './controllers/governance-scope.controller';
import { GovernanceScopeAudienceController } from './controllers/governance-scope-audience.controller';
import { GovernanceConsumerController } from './controllers/governance-consumer.controller';
import { GovernedConversationController } from './controllers/governed-conversation.controller';
import { GovernanceDocumentController } from './controllers/governance-document.controller';
import { GovernanceMembershipController } from './controllers/governance-membership.controller';
import { GovernanceDeploymentController } from './controllers/governance-deployment.controller';
import { GovernanceDryRunController } from './controllers/governance-dry-run.controller';
import { GovernanceMetricController } from './controllers/governance-metric.controller';
import { GovernanceProgramService } from './services/governance-program.service';
import { GovernanceScopeService } from './services/governance-scope.service';
import { GovernanceScopeAudienceService } from './services/governance-scope-audience.service';
import { GovernanceConsumerScopeService } from './services/governance-consumer-scope.service';
import { GovernedConversationService } from './services/governed-conversation.service';
import { GovernedConversationRuntimeService } from './services/governed-conversation-runtime.service';
import { GovernanceDocumentService } from './services/governance-document.service';
import { GovernanceMembershipService } from './services/governance-membership.service';
import { GovernanceAccessService } from './services/governance-access.service';
import { GovernanceDeploymentService } from './services/governance-deployment.service';
import { GovernanceDryRunService } from './services/governance-dry-run.service';
import { GovernanceMetricService } from './services/governance-metric.service';
import { GovernanceChannelReadinessService } from './services/governance-channel-readiness.service';
import { GovernanceDraftPreparationService } from './services/governance-draft-preparation.service';
import { GovernanceScopeOverviewService } from './services/governance-scope-overview.service';
import { GovernanceWorkspaceBindingController } from './controllers/governance-workspace-binding.controller';
import { GovernanceWorkspaceBindingService } from './services/governance-workspace-binding.service';
import { WorkspaceGovernanceEventHandler } from './integration/workspace-governance-event.handler';
import { GovernanceDocumentTransitionService } from './services/governance-document-transition.service';
import { GovernanceDocumentEventService } from './services/governance-document-event.service';
import { GovernanceRuntimeModule } from './governance-runtime.module';
import { WorkspaceModule } from '@modules/workspace/workspace.module';
import { IntegrationEventsModule } from '@modules/integration-events/integration-events.module';
import { GovernanceWorkspaceReconciliationService } from './services/governance-workspace-reconciliation.service';
import { DocumentValidityCalculatorService } from './services/document-validity-calculator.service';
import { TemporalCandidateValidatorService } from './services/temporal-candidate-validator.service';
import { GovernanceDocumentReviewSchedulerService } from './services/governance-document-review-scheduler.service';
import { KnowledgeIntelligenceModule } from '@modules/knowledge-intelligence/knowledge-intelligence.module';
import { ConnectorModule } from '@modules/connector/connector.module';
import { SystemModule } from '@modules/system/system.module';
import { LogicalSearchEvidenceService } from './services/logical-search-evidence.service';
import { TemporalCandidateExtractorService } from './services/temporal-candidate-extractor.service';
import { GovernanceTemporalIntelligenceWorkerService } from './services/governance-temporal-intelligence-worker.service';
import { GovernanceTemporalCandidateService } from './services/governance-temporal-candidate.service';
import { IndexingModule } from '@modules/indexing/indexing.module';
import { GovernanceKnowledgeController } from './controllers/governance-knowledge.controller';
import { GovernanceKnowledgeAssessmentService } from './services/governance-knowledge-assessment.service';
import { KnowledgeAlertEngineService } from './services/knowledge-alert-engine.service';
import { KnowledgeRecommendationEngineService } from './services/knowledge-recommendation-engine.service';
import { MetadataCandidateEngineService } from './services/metadata-candidate-engine.service';
import { BusinessValidityEvaluator } from './services/knowledge-evaluators/business-validity.evaluator';
import { FreshnessEvaluator } from './services/knowledge-evaluators/freshness.evaluator';
import { AvailabilityEvaluator } from './services/knowledge-evaluators/availability.evaluator';
import { IntegrityEvaluator } from './services/knowledge-evaluators/integrity.evaluator';
import { SearchQualityEvaluator } from './services/knowledge-evaluators/search-quality.evaluator';
import { GovernanceQualityEvaluator } from './services/knowledge-evaluators/governance-quality.evaluator';
import { PgGovernancePersistenceModule } from './persistence/postgres/pg-governance-persistence.module';

@Module({
  imports: [
    forwardRef(() => AgentModule),
    GovernanceRuntimeModule,
    PgGovernancePersistenceModule,
    WorkspaceModule,
    AuthorizationModule,
    forwardRef(() => ConversationModule),
    WidgetChatModule,
    TelegramModule,
    UserGroupModule,
    UserModule,
    LoggerModule,
    IntegrationEventsModule,
    KnowledgeIntelligenceModule,
    ConnectorModule,
    SystemModule,
    IndexingModule,
  ],
  controllers: [GovernanceProgramController, GovernanceScopeController, GovernanceScopeAudienceController, GovernanceConsumerController, GovernedConversationController, GovernanceDocumentController, GovernanceWorkspaceBindingController, GovernanceMembershipController, GovernanceDeploymentController, GovernanceDryRunController, GovernanceMetricController, GovernanceKnowledgeController],
  providers: [GovernanceRootPublicationService, GovernanceProgramService, GovernanceScopeService, GovernanceScopeAudienceService, GovernanceConsumerScopeService, GovernedConversationService, GovernedConversationRuntimeService, GovernanceScopeOverviewService, GovernanceDocumentService, GovernanceDocumentTransitionService, GovernanceDocumentEventService, DocumentValidityCalculatorService, TemporalCandidateValidatorService, TemporalCandidateExtractorService, LogicalSearchEvidenceService, GovernanceTemporalIntelligenceWorkerService, GovernanceTemporalCandidateService, GovernanceDocumentReviewSchedulerService, GovernanceWorkspaceBindingService, GovernanceWorkspaceReconciliationService, WorkspaceGovernanceEventHandler, GovernanceMembershipService, GovernanceAccessService, GovernanceDeploymentService, GovernanceDraftPreparationService, GovernanceDryRunService, GovernanceMetricService, GovernanceChannelReadinessService, GovernanceKnowledgeAssessmentService, KnowledgeAlertEngineService, KnowledgeRecommendationEngineService, MetadataCandidateEngineService, BusinessValidityEvaluator, FreshnessEvaluator, AvailabilityEvaluator, IntegrityEvaluator, SearchQualityEvaluator, GovernanceQualityEvaluator],
  exports: [GovernanceProgramService, GovernanceScopeService, GovernanceScopeAudienceService, GovernedConversationRuntimeService, GovernanceDocumentService, GovernanceAccessService, GovernanceMetricService],
})
export class GovernanceModule {}
