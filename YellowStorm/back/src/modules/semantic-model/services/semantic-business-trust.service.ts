import { Injectable } from '@nestjs/common';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import type { ListReviewItemsQueryDto, ResolveReviewItemDto } from '../dto';
import type { SourceAssetKind, SourceFieldMapping } from '../domain/semantic-source-mapping.types';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';

type MappingHealthState = 'healthy' | 'changed' | 'unavailable' | 'broken' | 'checking';

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

/** Restricts relation counts to links between data-bearing business concepts; system and classification-only ends need no matching rule. */
const DATA_RELATION_JOIN = `JOIN semantic_model.node_types source_node ON source_node.id=relation.source_node_type_id AND source_node.version_id=relation.version_id AND source_node.system_key IS NULL AND source_node.record_policy<>'none'
  JOIN semantic_model.node_types target_node ON target_node.id=relation.target_node_type_id AND target_node.version_id=relation.version_id AND target_node.system_key IS NULL AND target_node.record_policy<>'none'`;

@Injectable()
export class SemanticBusinessTrustService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
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
    const result = await this.database.query<MappingHealthItem & { totalCount: string }>(
      `SELECT m.id,m.concept_id AS "conceptId",COALESCE(n.label,m.concept_id::text) AS "conceptLabel",
              m.workspace_id AS "workspaceId",m.document_id AS "documentId",m.sheet_name AS "sheetName",
              m.asset_kind AS "assetKind",m.field_mappings AS "fieldMappings",m.status,
              m.created_by AS "createdBy",m.created_at AS "createdAt",m.updated_at AS "updatedAt",
              COALESCE(w.enabled,false) AS "sourceEnabled",m.validated_source_version AS "validatedSourceVersion",
              m.validated_at AS "validatedAt",COALESCE(p.profile->'metadata'->>'originalName',m.document_id) AS "documentName",
              COALESCE(h.state,'checking') AS state,h.source_fingerprint AS "currentSourceVersion",
              COALESCE(h.missing_fields,'[]'::jsonb) AS "missingFields",
              COALESCE(h.available_fields,'[]'::jsonb) AS "availableFields",
              CASE COALESCE(h.state,'checking')
                WHEN 'changed' THEN 'The source changed since this mapping was validated.'
                WHEN 'broken' THEN 'One or more mapped fields no longer exist.'
                WHEN 'unavailable' THEN 'The mapped source is unavailable.'
                WHEN 'checking' THEN 'Source analysis is pending.' ELSE NULL END AS message,
              count(*) OVER()::text AS "totalCount"
       FROM semantic_model.source_mappings m
       LEFT JOIN semantic_model.workspace_links w ON w.model_id=m.model_id AND w.workspace_id=m.workspace_id
       LEFT JOIN semantic_model.models sm ON sm.id=m.model_id
       LEFT JOIN semantic_model.node_types n ON n.version_id=sm.current_draft_version_id AND n.id=m.concept_id
       LEFT JOIN semantic_datasource.mapping_health h ON h.model_id=m.model_id AND h.mapping_id=m.id
       LEFT JOIN LATERAL (
         SELECT profile FROM semantic_datasource.discovery_profiles
         WHERE workspace_id=m.workspace_id AND asset_id=m.document_id
         ORDER BY completed_at DESC LIMIT 1
       ) p ON true
       WHERE m.model_id=$1 ORDER BY m.created_at LIMIT 50`,
      [model.id],
    );
    const items = result.rows.map(({ totalCount: _totalCount, ...item }) => item);
    return {
      items,
      truncated: Number(result.rows[0]?.totalCount ?? 0) > 50,
      summary: {
        healthy: items.filter((item) => item.state === 'healthy').length,
        changed: items.filter((item) => item.state === 'changed').length,
        unavailable: items.filter((item) => item.state === 'unavailable').length,
        broken: items.filter((item) => item.state === 'broken').length,
        checking: items.filter((item) => item.state === 'checking').length,
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
        (SELECT count(*) FROM semantic_model.relation_types relation ${DATA_RELATION_JOIN} WHERE relation.model_id=$1 AND relation.version_id=$2)::text AS "relationCount",
        (SELECT count(*) FROM semantic_model.relation_resolution_rules rule JOIN semantic_model.relation_types relation ON relation.id=rule.relation_id AND relation.version_id=$2 ${DATA_RELATION_JOIN} WHERE rule.model_id=$1)::text AS "ruleCount",
        (SELECT count(*) FROM semantic_model.source_mappings m JOIN semantic_model.node_types n ON n.id=m.concept_id AND n.version_id=$2 LEFT JOIN semantic_model.workspace_links w ON w.model_id=m.model_id AND w.workspace_id=m.workspace_id LEFT JOIN semantic_datasource.mapping_health h ON h.model_id=m.model_id AND h.mapping_id=m.id WHERE m.model_id=$1 AND (m.status<>'ready' OR NOT COALESCE(w.enabled,false) OR COALESCE(h.state,'checking')<>'healthy'))::text AS "unhealthyMappingCount",
        (SELECT count(*) FROM semantic_model.review_items review WHERE review.model_id=$1 AND review.status='open' AND (
          (review.kind='ambiguous_relation' AND EXISTS (SELECT 1 FROM semantic_model.relation_types relation WHERE relation.version_id=$2 AND relation.id::text=review.target_id)) OR
          (review.kind='source_conflict' AND EXISTS (SELECT 1 FROM semantic_model.node_types node WHERE node.version_id=$2 AND node.id::text=review.details->>'conceptId')) OR
          (review.kind='broken_mapping' AND EXISTS (SELECT 1 FROM semantic_model.source_mappings mapping JOIN semantic_model.node_types node ON node.id=mapping.concept_id AND node.version_id=$2 WHERE mapping.id::text=review.target_id))
        ))::text AS "openReviewCount"`,
      [model.id, model.currentDraftVersionId],
    );
    const counts = result.rows[0];
    const number = (value: string) => Number(value ?? 0);
    const configured = number(counts.dataConceptCount) > 0;
    const areas = [
      this.area('structure', configured, 'Add at least one business concept.'),
      this.area('sources', configured && number(counts.dataConceptCount) <= number(counts.sourcedConceptCount) && !number(counts.unhealthyMappingCount), 'Map every data-bearing concept to an available source.'),
      this.area('identity', configured && number(counts.dataConceptCount) <= number(counts.identityCount), 'Define an identity rule for every data-bearing concept.'),
      this.area('relationships', configured && number(counts.relationCount) <= number(counts.ruleCount), 'Configure matching for every relationship.'),
      // Source health already counts under `sources`; quality is only about decisions left open.
      this.area('quality', configured && !number(counts.openReviewCount), 'Resolve open reviews.'),
    ];
    const completeAreas = areas.filter((area) => area.complete).length;
    // The areas are steps: a later one only earns points once every earlier step is done, so an empty
    // relationship list or review queue cannot make a model with no data look most of the way there.
    const firstGap = areas.findIndex((area) => !area.complete);
    const progress = firstGap === -1 ? areas.length : firstGap;
    return { status: configured ? completeAreas === areas.length ? 'ready' : 'needs_review' : 'not_configured', score: progress * 20, completeAreas, totalAreas: areas.length, areas };
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

}
