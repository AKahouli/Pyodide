import { Injectable } from '@nestjs/common';
import { ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import type { LastDocumentMapping, MappingPreset } from '../domain/semantic-mapping-preset.types';
import type { AiExtractionSettings, SourceFieldMapping } from '../domain/semantic-source-mapping.types';
import type { SaveMappingPresetDto } from '../dto/semantic-model.dto';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { pickAiSettings } from './semantic-extraction-settings.service';
import { SemanticModelService } from './semantic-model.service';

// A concept rarely needs more; a cap keeps the picker short and the table bounded.
export const MAX_PRESETS_PER_CONCEPT = 50;

type PresetRow = Omit<MappingPreset, 'updatedAt'> & { updatedAt: Date | string };

const COLUMNS = `id::text AS id, concept_id::text AS "conceptId", name, description, field_mappings AS "fieldMappings",
                 ai_settings AS "aiSettings", identity_fields AS "identityFields", updated_at AS "updatedAt"`;

const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : String(value);
const asPreset = (row: PresetRow): MappingPreset => ({ ...row, updatedAt: iso(row.updatedAt) });

/** Only what decides how a field is read: no document, workspace or validation state. */
function presetFields(fields: SourceFieldMapping[]): SourceFieldMapping[] {
  return fields.map((field) => ({
    sourceField: field.sourceField ?? null,
    targetAttribute: field.targetAttribute,
    mode: field.mode,
    ...(field.extractionStrategy ? { extractionStrategy: field.extractionStrategy } : {}),
    ...(field.rules ? { rules: field.rules } : {}),
    ...(field.computed ? { computed: field.computed } : {}),
    ...(field.constantValue !== undefined ? { constantValue: field.constantValue } : {}),
  }));
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/**
 * Reusable settings for reading a concept from documents. Presets are model settings, not model
 * content: saving one does not change the model's revision or any run.
 */
@Injectable()
export class SemanticMappingPresetService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly documents: WorkspaceDocumentService,
  ) {}

  async list(userId: string, modelId: string, conceptId: string): Promise<MappingPreset[]> {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const result = await this.database.query<PresetRow>(
      `SELECT ${COLUMNS} FROM semantic_model.mapping_presets WHERE model_id=$1 AND concept_id=$2 ORDER BY lower(name), id`,
      [model.id, conceptId],
    );
    return result.rows.map(asPreset);
  }

  async save(userId: string, modelId: string, dto: SaveMappingPresetDto, presetId?: string): Promise<MappingPreset> {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const values = [
      dto.name.trim(), dto.description?.trim() || null, JSON.stringify(presetFields(dto.fieldMappings)),
      JSON.stringify(pickAiSettings(dto.aiSettings) ?? {}),
      JSON.stringify(dto.identityFields ?? []), userId,
    ];
    try {
      if (presetId) {
        const updated = await this.database.query<PresetRow>(
          `UPDATE semantic_model.mapping_presets
           SET name=$4, description=$5, field_mappings=$6::jsonb, ai_settings=$7::jsonb, identity_fields=$8::jsonb, updated_by=$9, updated_at=now()
           WHERE id=$1 AND model_id=$2 AND concept_id=$3
           RETURNING ${COLUMNS}`,
          [presetId, model.id, dto.conceptId, ...values],
        );
        if (!updated.rows[0]) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Preset not found');
        return asPreset(updated.rows[0]);
      }
      // The count and the insert are one statement, so two saves at once cannot pass the cap.
      const inserted = await this.database.query<PresetRow>(
        `INSERT INTO semantic_model.mapping_presets (model_id, concept_id, name, description, field_mappings, ai_settings, identity_fields, created_by, updated_by)
         SELECT $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $8
         WHERE (SELECT count(*) FROM semantic_model.mapping_presets WHERE model_id=$1 AND concept_id=$2) < $9
         RETURNING ${COLUMNS}`,
        [model.id, dto.conceptId, ...values, MAX_PRESETS_PER_CONCEPT],
      );
      if (!inserted.rows[0]) {
        throw new ConflictException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `A concept can have at most ${MAX_PRESETS_PER_CONCEPT} presets`);
      }
      return asPreset(inserted.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NAME_EXISTS, 'A preset with this name already exists');
      throw error;
    }
  }

  async delete(userId: string, modelId: string, presetId: string) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const result = await this.database.query('DELETE FROM semantic_model.mapping_presets WHERE id=$1 AND model_id=$2', [presetId, model.id]);
    if (!result.rowCount) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Preset not found');
    return { deleted: true };
  }

  /**
   * The document mapping of the concept saved most recently, also in a workspace unlinked since,
   * so a new mapping starts where the last one left off. The name of what it read is only given
   * while its workspace is still linked.
   */
  async lastDocumentMapping(userId: string, modelId: string, conceptId: string): Promise<LastDocumentMapping | null> {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const result = await this.database.query<{
      id: string; scope: 'document' | 'workspace' | null; documentId: string; sourceLabel: string | null; linked: boolean;
      fieldMappings: SourceFieldMapping[]; aiSettings: Partial<AiExtractionSettings> | null; identityFields: string[] | null; updatedAt: Date | string;
    }>(
      `SELECT m.id::text AS id, m.scope, m.document_id AS "documentId", m.source_label AS "sourceLabel", COALESCE(w.enabled, false) AS linked,
              m.field_mappings AS "fieldMappings", m.ai_settings AS "aiSettings", i.fields AS "identityFields", m.updated_at AS "updatedAt"
       FROM semantic_model.source_mappings m
       LEFT JOIN semantic_model.workspace_links w ON w.model_id=m.model_id AND w.workspace_id=m.workspace_id
       LEFT JOIN semantic_model.identity_rules i ON i.model_id=m.model_id AND i.concept_id=m.concept_id
       WHERE m.model_id=$1 AND m.concept_id=$2 AND m.asset_kind='document'
       ORDER BY m.updated_at DESC, m.id
       LIMIT 1`,
      [model.id, conceptId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const scope = row.scope === 'workspace' ? 'workspace' : 'document';
    let sourceName: string | null = null;
    if (row.linked) {
      sourceName = scope === 'workspace' ? row.sourceLabel
        : (await this.documents.findByIds([row.documentId]).catch(() => []))[0]?.originalName ?? null;
    }
    return {
      mappingId: row.id, scope, sourceName, workspaceLinked: row.linked,
      fieldMappings: presetFields(row.fieldMappings ?? []), aiSettings: row.aiSettings ?? {}, identityFields: row.identityFields ?? [],
      updatedAt: iso(row.updatedAt),
    };
  }
}
