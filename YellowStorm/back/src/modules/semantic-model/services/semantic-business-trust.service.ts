import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import type { ListReviewItemsQueryDto, ResolveReviewItemDto } from '../dto';
import type { SourceAssetKind, SourceFieldMapping } from '../domain/semantic-source-mapping.types';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';
import { SpreadsheetConceptResolver } from './spreadsheet-concept.resolver';

type MappingHealthState = 'healthy' | 'changed' | 'unavailable' | 'broken';

export interface MappingHealthRow {
  id: string;
  conceptId: string;
  conceptLabel: string;
  workspaceId: string;
  documentId: string;
  sheetName: string;
  assetKind: SourceAssetKind;
  fieldMappings: SourceFieldMapping[];
  status: string;
  sourceEnabled: boolean;
  validatedSourceVersion: string | null;
  validatedAt: Date | null;
}

export interface MappingHealthItem extends MappingHealthRow {
  documentName: string;
  state: MappingHealthState;
  currentSourceVersion: string | null;
  missingFields: string[];
  availableFields: string[];
  message: string | null;
}

interface ReadinessCounts {
  nodeCount: string;
  dataConceptCount: string;
  sourcedConceptCount: string;
  identityCount: string;
  relationCount: string;
  ruleCount: string;
  unhealthyMappingCount: string;
  openReviewCount: string;
}

