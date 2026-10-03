import { Injectable, Optional } from '@nestjs/common';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import type { AttributeDefinition } from '../domain/semantic-model.types';
import {
  asSheetFieldMappings, checkDerivedSource, derivedFieldInputs, derivedFieldMode, derivedFieldUsesAi, runtimeDerivedField, storedDerivedField,
  type DerivedFieldMapping, type DerivedSource, type RuntimeDerivation,
} from '../domain/semantic-derived-source.types';
import { AI_EXTRACTION_CONTRACT_VERSION, type AiExtractionSettings } from '../domain/semantic-source-mapping.types';
import type { DerivedFieldPreviewDto, SaveDerivedSourceDto } from '../dto/semantic-model.dto';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticAttributeExtractionService } from './semantic-attribute-extraction.service';
import { effectiveAiSettings, SemanticExtractionSettingsService } from './semantic-extraction-settings.service';
import { SemanticModelService } from './semantic-model.service';
import { SemanticRuntimeClientService } from './semantic-runtime-client.service';
import { SemanticSourceMappingService } from './semantic-source-mapping.service';

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
    @Optional() private readonly runtime?: SemanticRuntimeClientService,
    @Optional() private readonly aiExtractionAgent?: SemanticAttributeExtractionService,
    @Optional() private readonly extractionSettings?: SemanticExtractionSettingsService,
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
    // A copied field is stored exactly as before the field modes, so earlier derived sources keep their fingerprint.
    const fieldMappings: DerivedFieldMapping[] = dto.fieldMappings.map((field) => storedDerivedField(field as DerivedFieldMapping));
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
   * Read a derived source's fields on a few sample records of the source concept, as a run would: each
   * field copied, read out of a source field's text with the rules and/or AI (with where it was found),
   * taken by its recipe, or fixed. The same readers as a sheet's rows; AI is only asked for these records.
   */
  async previewFields(userId: string, modelId: string, dto: DerivedFieldPreviewDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    if (!this.runtime) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'The semantic runtime is not available');
    const fields = dto.fieldMappings.map((field) => storedDerivedField(field as DerivedFieldMapping));
    const { target, source } = await this.assertFields(model.currentDraftVersionId, dto.conceptId, dto.sourceConceptId, fields);
    const attributes = new Map((target.attributes ?? []).map((attribute) => [attribute.key, attribute]));
    // Read as a sheet's fields are: a source field is the "column" a field reads.
    const fieldMappings = fields.map((field) => {
      const { sourceAttribute, ...rest } = runtimeDerivedField(field, attributes.get(field.targetAttribute)) as Record<string, unknown>;
      return { ...rest, sourceField: (sourceAttribute as string | undefined) ?? null, mode: derivedFieldMode(field) };
    });
    const usesAi = fields.some(derivedFieldUsesAi);
    const agent = usesAi && this.aiExtractionAgent ? await this.aiExtractionAgent.resolveAgent() : null;
    const result = await this.runtime.previewSheetFields({
      modelId: model.id,
      entry: {
        conceptId: target.id,
        conceptLabel: target.label,
        source: { assetId: `derived:${source.id}`, originalName: source.label },
        unit: 'record',
        fieldMappings,
        ...(usesAi ? { options: { aiSettings: await this.aiSettings() } } : {}),
      },
      rows: dto.records.map((record, index) => ({ rowNumber: index + 1, values: record.values })),
      aiExtraction: agent ? { agentSlug: agent.slug, model: agent.llmModel ?? null, contractVersion: AI_EXTRACTION_CONTRACT_VERSION } : null,
    });
    // Each reading names the source record it was read on rather than a row number.
    return {
      records: result.rows.map((row) => ({ entityId: dto.records[row.rowNumber - 1]?.entityId ?? String(row.rowNumber), fields: row.fields })),
      ai: result.ai,
    };
  }

  /** The admin's AI reading limits, as a run applies them to a derived source's AI fields. */
  async aiSettings(): Promise<AiExtractionSettings> {
    const configured = this.extractionSettings
      ? await this.extractionSettings.getDefaults().then((defaults) => defaults.configured).catch(() => ({}))
      : {};
    return effectiveAiSettings(configured);
  }

  /**
   * What a run receives: only derivations whose concepts are both in the draft and whose source
   * concept has records in this run. Sorted and complete, so the run fingerprint is stable. `aiSettings`
   * travel only with a derivation that reads a field with AI, so other derivations keep their fingerprint.
   */
  runtimeDerivations(sources: DerivedSource[], nodes: Array<{ id: string; attributes: AttributeDefinition[] }>,
    sourcedConcepts: Set<string>, identityRules: Map<string, string[]>, aiSettings?: AiExtractionSettings): RuntimeDerivation[] {
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
        const attributes = new Map((nodes.find((node) => node.id === source.conceptId)?.attributes ?? []).map((attribute) => [attribute.key, attribute]));
        const usesAi = checked.fieldMappings.some(derivedFieldUsesAi);
        return [{
          derivationId: source.id,
          conceptId: source.conceptId,
          sourceConceptId: source.sourceConceptId,
          fieldMappings: checked.fieldMappings.map((field) => runtimeDerivedField(field, attributes.get(field.targetAttribute))),
          conflictRule: source.conflictRule,
          orderBy: source.conflictRule === 'latest' ? source.orderBy : null,
          labelField,
          mappingVersion: source.updatedAt,
          ...(usesAi && aiSettings ? { aiSettings: { ...aiSettings } } : {}),
        }];
      })
      .sort((left, right) => left.derivationId < right.derivationId ? -1 : left.derivationId > right.derivationId ? 1 : 0);
  }

  /**
   * The two concepts, once the fields are checked against them: every source field a field reads and every
   * field it fills exist, each field is filled once, and its mode, rules and recipe are ones a sheet field
   * could use (a source field is read like a cell, and a recipe's column is a source field).
   */
  private async assertFields(versionId: string, conceptId: string, sourceConceptId: string, fields: DerivedFieldMapping[]) {
    const invalid = (message: string) => new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, message);
    if (conceptId === sourceConceptId) throw invalid('A concept cannot be made from its own records');
    const nodes = await this.database.query<{ id: string; label: string; attributes: AttributeDefinition[] }>(
      'SELECT id::text AS id, label, attributes FROM semantic_model.node_types WHERE version_id=$1 AND id = ANY($2::uuid[]) AND system_key IS NULL',
      [versionId, [conceptId, sourceConceptId]],
    ).then((result) => new Map(result.rows.map((row) => [row.id, row])));
    const target = nodes.get(conceptId);
    const source = nodes.get(sourceConceptId);
    if (!target || !source) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Concept not found in the current draft');
    const targetKeys = new Set((target.attributes ?? []).map((attribute) => attribute.key));
    const sourceKeys = new Set((source.attributes ?? []).map((attribute) => attribute.key));
    const noSource = fields.find((field) => (derivedFieldMode(field) === 'direct' || field.mode === 'extract') && !field.sourceAttribute);
    if (noSource) throw invalid(`${noSource.targetAttribute}: choose the ${source.label} field it is read from`);
    const unknownSource = fields.flatMap((field) => [...(field.sourceAttribute ? [field.sourceAttribute] : []), ...derivedFieldInputs(field, fields)])
      .find((attribute) => !sourceKeys.has(attribute));
    if (unknownSource) throw invalid(`${source.label} has no field ${unknownSource}`);
    const unknownTarget = fields.find((field) => !targetKeys.has(field.targetAttribute));
    if (unknownTarget) throw invalid(`${target.label} has no field ${unknownTarget.targetAttribute}`);
    const targets = fields.map((field) => field.targetAttribute);
    if (new Set(targets).size !== targets.length) throw invalid('Each field can only be filled once');
    const badConstant = fields.find((field) => field.mode === 'constant' && !['string', 'number', 'boolean'].includes(typeof field.constantValue));
    if (badConstant) throw invalid(`${badConstant.targetAttribute}: a fixed value needs a value`);
    // The same checks as a sheet's fields: the modes, rules a text without pages can use, recipes and their inputs.
    SemanticSourceMappingService.assertMappingModes('excel_sheet', asSheetFieldMappings(fields));
    return { target, source };
  }

  private async assertValid(versionId: string, dto: SaveDerivedSourceDto, orderBy: string | null, others: DerivedSource[]) {
    const invalid = (message: string) => new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, message);
    const { target, source } = await this.assertFields(versionId, dto.conceptId, dto.sourceConceptId,
      dto.fieldMappings.map((field) => storedDerivedField(field as DerivedFieldMapping)));
    const sourceKeys = new Set((source.attributes ?? []).map((attribute) => attribute.key));
    const targets = dto.fieldMappings.map((field) => field.targetAttribute);
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
