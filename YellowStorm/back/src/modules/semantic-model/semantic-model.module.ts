import { Module, forwardRef } from '@nestjs/common';
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
import { SemanticAgeGraphRepository } from './repositories/semantic-age-graph.repository';
import { SemanticGraphRepository } from './repositories/semantic-graph.repository';
import { SemanticModelRepository } from './repositories/semantic-model.repository';
import { SemanticModelOntologyRepository } from './repositories/semantic-model-ontology.repository';
import { SemanticGraphCommandService } from './services/semantic-graph-command.service';
import { SemanticKnowledgeBindingService } from './services/semantic-knowledge-binding.service';
import { SemanticModelProvisioningService } from './services/semantic-model-provisioning.service';
import { SemanticModelService } from './services/semantic-model.service';
import { SemanticModelOntologyGenerationService } from './services/semantic-model-ontology-generation.service';
import { SemanticModelCorpusPreparationService } from './services/semantic-model-corpus-preparation.service';
import { SemanticModelEvidenceSearchService } from './services/semantic-model-evidence-search.service';
import { SemanticModelNativeSearchClient } from './services/semantic-model-native-search-client.service';
import { SemanticModelMappingProposalService } from './services/semantic-model-mapping-proposal.service';
import { SemanticModelBuildOrchestratorService } from './services/semantic-model-build-orchestrator.service';
import { SemanticModelValidationService } from './services/semantic-model-validation.service';
import { SemanticModelVersionService } from './services/semantic-model-version.service';
import { SemanticModelWorkspaceService } from './services/semantic-model-workspace.service';
import { SemanticSourceMappingService } from './services/semantic-source-mapping.service';
import { SemanticModelShareService } from './services/semantic-model-share.service';
import { SemanticSearchGraphClient } from './services/semantic-search-graph-client.service';
import { SemanticGraphIndexJobService } from './services/semantic-graph-index-job.service';
import { SemanticGraphIndexWorkerService } from './services/semantic-graph-index-worker.service';
import { DocumentExtractionConceptResolver } from './services/document-extraction-concept.resolver';
import { SemanticCrossSourceService } from './services/semantic-cross-source.service';
import { SemanticBusinessTrustService } from './services/semantic-business-trust.service';
import { ModelSpecificationService } from './services/model-specification.service';
import { SemanticDataTokenService } from './services/semantic-data-token.service';
import { SemanticRuntimeClientService } from './services/semantic-runtime-client.service';
import { SemanticPopulationRefreshService } from './services/semantic-population-refresh.service';
import { SemanticModelSourceEventHandler } from './integration/semantic-model-source-event.handler';
import { SemanticModelSourceReconciliationService } from './integration/semantic-model-source-reconciliation.service';
import { SemanticDataGrantService } from './services/semantic-data-grant.service';
import { SemanticExecutionOwnershipService } from './services/semantic-execution-ownership.service';
import { SemanticAccessEventHandler } from './integration/semantic-access-event.handler';
import { SemanticDataGrantRevocationService } from './services/semantic-data-grant-revocation.service';
import { SemanticRealtimeSignalService } from './services/semantic-realtime-signal.service';

@Module({
  imports: [ConfigModule.forFeature(semanticModelConfig),AuthorizationModule,LoggerModule,UserModule,IntegrationEventsModule,forwardRef(() => WorkspaceModule)],
  controllers: [SemanticModelController,WorkspaceSemanticModelController,SemanticDataTokenController],
  providers: [
    SemanticModelDatabaseService,SemanticModelRepository,SemanticGraphRepository,SemanticModelOntologyRepository,SemanticAgeGraphRepository,SemanticModelService,
    SemanticGraphCommandService,SemanticModelValidationService,SemanticModelWorkspaceService,
    SemanticKnowledgeBindingService,SemanticModelVersionService,SemanticModelProvisioningService,
    SemanticModelOntologyGenerationService,
    SemanticModelCorpusPreparationService,
    SemanticModelNativeSearchClient,
    SemanticModelEvidenceSearchService,
    SemanticSearchGraphClient,
    SemanticGraphIndexJobService,
    SemanticGraphIndexWorkerService,
    SemanticModelMappingProposalService,
    SemanticModelBuildOrchestratorService,
    SemanticModelShareService,
    SemanticSourceMappingService,
    DocumentExtractionConceptResolver,
    SemanticCrossSourceService,
    SemanticBusinessTrustService,
    ModelSpecificationService,
    SemanticDataTokenService,
    SemanticDataGrantService,
    SemanticDataGrantRevocationService,
    SemanticExecutionOwnershipService,
    SemanticRealtimeSignalService,
    SemanticRuntimeClientService,
    SemanticPopulationRefreshService,
    SemanticModelSourceEventHandler,
    SemanticModelSourceReconciliationService,
    SemanticAccessEventHandler,
  ],
  exports: [SemanticModelDatabaseService,SemanticModelProvisioningService,SemanticModelService,SemanticDataGrantRevocationService],
})
export class SemanticModelModule {}
