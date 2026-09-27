import { Injectable, Logger } from '@nestjs/common';
import { ConflictException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticBusinessTrustService } from './semantic-business-trust.service';
import { SemanticModelService } from './semantic-model.service';
import { SemanticRuntimeClientService } from './semantic-runtime-client.service';

/** What a person does to clear an item; each item carries exactly one. */
export type ReviewQueueAction =
  | { kind: 'choose_match'; reviewItemId: string; options: Array<{ value: string; label: string }>; select: 'target' | 'source' }
  | { kind: 'repair_mapping'; mappingId: string }
  | { kind: 'choose_unique_field'; conceptId: string }
  | { kind: 'set_up_link'; relationId: string }
  | { kind: 'fix_values'; conceptId: string };

export type ReviewQueueGroup = 'decisions' | 'sources' | 'identity' | 'links' | 'data';

export interface ReviewQueueItem {
  /** Stable key for lists; never shown. */
  key: string;
  group: ReviewQueueGroup;
  /** 1 blocks chat from answering correctly, 2 needs a decision, 3 improves completeness. */
  priority: 1 | 2 | 3;
  kind: string;
  /** Business words to fill the explanation (labels, names, counts), never ids. */
  params: Record<string, string | number>;
  action: ReviewQueueAction;
}

const GROUP_ORDER: ReviewQueueGroup[] = ['sources', 'identity', 'decisions', 'links', 'data'];

/**
 * One list of everything that needs a person: ambiguous links and source conflicts, sources that
 * changed or broke, concepts without a unique field, relationships with no way to link records, and
 * values missing from the prepared data. Grouped and ordered by how much each item matters.
 */
