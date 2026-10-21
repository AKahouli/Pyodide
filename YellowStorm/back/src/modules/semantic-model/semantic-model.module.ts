import { SemanticExtractionSettingsController } from './controllers/semantic-extraction-settings.controller';
import { SemanticDerivedSourceController } from './controllers/semantic-derived-source.controller';
import { SemanticDerivedSourceService } from './services/semantic-derived-source.service';
import { SemanticMappingPresetController } from './controllers/semantic-mapping-preset.controller';
import { SemanticDataConnectionController } from './controllers/semantic-data-connection.controller';
import { SemanticDataConnectionService } from './services/semantic-data-connection.service';
import { SemanticMappingPresetService } from './services/semantic-mapping-preset.service';
import { SemanticExtractionSettingsService } from './services/semantic-extraction-settings.service';
import { SemanticSearchSettingsService } from './services/semantic-search-settings.service';
import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConfigModule } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import { AuthorizationModule } from '@modules/authorization';
import { LoggerModule } from '@modules/logger';
import { UserModule } from '@modules/user';
import { WorkspaceModule } from '@modules/workspace';
import { IntegrationEventsModule } from '@modules/integration-events/integration-events.module';
import { SemanticModelController } from './controllers/semantic-model.controller';
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
import { SemanticSourceAccessService } from './services/semantic-source-access.service';
import { SemanticModelShareService } from './services/semantic-model-share.service';
import { DocumentExtractionConceptResolver } from './services/document-extraction-concept.resolver';
import { SemanticCrossSourceService } from './services/semantic-cross-source.service';
import { SemanticBusinessTrustService } from './services/semantic-business-trust.service';
import { SemanticModelHealthService } from './services/semantic-model-health.service';
import { SemanticReviewQueueService } from './services/semantic-review-queue.service';
import { ModelSpecificationService } from './services/model-specification.service';
import { SemanticDataTokenService } from './services/semantic-data-token.service';
import { SemanticRuntimeClientService } from './services/semantic-runtime-client.service';
import { SemanticPopulationRefreshService } from './services/semantic-population-refresh.service';
import { SemanticModelCheckService } from './services/semantic-model-check.service';
import { SemanticModelSourceEventHandler } from './integration/semantic-model-source-event.handler';
import { SemanticModelSourceReconciliationService } from './integration/semantic-model-source-reconciliation.service';
import { SemanticDataGrantService } from './services/semantic-data-grant.service';
import { SemanticAccessEventHandler } from './integration/semantic-access-event.handler';
import { SemanticDataGrantRevocationService } from './services/semantic-data-grant-revocation.service';
import { SemanticRealtimeSignalService } from './services/semantic-realtime-signal.service';
import { SemanticModelAssistantService } from './services/semantic-model-assistant.service';
import { SemanticGraphSearchService } from './services/semantic-graph-search.service';
import { SemanticRecordCitationService } from './services/semantic-record-citation.service';
import { SemanticModelAssistantInternalController } from './controllers/semantic-model-assistant-internal.controller';
import { SemanticAssistantModelGuard } from './guards/semantic-assistant-model.guard';
import { DelegatedActorGuard } from '@modules/auth/guards/delegated-actor.guard';
// Registered locally (the connector module does not import this module) so the
// shared delegated-user guard (ADR-0024) can verify the actor assertion with the
// shared key pair.
import { McpJwtService } from '../connector/services/mcp-jwt.service';
import { PgConnectorStore } from '../connector/persistence/pg-connector.store';
import { SemanticAssetGrantService } from './services/semantic-asset-grant.service';

@Module({
  imports: [ConfigModule.forFeature(semanticModelConfig),AuthorizationModule,LoggerModule,UserModule,IntegrationEventsModule,forwardRef(() => WorkspaceModule),forwardRef(() => NotificationsModule)],
  controllers: [SemanticExtractionSettingsController,SemanticDerivedSourceController,SemanticMappingPresetController,SemanticDataConnectionController,SemanticModelController,WorkspaceSemanticModelController,SemanticDataTokenController,SemanticModelAssistantInternalController],
  providers: [
    SemanticAssetGrantService,
    SemanticModelDatabaseService,SemanticExtractionSettingsService,SemanticSearchSettingsService,SemanticDerivedSourceService,SemanticMappingPresetService,SemanticDataConnectionService,SemanticModelRepository,SemanticGraphRepository,SemanticModelService,
    SemanticGraphCommandService,SemanticModelValidationService,SemanticModelWorkspaceService,
    SemanticKnowledgeBindingService,SemanticModelVersionService,SemanticModelProvisioningService,
    SemanticModelNativeSearchClient,
    SemanticModelShareService,
    SemanticSourceMappingService,
    SemanticSourceAccessService,
    DocumentExtractionConceptResolver,
    SemanticCrossSourceService,
    SemanticBusinessTrustService,
    SemanticReviewQueueService,
    SemanticModelHealthService,
    ModelSpecificationService,
    SemanticDataTokenService,
    SemanticDataGrantService,
    SemanticDataGrantRevocationService,
    SemanticRealtimeSignalService,
    SemanticRuntimeClientService,
    SemanticPopulationRefreshService,
    SemanticModelCheckService,
    SemanticModelSourceEventHandler,
    SemanticModelSourceReconciliationService,
    SemanticAccessEventHandler,
    SemanticModelAssistantService,
    SemanticGraphSearchService,
    SemanticRecordCitationService,
    McpJwtService,
    PgConnectorStore,
    DelegatedActorGuard,
    SemanticAssistantModelGuard,
  ],
  exports: [SemanticAssetGrantService,SemanticModelDatabaseService,SemanticModelProvisioningService,SemanticModelService,SemanticDataGrantRevocationService],
})
export class SemanticModelModule {}
