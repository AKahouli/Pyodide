import { Injectable } from '@nestjs/common';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import type { AttributeDefinition } from '../domain/semantic-model.types';
import { checkDerivedSource, type DerivedFieldMapping, type DerivedSource, type RuntimeDerivation } from '../domain/semantic-derived-source.types';
import type { SaveDerivedSourceDto } from '../dto/semantic-model.dto';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';

type DerivedSourceRow = Omit<DerivedSource, 'updatedAt'> & { updatedAt: Date | string };

const SELECT = `SELECT id::text AS id, concept_id::text AS "conceptId", source_concept_id::text AS "sourceConceptId",
                       field_mappings AS "fieldMappings", conflict_rule AS "conflictRule", order_by AS "orderBy",
                       updated_at AS "updatedAt"
                FROM semantic_model.derived_sources`;

const asSource = (row: DerivedSourceRow): DerivedSource => ({
  ...row,
  updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
});

/**
 * Concepts filled from another concept's records: the organizations named by the customer id and
 * name of every contract. One record per distinct key value; a conflict rule picks the value kept
 * when the records disagree. A derived concept is never the source of another one, so derivations
 * never chain.
 */
@Injectable()
export class SemanticDerivedSourceService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
  ) {}

  async list(userId: string, modelId: string): Promise<DerivedSource[]> {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    return this.forModel(model.id);
  }

  async forModel(modelId: string): Promise<DerivedSource[]> {
    const result = await this.database.query<DerivedSourceRow>(`${SELECT} WHERE model_id=$1 ORDER BY created_at, id`, [modelId]);
    return result.rows.map(asSource);
  }

  async save(userId: string, modelId: string, dto: SaveDerivedSourceDto, derivedSourceId?: string) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const existing = await this.forModel(model.id);
    if (derivedSourceId && !existing.some((source) => source.id === derivedSourceId)) {
      throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Derived source not found');
    }
    const orderBy = dto.conflictRule === 'latest' ? dto.orderBy ?? null : null;
    await this.assertValid(model.currentDraftVersionId, dto, orderBy, existing.filter((source) => source.id !== derivedSourceId));
    const fieldMappings: DerivedFieldMapping[] = dto.fieldMappings.map((field) => ({ sourceAttribute: field.sourceAttribute, targetAttribute: field.targetAttribute }));
    return this.database.transaction(async (client) => {
      const revision = await this.models.advanceRevision(client, modelId, dto.expectedRevision);
      const saved = derivedSourceId
        ? await client.query<DerivedSourceRow>(
          `UPDATE semantic_model.derived_sources
           SET concept_id=$3, source_concept_id=$4, field_mappings=$5::jsonb, conflict_rule=$6, order_by=$7, updated_at=now()
           WHERE id=$1 AND model_id=$2
           RETURNING id::text AS id, concept_id::text AS "conceptId", source_concept_id::text AS "sourceConceptId",
                     field_mappings AS "fieldMappings", conflict_rule AS "conflictRule", order_by AS "orderBy", updated_at AS "updatedAt"`,
          [derivedSourceId, model.id, dto.conceptId, dto.sourceConceptId, JSON.stringify(fieldMappings), dto.conflictRule, orderBy],
        )
        : await client.query<DerivedSourceRow>(
          `INSERT INTO semantic_model.derived_sources (model_id, concept_id, source_concept_id, field_mappings, conflict_rule, order_by, created_by)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
           RETURNING id::text AS id, concept_id::text AS "conceptId", source_concept_id::text AS "sourceConceptId",
                     field_mappings AS "fieldMappings", conflict_rule AS "conflictRule", order_by AS "orderBy", updated_at AS "updatedAt"`,
          [model.id, dto.conceptId, dto.sourceConceptId, JSON.stringify(fieldMappings), dto.conflictRule, orderBy, userId],
        );
      // The key fields are the derived concept's identity, shared with every other source it has.
      await client.query(
        `INSERT INTO semantic_model.identity_rules (model_id,concept_id,fields,updated_by)
         VALUES ($1,$2,$3::jsonb,$4)
         ON CONFLICT (model_id,concept_id)
         DO UPDATE SET fields=EXCLUDED.fields,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [model.id, dto.conceptId, JSON.stringify(dto.identityFields), userId],
      );
      const source = asSource(saved.rows[0]);
      await this.models.audit(client, model.id, model.currentDraftVersionId, userId, 'derived_source.saved', {
        derivedSourceId: source.id, conceptId: dto.conceptId, sourceConceptId: dto.sourceConceptId,
      });
      return { revision, derivedSource: source };
    });
  }

  async delete(userId: string, modelId: string, derivedSourceId: string, expectedRevision: number) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const revision = await this.database.transaction(async (client) => {
      const revision = await this.models.advanceRevision(client, modelId, expectedRevision);
      const result = await client.query('DELETE FROM semantic_model.derived_sources WHERE id=$1 AND model_id=$2', [derivedSourceId, model.id]);
      if (!result.rowCount) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Derived source not found');
      await this.models.audit(client, model.id, model.currentDraftVersionId, userId, 'derived_source.deleted', { derivedSourceId });
      return revision;
    });
    return { revision };
  }

  /**
   * What a run receives: only derivations whose concepts are both in the draft and whose source
   * concept has records in this run. Sorted and complete, so the run fingerprint is stable.
   */
  runtimeDerivations(sources: DerivedSource[], nodes: { id: string; attributes: AttributeDefinition[] }[],
    sourcedConcepts: Set<string>, identityRules: Map<string, string[]>): RuntimeDerivation[] {
    const fieldsOf = (conceptId: string) => new Set(nodes.find((node) => node.id === conceptId)?.attributes.map((attribute) => attribute.key));
    return sources
      .filter((source) => sourcedConcepts.has(source.sourceConceptId)
        && nodes.some((node) => node.id === source.conceptId) && nodes.some((node) => node.id === source.sourceConceptId))
      .flatMap((source) => {
        const identity = identityRules.get(source.conceptId) ?? [];
        // A field removed since the derived source was saved is not copied; without its key or its
        // date to order by, the concept is left out of the run and shown in To review instead.
        const checked = checkDerivedSource(source, fieldsOf(source.sourceConceptId), fieldsOf(source.conceptId), identity);
        if (checked.missing.length || !identity.length) return [];
        const labelField = checked.fieldMappings.find((field) => !identity.includes(field.targetAttribute))?.targetAttribute ?? null;
        return [{
          derivationId: source.id,
          conceptId: source.conceptId,
          sourceConceptId: source.sourceConceptId,
          fieldMappings: checked.fieldMappings.map((field) => ({ sourceAttribute: field.sourceAttribute, targetAttribute: field.targetAttribute })),
          conflictRule: source.conflictRule,
          orderBy: source.conflictRule === 'latest' ? source.orderBy : null,
          labelField,
          mappingVersion: source.updatedAt,
        }];
      })
      .sort((left, right) => left.derivationId < right.derivationId ? -1 : left.derivationId > right.derivationId ? 1 : 0);
  }

  private async assertValid(versionId: string, dto: SaveDerivedSourceDto, orderBy: string | null, others: DerivedSource[]) {
    const invalid = (message: string) => new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, message);
    if (dto.conceptId === dto.sourceConceptId) throw invalid('A concept cannot be made from its own records');
    const nodes = await this.database.query<{ id: string; label: string; attributes: AttributeDefinition[] }>(
      'SELECT id::text AS id, label, attributes FROM semantic_model.node_types WHERE version_id=$1 AND id = ANY($2::uuid[]) AND system_key IS NULL',
      [versionId, [dto.conceptId, dto.sourceConceptId]],
    ).then((result) => new Map(result.rows.map((row) => [row.id, row])));
    const target = nodes.get(dto.conceptId);
    const source = nodes.get(dto.sourceConceptId);
    if (!target || !source) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Concept not found in the current draft');
    const targetKeys = new Set((target.attributes ?? []).map((attribute) => attribute.key));
    const sourceKeys = new Set((source.attributes ?? []).map((attribute) => attribute.key));
    const unknownSource = dto.fieldMappings.find((field) => !sourceKeys.has(field.sourceAttribute));
    if (unknownSource) throw invalid(`${source.label} has no field ${unknownSource.sourceAttribute}`);
    const unknownTarget = dto.fieldMappings.find((field) => !targetKeys.has(field.targetAttribute));
    if (unknownTarget) throw invalid(`${target.label} has no field ${unknownTarget.targetAttribute}`);
    const targets = dto.fieldMappings.map((field) => field.targetAttribute);
    if (new Set(targets).size !== targets.length) throw invalid('Each field can only be filled once');
    const unmappedKey = dto.identityFields.find((field) => !targets.includes(field));
    if (unmappedKey) throw invalid(`The key field ${unmappedKey} must be filled from ${source.label}`);
    if (orderBy !== null && !sourceKeys.has(orderBy)) throw invalid(`${source.label} has no field ${orderBy}`);
    if (dto.conflictRule === 'latest' && orderBy === null) throw invalid('Choose the field that tells which record is the most recent');
    // Derivations never chain: a derived concept is never the source of another one.
    if (others.some((other) => other.conceptId === dto.sourceConceptId)) {
      throw invalid(`${source.label} is itself made from another concept, so it cannot fill ${target.label}`);
    }
    if (others.some((other) => other.sourceConceptId === dto.conceptId)) {
      throw invalid(`${target.label} already fills another concept, so it cannot be made from ${source.label}`);
    }
  }
}
