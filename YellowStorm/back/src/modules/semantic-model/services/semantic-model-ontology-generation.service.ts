import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import { ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { GenerateSemanticModelOntologyDto } from '../dto';
import { SemanticModelOntologyArtifact, SemanticModelOntologyRepository } from '../repositories/semantic-model-ontology.repository';
import { SemanticGraphCommandService } from './semantic-graph-command.service';
import { SemanticModelService } from './semantic-model.service';

export interface OntologyGenerationResponse {
  ontologyDefinition: Record<string, unknown>;
  ontologyTtl: string;
}

@Injectable()
export class SemanticModelOntologyGenerationService {
  private readonly logger = new Logger(SemanticModelOntologyGenerationService.name);

  constructor(
    @Inject(semanticModelConfig.KEY)
    private readonly smConfig: ConfigType<typeof semanticModelConfig>,
    private readonly config: ConfigService,
    private readonly models: SemanticModelService,
    private readonly graph: SemanticGraphCommandService,
    private readonly ontologyArtifacts: SemanticModelOntologyRepository,
  ) {}

  async generate(
    userId: string,
    modelId: string,
    dto: GenerateSemanticModelOntologyDto,
  ): Promise<SemanticModelOntologyArtifact> {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const graph = await this.graph.getGraph(userId, modelId, 'structure');
    const adkUrl = (this.config.get<string>('indexing.apiAdk') || 'http://localhost:8001').replace(/\/$/, '');
    const apiKey = this.config.get<string>('indexing.adkApiKey') || '';

    if (!apiKey) {
      throw new ServiceUnavailableException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'ADK_API_KEY is not configured for semantic ontology generation',
      );
    }

    const endpoint = `${adkUrl}/semantic-model/ontologies/generate`;
    this.logger.log(`ADK ontology request → ${endpoint}`);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          modelId,
          businessRequirements: dto.businessRequirements.map((text) => ({ text: text.trim() })),
          graphDesignerCanvas: { name: model.name, ...graph },
        }),
        // No timeout: ontology generation runs inside the async build orchestrator with heartbeat.
        // (fetch has no deadline unless a signal is set, matching axios `timeout: 0`.)
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
      }
      const data = await res.json() as OntologyGenerationResponse;
      if (!data || typeof data.ontologyDefinition !== 'object' || Array.isArray(data.ontologyDefinition)
        || typeof data.ontologyTtl !== 'string' || !data.ontologyTtl.trim()) {
        throw new Error('ADK returned an invalid ontology generation response');
      }
      return this.ontologyArtifacts.upsert(modelId, data.ontologyDefinition, data.ontologyTtl);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Semantic ontology generation failed [${endpoint}]: ${detail}`);
      throw new ServiceUnavailableException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Semantic ontology generation is unavailable',
      );
    }
  }
}
