import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import { AuthorizationModule } from '@modules/authorization';
import { LoggerModule } from '@modules/logger';
import { WorkspaceModule } from '@modules/workspace';
import { SemanticModelController } from './controllers/semantic-model.controller';
import { WorkspaceSemanticModelController } from './controllers/workspace-semantic-model.controller';
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
import { SemanticModelMappingProposalService } from './services/semantic-model-mapping-proposal.service';
import { SemanticModelValidationService } from './services/semantic-model-validation.service';
import { SemanticModelVersionService } from './services/semantic-model-version.service';
import { SemanticModelWorkspaceService } from './services/semantic-model-workspace.service';

@Module({
  imports: [ConfigModule.forFeature(semanticModelConfig),AuthorizationModule,LoggerModule,forwardRef(() => WorkspaceModule)],
  controllers: [SemanticModelController,WorkspaceSemanticModelController],
  providers: [
    SemanticModelDatabaseService,SemanticModelRepository,SemanticGraphRepository,SemanticModelOntologyRepository,SemanticAgeGraphRepository,SemanticModelService,
    SemanticGraphCommandService,SemanticModelValidationService,SemanticModelWorkspaceService,
    SemanticKnowledgeBindingService,SemanticModelVersionService,SemanticModelProvisioningService,
    SemanticModelOntologyGenerationService,
    SemanticModelCorpusPreparationService,
    SemanticModelEvidenceSearchService,
    SemanticModelMappingProposalService,
  ],
  exports: [SemanticModelDatabaseService,SemanticModelProvisioningService],
})
export class SemanticModelModule {}
