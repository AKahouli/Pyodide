import { Injectable } from '@nestjs/common';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';

export interface SemanticModelOntologyArtifact {
  modelId: string;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class SemanticModelOntologyRepository {
  constructor(private readonly database: SemanticModelDatabaseService) {}

  async upsert(
    modelId: string,
    ontologyDefinition: Record<string, unknown>,
    ontologyTtl: string,
  ): Promise<SemanticModelOntologyArtifact> {
    const result = await this.database.query<SemanticModelOntologyArtifact>(
      `INSERT INTO semantic_model.ontology_artifacts
        (model_id, ontology_definition, ontology_ttl)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (model_id) DO UPDATE SET
         ontology_definition = EXCLUDED.ontology_definition,
         ontology_ttl = EXCLUDED.ontology_ttl,
         generated_at = now(),
         updated_at = now()
       RETURNING model_id AS "modelId", generated_at AS "generatedAt",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [modelId, JSON.stringify(ontologyDefinition), ontologyTtl],
    );
    return result.rows[0];
  }
}
