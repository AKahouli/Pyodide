import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConflictException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { buildModelHealth, emptyModelHealth, type HealthModelConcept } from '../domain/semantic-model-health';
import type { ModelHealth } from '../domain/semantic-model-health.types';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticGraphSearchService } from './semantic-graph-search.service';
import { SemanticModelService } from './semantic-model.service';
import { SemanticReviewQueueService } from './semantic-review-queue.service';
import { SemanticRuntimeClientService } from './semantic-runtime-client.service';

/**
 * The model health screen: what the last run did to each concept's rows and what to change, read from
 * the run's own account (row counts, the key's real spread, examples with their file, sheet and row)
 * and the model's design. Also carries what blocks the next run, from the review queue.
 */
@Injectable()
export class SemanticModelHealthService {
  private readonly logger = new Logger(SemanticModelHealthService.name);

  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly runtime: SemanticRuntimeClientService,
    private readonly reviewQueue: SemanticReviewQueueService,
    @Optional() private readonly graphSearch?: SemanticGraphSearchService,
  ) {}

  async health(userId: string, modelId: string): Promise<ModelHealth> {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const versionId = model.currentDraftVersionId;
    const setup = (await this.reviewQueue.reviewQueue(userId, model.id, { dataGaps: false })).items;
    // No source-authorization wiring, no data read: the figures would be someone else's.
    if (!this.graphSearch) return emptyModelHealth(setup);
    let records;
    try {
      records = await this.runtime.getBoundRecords(model.id, userId, 1, await this.graphSearch.allowedWorkspaceIds(userId, model.id));
    } catch (error) {
      this.logger.debug(`No prepared data to explain for ${model.id}: ${(error as Error).message}`);
      return emptyModelHealth(setup);
    }
    const [concepts, relations, derived, mappings] = await Promise.all([
      this.database.query<HealthModelConcept>(
        `SELECT id::text AS id, label, attributes FROM semantic_model.node_types
         WHERE model_id=$1 AND version_id=$2 AND system_key IS NULL`,
        [model.id, versionId],
      ).then((result) => result.rows),
      this.database.query<{ id: string; sourceConceptId: string }>(
        `SELECT id::text AS id, source_node_type_id::text AS "sourceConceptId" FROM semantic_model.relation_types
         WHERE model_id=$1 AND version_id=$2`,
        [model.id, versionId],
      ).then((result) => result.rows),
      this.database.query<{ conceptId: string; sourceConceptId: string }>(
        `SELECT concept_id::text AS "conceptId", source_concept_id::text AS "sourceConceptId"
         FROM semantic_model.derived_sources WHERE model_id=$1`,
        [model.id],
      ).then((result) => result.rows),
      this.database.query<{ conceptId: string; name: string }>(
        `SELECT sm.concept_id::text AS "conceptId",
                COALESCE(sm.source_label, p.profile->'metadata'->>'originalName', '') AS name
         FROM semantic_model.source_mappings sm
         LEFT JOIN LATERAL (SELECT profile FROM semantic_datasource.discovery_profiles
           WHERE workspace_id=sm.workspace_id AND asset_id=sm.document_id ORDER BY completed_at DESC LIMIT 1) p ON true
         WHERE sm.model_id=$1 ORDER BY sm.created_at`,
        [model.id],
      ).then((result) => result.rows).catch(() => []),
    ]);
    const sources = new Map<string, { names: string[]; kind: 'document' | 'manual' }>();
    for (const concept of concepts) sources.set(concept.id, { names: [], kind: 'manual' });
    for (const mapping of mappings) {
      const entry = sources.get(mapping.conceptId);
      if (entry) sources.set(mapping.conceptId, { kind: 'document', names: [...entry.names, ...(mapping.name ? [mapping.name] : [])] });
    }
    return buildModelHealth({ records, concepts, relations, derived, sources, setup });
  }
}