@Injectable()
export class SemanticBusinessTrustService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly documents: WorkspaceDocumentService,
    private readonly spreadsheets: SpreadsheetConceptResolver,
  ) {}

  async reviewItems(userId: string, modelId: string, query: ListReviewItemsQueryDto) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const result = await this.database.query(
      `SELECT id,kind,target_id AS "targetId",status,details,resolution,
              created_at AS "createdAt",updated_at AS "updatedAt",resolved_by AS "resolvedBy",resolved_at AS "resolvedAt"
       FROM semantic_model.review_items WHERE model_id=$1 AND status=$2
       ORDER BY updated_at DESC LIMIT 200`,
      [model.id, query.status],
    );
    return result.rows;
  }

  async resolveReviewItem(userId: string, modelId: string, reviewItemId: string, dto: ResolveReviewItemDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    return this.database.transaction(async (client) => {
      const item = await client.query<{ kind: string; targetId: string; status: string; details: Record<string, unknown> }>(
        'SELECT kind,target_id AS "targetId",status,details FROM semantic_model.review_items WHERE id=$1 AND model_id=$2 FOR UPDATE',
        [reviewItemId, model.id],
      );
      if (!item.rows[0]) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Review item not found');
      if (item.rows[0].status !== 'open') throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT, 'Review item is already resolved');
      this.validateResolution(item.rows[0], dto);
      const revision = await this.models.advanceRevision(client, model.id, dto.expectedRevision);
      const resolution = {
        decision: dto.decision,
        selectedTargetId: dto.selectedTargetId,
        selectedMappingId: dto.selectedMappingId,
        note: dto.note,
      };
      await client.query(
        `UPDATE semantic_model.review_items SET status='resolved',resolution=$3::jsonb,
           resolved_by=$4,resolved_at=now(),updated_at=now() WHERE id=$1 AND model_id=$2`,
        [reviewItemId, model.id, JSON.stringify(resolution), userId],
      );
      await this.models.audit(client, model.id, model.currentDraftVersionId, userId, 'review_item.resolved', {
        reviewItemId,
        kind: item.rows[0].kind,
        targetId: item.rows[0].targetId,
        decision: dto.decision,
      });
      return { revision };
    });
  }

  async mappingHealth(userId: string, modelId: string) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const rows = await this.mappingRows(model.id);
    const items: MappingHealthItem[] = [];
    for (const mapping of rows.slice(0, 50)) items.push(await this.inspectMapping(mapping));
    if (model.role !== 'viewer') await this.persistHealth(model.id, items);
    return {
      items,
      truncated: rows.length > 50,
      summary: {
        healthy: items.filter((item) => item.state === 'healthy').length,
        changed: items.filter((item) => item.state === 'changed').length,
        unavailable: items.filter((item) => item.state === 'unavailable').length,
        broken: items.filter((item) => item.state === 'broken').length,
      },
    };
  }

  async readiness(userId: string, modelId: string) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const result = await this.database.query<ReadinessCounts>(
      `SELECT
        (SELECT count(*) FROM semantic_model.node_types WHERE model_id=$1 AND version_id=$2)::text AS "nodeCount",
        (SELECT count(*) FROM semantic_model.node_types WHERE model_id=$1 AND version_id=$2 AND system_key IS NULL AND record_policy<>'none')::text AS "dataConceptCount",
        (SELECT count(DISTINCT m.concept_id) FROM semantic_model.source_mappings m JOIN semantic_model.workspace_links w ON w.model_id=m.model_id AND w.workspace_id=m.workspace_id AND w.enabled JOIN semantic_model.node_types n ON n.id=m.concept_id AND n.version_id=$2 WHERE m.model_id=$1 AND m.status='ready' AND n.system_key IS NULL AND n.record_policy<>'none')::text AS "sourcedConceptCount",
        (SELECT count(*) FROM semantic_model.identity_rules i JOIN semantic_model.node_types n ON n.id=i.concept_id AND n.version_id=$2 WHERE i.model_id=$1 AND n.system_key IS NULL AND n.record_policy<>'none')::text AS "identityCount",
        (SELECT count(*) FROM semantic_model.relation_types WHERE model_id=$1 AND version_id=$2)::text AS "relationCount",
        (SELECT count(*) FROM semantic_model.relation_resolution_rules rule JOIN semantic_model.relation_types relation ON relation.id=rule.relation_id AND relation.version_id=$2 WHERE rule.model_id=$1)::text AS "ruleCount",
        (SELECT count(*) FROM semantic_model.source_mappings m JOIN semantic_model.node_types n ON n.id=m.concept_id AND n.version_id=$2 LEFT JOIN semantic_model.workspace_links w ON w.model_id=m.model_id AND w.workspace_id=m.workspace_id WHERE m.model_id=$1 AND (m.status<>'ready' OR NOT COALESCE(w.enabled,false)))::text AS "unhealthyMappingCount",
        (SELECT count(*) FROM semantic_model.review_items review WHERE review.model_id=$1 AND review.status='open' AND (
          (review.kind='ambiguous_relation' AND EXISTS (SELECT 1 FROM semantic_model.relation_types relation WHERE relation.version_id=$2 AND relation.id::text=review.target_id)) OR
          (review.kind='source_conflict' AND EXISTS (SELECT 1 FROM semantic_model.node_types node WHERE node.version_id=$2 AND node.id::text=review.details->>'conceptId')) OR
          (review.kind='broken_mapping' AND EXISTS (SELECT 1 FROM semantic_model.source_mappings mapping JOIN semantic_model.node_types node ON node.id=mapping.concept_id AND node.version_id=$2 WHERE mapping.id::text=review.target_id))
        ))::text AS "openReviewCount"`,
      [model.id, model.currentDraftVersionId],
    );
    const counts = result.rows[0];
    const number = (value: string) => Number(value ?? 0);
    const areas = [
      this.area('structure', number(counts.nodeCount) > 0, 'Add at least one business concept.'),
      this.area('sources', number(counts.dataConceptCount) <= number(counts.sourcedConceptCount) && !number(counts.unhealthyMappingCount), 'Map every data-bearing concept to an available source.'),
      this.area('identity', number(counts.dataConceptCount) <= number(counts.identityCount), 'Define an identity rule for every data-bearing concept.'),
      this.area('relationships', number(counts.relationCount) <= number(counts.ruleCount), 'Configure matching for every relationship.'),
      this.area('quality', !number(counts.openReviewCount) && !number(counts.unhealthyMappingCount), 'Resolve open reviews and source issues.'),
    ];
    const completeAreas = areas.filter((area) => area.complete).length;
    return { score: completeAreas * 20, completeAreas, totalAreas: areas.length, areas };
  }

  private area(key: string, complete: boolean, message: string) {
    return { key, complete, issues: complete ? [] : [{ severity: key === 'quality' ? 'review' : 'blocking', message }] };
  }

  private validateResolution(item: { kind: string; details: Record<string, unknown> }, dto: ResolveReviewItemDto): void {
    if (dto.decision !== 'accepted') return;
    if (item.kind === 'ambiguous_relation') {
      const candidates = Array.isArray(item.details.targetEntityIds) ? item.details.targetEntityIds : [];
      if (!dto.selectedTargetId || !candidates.includes(dto.selectedTargetId)) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Select one of the candidate relationship targets');
      }
      return;
    }
    if (item.kind === 'source_conflict') {
      const candidates = [item.details.preferredMappingId, item.details.conflictingMappingId];
      if (!dto.selectedMappingId || !candidates.includes(dto.selectedMappingId)) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Select one of the conflicting sources');
      }
      return;
    }
    throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Repair the mapping before resolving this review');
  }

  private async mappingRows(modelId: string): Promise<MappingHealthRow[]> {
    const result = await this.database.query<MappingHealthRow>(
      `SELECT m.id,m.concept_id AS "conceptId",COALESCE(n.label,m.concept_id::text) AS "conceptLabel",
              m.workspace_id AS "workspaceId",m.document_id AS "documentId",m.sheet_name AS "sheetName",
              m.asset_kind AS "assetKind",m.field_mappings AS "fieldMappings",m.status,
              COALESCE(w.enabled,false) AS "sourceEnabled",m.validated_source_version AS "validatedSourceVersion",
              m.validated_at AS "validatedAt"
       FROM semantic_model.source_mappings m
       LEFT JOIN semantic_model.workspace_links w ON w.model_id=m.model_id AND w.workspace_id=m.workspace_id
       LEFT JOIN semantic_model.models model ON model.id=m.model_id
       LEFT JOIN semantic_model.node_types n ON n.version_id=model.current_draft_version_id AND n.id=m.concept_id
       WHERE m.model_id=$1 ORDER BY m.created_at`,
      [modelId],
    );
    return result.rows;
  }

  private async inspectMapping(mapping: MappingHealthRow): Promise<MappingHealthItem> {
    const base = { ...mapping, documentName: mapping.documentId, currentSourceVersion: null, missingFields: [], availableFields: [], message: null };
    if (!mapping.sourceEnabled) return { ...base, state: 'unavailable', message: 'The source workspace is disconnected.' };
    try {
      const document = await this.documents.findById(mapping.workspaceId, mapping.documentId);
      const currentSourceVersion = document.contentHash || `${document.updatedAt}:${document.size}`;
      if (currentSourceVersion === mapping.validatedSourceVersion) {
        return { ...base, documentName: document.originalName, currentSourceVersion, state: 'healthy' };
      }
      if (mapping.assetKind === 'document') {
        return { ...base, documentName: document.originalName, currentSourceVersion, state: 'changed', message: 'The source document changed since this mapping was validated.' };
      }
      const profile = await this.spreadsheets.profile(mapping.workspaceId, mapping.documentId, mapping.sheetName);
      const availableFields = 'fields' in profile ? (profile.fields ?? []).map((field) => field.name) : [];
      const available = new Set(availableFields);
      const missingFields = mapping.fieldMappings
        .filter((field) => field.mode === 'direct' && field.sourceField && !available.has(field.sourceField))
        .map((field) => field.sourceField!);
      return {
        ...base,
        documentName: document.originalName,
        currentSourceVersion,
        availableFields,
        missingFields,
        state: missingFields.length ? 'broken' : 'changed',
        message: missingFields.length ? 'One or more mapped fields no longer exist.' : 'The source changed since this mapping was validated.',
      };
    } catch {
      return { ...base, state: 'unavailable', message: 'The mapped source could not be accessed.' };
    }
  }

  private async persistHealth(modelId: string, items: MappingHealthItem[]): Promise<void> {
    for (const item of items) {
      const status = item.state === 'healthy' ? 'ready' : item.state === 'changed' ? 'needs_review' : item.state;
      await this.database.query('UPDATE semantic_model.source_mappings SET status=$3,updated_at=now() WHERE id=$1 AND model_id=$2 AND status IS DISTINCT FROM $3', [item.id, modelId, status]);
      if (item.state !== 'broken') continue;
      const details = { mappingId: item.id, conceptId: item.conceptId, conceptLabel: item.conceptLabel, documentName: item.documentName, missingFields: item.missingFields, availableFields: item.availableFields };
      const fingerprint = createHash('sha256').update(`broken_mapping:${item.id}:${item.missingFields.join(',')}`).digest('hex');
      await this.database.query(
        `INSERT INTO semantic_model.review_items (model_id,kind,target_id,fingerprint,details)
         VALUES ($1,'broken_mapping',$2,$3,$4::jsonb)
         ON CONFLICT (model_id,fingerprint) DO UPDATE SET details=EXCLUDED.details,updated_at=now()`,
        [modelId, item.id, fingerprint, JSON.stringify(details)],
      );
    }
  }
}