@Injectable()
export class SemanticReviewQueueService {
  private readonly logger = new Logger(SemanticReviewQueueService.name);

  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly trust: SemanticBusinessTrustService,
    private readonly runtime: SemanticRuntimeClientService,
  ) {}

  async reviewQueue(userId: string, modelId: string) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const versionId = model.currentDraftVersionId;
    const [reviews, health, identity, links, gaps] = await Promise.all([
      this.openReviews(model.id, versionId),
      this.trust.mappingHealth(userId, model.id).catch(() => null),
      this.database.query<{ id: string; label: string }>(
        `SELECT n.id::text AS id, n.label FROM semantic_model.node_types n
         WHERE n.model_id=$1 AND n.version_id=$2 AND n.system_key IS NULL AND n.record_policy<>'none'
           AND NOT EXISTS (SELECT 1 FROM semantic_model.identity_rules i WHERE i.model_id=$1 AND i.concept_id=n.id)
         ORDER BY n.created_at`,
        [model.id, versionId],
      ).then((result) => result.rows),
      this.database.query<{ id: string; label: string; source: string; target: string }>(
        `SELECT relation.id::text AS id, relation.label, source_node.label AS source, target_node.label AS target
         FROM semantic_model.relation_types relation
         JOIN semantic_model.node_types source_node ON source_node.id=relation.source_node_type_id AND source_node.version_id=relation.version_id AND source_node.system_key IS NULL AND source_node.record_policy<>'none'
         JOIN semantic_model.node_types target_node ON target_node.id=relation.target_node_type_id AND target_node.version_id=relation.version_id AND target_node.system_key IS NULL AND target_node.record_policy<>'none'
         WHERE relation.model_id=$1 AND relation.version_id=$2
           AND NOT EXISTS (SELECT 1 FROM semantic_model.relation_resolution_rules rule WHERE rule.model_id=$1 AND rule.relation_id=relation.id)
         ORDER BY relation.created_at`,
        [model.id, versionId],
      ).then((result) => result.rows),
      this.missingValues(userId, model.id),
    ]);
    const items: ReviewQueueItem[] = [...reviews];
    for (const mapping of health?.items ?? []) {
      if (!['changed', 'broken', 'unavailable'].includes(mapping.state)) continue;
      items.push({
        key: `mapping:${mapping.id}`,
        group: 'sources',
        priority: mapping.state === 'changed' ? 2 : 1,
        kind: `source_${mapping.state}`,
        params: { document: mapping.documentName, concept: mapping.conceptLabel, fields: mapping.missingFields.join(', ') },
        action: { kind: 'repair_mapping', mappingId: mapping.id },
      });
    }
    for (const concept of identity) {
      items.push({ key: `identity:${concept.id}`, group: 'identity', priority: 1, kind: 'missing_unique_field',
        params: { concept: concept.label }, action: { kind: 'choose_unique_field', conceptId: concept.id } });
    }
    for (const relation of links) {
      items.push({ key: `link:${relation.id}`, group: 'links', priority: 2, kind: 'relationship_not_linked',
        params: { relationship: relation.label, source: relation.source, target: relation.target },
        action: { kind: 'set_up_link', relationId: relation.id } });
    }
    items.push(...gaps);
    items.sort((left, right) => left.priority - right.priority
      || GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group));
    return { count: items.length, items };
  }

  /** Decisions left open on the current draft; items about removed concepts or mappings are stale. */
  private async openReviews(modelId: string, versionId: string): Promise<ReviewQueueItem[]> {
    const result = await this.database.query<{ id: string; kind: string; targetId: string; details: Record<string, unknown>; label: string | null }>(
      `SELECT review.id::text AS id, review.kind, review.target_id AS "targetId", review.details,
              COALESCE(relation.label, node.label) AS label
       FROM semantic_model.review_items review
       LEFT JOIN semantic_model.relation_types relation ON review.kind='ambiguous_relation' AND relation.version_id=$2 AND relation.id::text=review.target_id
       LEFT JOIN semantic_model.node_types node ON review.kind='source_conflict' AND node.version_id=$2 AND node.id::text=review.details->>'conceptId'
       WHERE review.model_id=$1 AND review.status='open' AND review.kind IN ('ambiguous_relation','source_conflict')
         AND (relation.id IS NOT NULL OR node.id IS NOT NULL)
       ORDER BY review.updated_at DESC LIMIT 200`,
      [modelId, versionId],
    );
    const names = await this.mappingNames(modelId, result.rows
      .filter((row) => row.kind === 'source_conflict')
      .flatMap((row) => [row.details.preferredMappingId, row.details.conflictingMappingId])
      .filter((id): id is string => typeof id === 'string'));
    return result.rows.map((row): ReviewQueueItem => {
      const details = row.details ?? {};
      const record = String(details.entityLabel ?? details.sourceLabel ?? '');
      if (row.kind === 'ambiguous_relation') {
        const ids = Array.isArray(details.targetEntityIds) ? details.targetEntityIds.map(String) : [];
        const labels = Array.isArray(details.targetLabels) ? details.targetLabels.map(String) : [];
        return {
          key: `review:${row.id}`, group: 'decisions', priority: 2, kind: 'ambiguous_link',
          params: { record, relationship: row.label ?? '', count: ids.length },
          action: { kind: 'choose_match', reviewItemId: row.id, select: 'target',
            options: ids.map((value, index) => ({ value, label: labels[index] || record })) },
        };
      }
      const options = [details.preferredMappingId, details.conflictingMappingId]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => ({ value, label: names.get(value) ?? '' }));
      return {
        key: `review:${row.id}`, group: 'decisions', priority: 2, kind: 'source_conflict',
        params: { record, concept: row.label ?? '', field: String(details.attributeLabel ?? details.attribute ?? '') },
        action: { kind: 'choose_match', reviewItemId: row.id, select: 'source', options },
      };
    });
  }

  /** The file name behind each mapping, so a conflict reads "customers.xlsx or crm.csv". */
  private async mappingNames(modelId: string, mappingIds: string[]) {
    const names = new Map<string, string>();
    if (!mappingIds.length) return names;
    const result = await this.database.query<{ id: string; name: string }>(
      `SELECT m.id::text AS id, COALESCE(p.profile->'metadata'->>'originalName', '') AS name
       FROM semantic_model.source_mappings m
       LEFT JOIN LATERAL (SELECT profile FROM semantic_datasource.discovery_profiles
         WHERE workspace_id=m.workspace_id AND asset_id=m.document_id ORDER BY completed_at DESC LIMIT 1) p ON true
       WHERE m.model_id=$1 AND m.id::text = ANY($2::text[])`,
      [modelId, [...new Set(mappingIds)]],
    ).catch(() => ({ rows: [] as Array<{ id: string; name: string }> }));
    for (const row of result.rows) names.set(row.id, row.name);
    return names;
  }

  /** Values missing from the prepared draft data; absent when nothing has been prepared yet. */
  private async missingValues(userId: string, modelId: string): Promise<ReviewQueueItem[]> {
    try {
      const records = await this.runtime.getBoundRecords(modelId, userId, 1);
      const concepts = new Map(records.specification.concepts.map((concept) => [concept.conceptId, concept.label]));
      const nodes = await this.database.query<{ id: string; attributes: Array<{ key: string; label: string }> }>(
        'SELECT n.id::text AS id, n.attributes FROM semantic_model.node_types n JOIN semantic_model.models m ON m.current_draft_version_id=n.version_id WHERE m.id=$1',
        [modelId],
      ).then((result) => result.rows);
      const fieldLabel = (conceptId: string, attribute: string) => nodes.find((node) => node.id === conceptId)
        ?.attributes?.find((field) => field.key === attribute)?.label || attribute;
      return (records.gaps?.missingValues ?? []).map((gap): ReviewQueueItem => ({
        key: `gap:${gap.conceptId}:${gap.attribute}`,
        group: 'data',
        priority: 3,
        kind: 'missing_values',
        params: { concept: concepts.get(gap.conceptId) ?? '', field: fieldLabel(gap.conceptId, gap.attribute), missing: gap.missing, total: gap.total },
        action: { kind: 'fix_values', conceptId: gap.conceptId },
      }));
    } catch (error) {
      this.logger.debug(`No prepared data to review for ${modelId}: ${(error as Error).message}`);
      return [];
    }
  }
}
