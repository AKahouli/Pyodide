import { SemanticExtractionSettingsController } from './controllers/semantic-extraction-settings.controller';
import { SemanticDerivedSourceController } from './controllers/semantic-derived-source.controller';
import { SemanticDerivedSourceService } from './services/semantic-derived-source.service';
import { SemanticExtractionSettingsService } from './services/semantic-extraction-settings.service';
import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import { AuthorizationModule } from '@modules/authorization';
import { LoggerModule } from '@modules/logger';
import { UserModule } from '@modules/user';
import { WorkspaceModule } from '@modules/workspace';
import { IntegrationEventsModule } from '@modules/integration-events/integration-events.module';
import { SemanticModelController } from './controllers/semantic-model.controller';
import { SemanticAttributeExtractionInternalController } from './controllers/semantic-attribute-extraction-internal.controller';
import { SemanticAttributeExtractionService } from './services/semantic-attribute-extraction.service';
import { WorkspaceSemanticModelController } from './controllers/workspace-semantic-model.controller';
import { SemanticDataTokenController } from './controllers/semantic-data-token.controller';
import { SemanticModelDatabaseService } from './infrastructure/semantic-model-database.service';
import { SemanticGraphRepository } from './repositories/semantic-graph.repository';
import { SemanticModelRepository } from './repositories/semantic-model.repository';
import { SemanticGraphCommandService } from './services/semantic-graph-command.service';
import { SemanticKnowledgeBindingService } from './services/semantic-knowledge-binding.service';
import { SemanticModelProvisioningService } from './services/semantic-model-provisioning.service';
import { SemanticModelService } from './services/semantic-model.service';
import { SemanticModelNativeSearchClient } from './services/semantic-model-native-search-client.service';
import { SemanticModelValidationService } from './services/semantic-model-validation.service';
import { SemanticModelVersionService } from './services/semantic-model-version.service';
import { SemanticModelWorkspaceService } from './services/semantic-model-workspace.service';
import { SemanticSourceMappingService } from './services/semantic-source-mapping.service';
import { SemanticModelShareService } from './services/semantic-model-share.service';
import { DocumentExtractionConceptResolver } from './services/document-extraction-concept.resolver';
import { SemanticCrossSourceService } from './services/semantic-cross-source.service';
import { SemanticBusinessTrustService } from './services/semantic-business-trust.service';
import { SemanticReviewQueueService } from './services/semantic-review-queue.service';
import { ModelSpecificationService } from './services/model-specification.service';
import { SemanticDataTokenService } from './services/semantic-data-token.service';
import { SemanticRuntimeClientService } from './services/semantic-runtime-client.service';
import { SemanticPopulationRefreshService } from './services/semantic-population-refresh.service';
import { SemanticModelSourceEventHandler } from './integration/semantic-model-source-event.handler';
import { SemanticModelSourceReconciliationService } from './integration/semantic-model-source-reconciliation.service';
import { SemanticDataGrantService } from './services/semantic-data-grant.service';
import { SemanticAccessEventHandler } from './integration/semantic-access-event.handler';
import { SemanticDataGrantRevocationService } from './services/semantic-data-grant-revocation.service';
import { SemanticRealtimeSignalService } from './services/semantic-realtime-signal.service';
import { SemanticModelAssistantService } from './services/semantic-model-assistant.service';
import { SemanticGraphSearchService } from './services/semantic-graph-search.service';
import { SemanticModelAssistantInternalController } from './controllers/semantic-model-assistant-internal.controller';
import { SemanticAssistantActorGuard, SemanticAssistantModelGuard } from './guards/semantic-assistant-actor.guard';

@Module({
  imports: [ConfigModule.forFeature(semanticModelConfig),AuthorizationModule,LoggerModule,UserModule,IntegrationEventsModule,forwardRef(() => WorkspaceModule)],
  controllers: [SemanticExtractionSettingsController,SemanticDerivedSourceController,SemanticModelController,WorkspaceSemanticModelController,SemanticDataTokenController,SemanticAttributeExtractionInternalController,SemanticModelAssistantInternalController],
  providers: [
    SemanticModelDatabaseService,SemanticExtractionSettingsService,SemanticDerivedSourceService,SemanticModelRepository,SemanticGraphRepository,SemanticModelService,
    SemanticGraphCommandService,SemanticModelValidationService,SemanticModelWorkspaceService,
    SemanticKnowledgeBindingService,SemanticModelVersionService,SemanticModelProvisioningService,
    SemanticModelNativeSearchClient,
    SemanticAttributeExtractionService,
    SemanticModelShareService,
    SemanticSourceMappingService,
    DocumentExtractionConceptResolver,
    SemanticCrossSourceService,
    SemanticBusinessTrustService,
    SemanticReviewQueueService,
    ModelSpecificationService,
    SemanticDataTokenService,
    SemanticDataGrantService,
    SemanticDataGrantRevocationService,
    SemanticRealtimeSignalService,
    SemanticRuntimeClientService,
    SemanticPopulationRefreshService,
    SemanticModelSourceEventHandler,
    SemanticModelSourceReconciliationService,
    SemanticAccessEventHandler,
    SemanticModelAssistantService,
    SemanticGraphSearchService,
    SemanticAssistantActorGuard,
    SemanticAssistantModelGuard,
  ],
  exports: [SemanticModelDatabaseService,SemanticModelProvisioningService,SemanticModelService,SemanticDataGrantRevocationService],
})
export class SemanticModelModule {}
