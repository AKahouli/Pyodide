import { Injectable, Logger } from '@nestjs/common';
import { ConflictException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { checkDerivedSource, type DerivedSource } from '../domain/semantic-derived-source.types';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticBusinessTrustService } from './semantic-business-trust.service';
import { SemanticModelService } from './semantic-model.service';
import { SemanticRuntimeClientService } from './semantic-runtime-client.service';

/** What a person does to clear an item; each item carries exactly one. */
export type ReviewQueueAction =
  | { kind: 'choose_match'; reviewItemId: string; options: Array<{ value: string; label: string }>; select: 'target' | 'source' }
  | { kind: 'repair_mapping'; mappingId: string; bulkEdit?: boolean }
  | { kind: 'repair_derived'; derivedSourceId: string; conceptId: string }
  | { kind: 'choose_unique_field'; conceptId: string }
  | { kind: 'set_up_link'; relationId: string }
  | { kind: 'fix_values'; conceptId: string; attribute: string }
  | { kind: 'add_source'; conceptId: string }
  | { kind: 'check_links'; relationId: string }
  | { kind: 'open_sources'; conceptId: string }
  | { kind: 'review_rows'; conceptId: string }
  | { kind: 'view_data' };

export type ReviewQueueGroup = 'decisions' | 'sources' | 'identity' | 'links' | 'data';

export interface ReviewQueueItem {
  /** Stable key for lists; never shown. */
  key: string;
  group: ReviewQueueGroup;
  /** 1 blocks chat from answering correctly, 2 needs a decision, 3 improves completeness (an optional field left empty). */
  priority: 1 | 2 | 3;
  kind: string;
  /** Business words to fill the explanation (labels, names, counts), never ids. */
  params: Record<string, string | number>;
  action: ReviewQueueAction;
}

const GROUP_ORDER: ReviewQueueGroup[] = ['sources', 'identity', 'decisions', 'links', 'data'];

/** A field the reader could not find in a document: the same fact as the empty value it leaves. */
const FIELD_NOT_FOUND = new Set(['unresolved_document_field', 'ai_extraction_unresolved']);
/** Whole documents that could not be read. */
const DOCUMENT_NOT_READ = new Set(['source_unavailable', 'index_unavailable', 'index_ambiguous', 'index_not_found', 'unresolved_identity']);
/** A reading limit stopped the build before every row or document was read. */
const READING_LIMIT = new Set(['materialization_cap', 'assertion_cap', 'relationship_cap', 'enumeration_capped', 'budget_exhausted']);

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
    const [reviews, health, identity, links, gaps, unsourced, unusable, unread, underived] = await Promise.all([
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
      this.dataGaps(userId, model.id),
      // Concepts that hold data but read it from nowhere: no ready source in a connected workspace.
      this.database.query<{ id: string; label: string }>(
        `SELECT n.id::text AS id, n.label FROM semantic_model.node_types n
         WHERE n.model_id=$1 AND n.version_id=$2 AND n.system_key IS NULL AND n.record_policy<>'none'
           AND NOT EXISTS (SELECT 1 FROM semantic_model.source_mappings sm
             JOIN semantic_model.workspace_links w ON w.model_id=sm.model_id AND w.workspace_id=sm.workspace_id AND w.enabled
             WHERE sm.model_id=$1 AND sm.concept_id=n.id AND sm.status='ready')
           AND NOT EXISTS (SELECT 1 FROM semantic_model.derived_sources d WHERE d.model_id=$1 AND d.concept_id=n.id)
         ORDER BY n.created_at`,
        [model.id, versionId],
      ).then((result) => result.rows),
      // Sources that cannot be read: not finished, or their workspace is no longer connected.
      this.database.query<{ id: string; concept: string; document: string; ready: boolean }>(
        `SELECT sm.id::text AS id, n.label AS concept, COALESCE(sm.source_label, p.profile->'metadata'->>'originalName', '') AS document,
                sm.status='ready' AS ready
         FROM semantic_model.source_mappings sm
         JOIN semantic_model.node_types n ON n.id=sm.concept_id AND n.version_id=$2
         LEFT JOIN semantic_model.workspace_links w ON w.model_id=sm.model_id AND w.workspace_id=sm.workspace_id
         LEFT JOIN LATERAL (SELECT profile FROM semantic_datasource.discovery_profiles
           WHERE workspace_id=sm.workspace_id AND asset_id=sm.document_id ORDER BY completed_at DESC LIMIT 1) p ON true
         WHERE sm.model_id=$1 AND (sm.status<>'ready' OR NOT COALESCE(w.enabled,false))
         ORDER BY sm.created_at`,
        [model.id, versionId],
      ).then((result) => result.rows).catch(() => []),
      this.fieldsNotRead(model.id, versionId),
      this.derivedNotMade(model.id, versionId),
    ]);
    const items: ReviewQueueItem[] = [...reviews, ...unread, ...underived];
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
    const reported = new Set(items.map((item) => item.key));
    for (const mapping of unusable) {
      if (reported.has(`mapping:${mapping.id}`)) continue;
      items.push({ key: `mapping:${mapping.id}`, group: 'sources', priority: 1, kind: mapping.ready ? 'source_workspace_off' : 'source_not_ready',
        params: { document: mapping.document, concept: mapping.concept }, action: { kind: 'repair_mapping', mappingId: mapping.id } });
    }
    for (const concept of unsourced) {
      items.push({ key: `unsourced:${concept.id}`, group: 'sources', priority: 1, kind: 'concept_without_source',
        params: { concept: concept.label }, action: { kind: 'add_source', conceptId: concept.id } });
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

  /**
   * Concept fields a document source has no row for: added to the concept after the source was set
   * up, so every run leaves them empty until the mapping is saved again. One item per concept and
   * set of fields; several documents mapped one by one are updated together.
   */
  private async fieldsNotRead(modelId: string, versionId: string): Promise<ReviewQueueItem[]> {
    const rows = await this.database.query<{ mappingId: string; conceptId: string; concept: string; scope: string; fields: string[]; keys: string[] }>(
      `SELECT sm.id::text AS "mappingId", n.id::text AS "conceptId", n.label AS concept, sm.scope,
              array_agg(COALESCE(NULLIF(a.attr->>'label',''), a.attr->>'key') ORDER BY a.position) AS fields,
              array_agg(a.attr->>'key' ORDER BY a.position) AS keys
       FROM semantic_model.source_mappings sm
       JOIN semantic_model.node_types n ON n.id=sm.concept_id AND n.version_id=$2 AND n.system_key IS NULL
       CROSS JOIN LATERAL jsonb_array_elements(n.attributes) WITH ORDINALITY AS a(attr, position)
       WHERE sm.model_id=$1 AND sm.asset_kind='document' AND sm.status='ready'
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(sm.field_mappings) f WHERE f->>'targetAttribute' = a.attr->>'key')
       GROUP BY sm.id, n.id, n.label, sm.scope, sm.created_at
       ORDER BY sm.created_at`,
      [modelId, versionId],
    ).then((result) => result.rows).catch(() => []);
    const groups = new Map<string, { first: (typeof rows)[number]; count: number; oneByOne: number }>();
    for (const row of rows) {
      const key = `${row.conceptId}:${row.keys.join('|')}`;
      const group = groups.get(key) ?? { first: row, count: 0, oneByOne: 0 };
      group.count += 1;
      if (row.scope !== 'workspace') group.oneByOne += 1;
      groups.set(key, group);
    }
    return [...groups.entries()].map(([key, { first, count, oneByOne }]) => ({
      key: `unread:${key}`,
      group: 'sources',
      priority: 1,
      kind: 'fields_not_read',
      params: { concept: first.concept, fields: first.fields.join(', '), count },
      action: { kind: 'repair_mapping', mappingId: first.mappingId, ...(oneByOne > 1 ? { bulkEdit: true } : {}) },
    }));
  }

  /**
   * Derived sources that cannot make a record any more: a field removed from the source concept was
   * the one a key field is copied from, or the one the most recent rule orders by. Runs leave the
   * concept out until the derived source is changed.
   */
  private async derivedNotMade(modelId: string, versionId: string): Promise<ReviewQueueItem[]> {
    type Row = Pick<DerivedSource, 'id' | 'conceptId' | 'fieldMappings' | 'conflictRule' | 'orderBy' | 'expand'> & {
      concept: string; source: string; sourceFields: string[]; targetFields: string[]; identity: string[] | null;
    };
    const rows = await this.database.query<Row>(
      `SELECT d.id::text AS id, d.concept_id::text AS "conceptId", d.field_mappings AS "fieldMappings",
              d.conflict_rule AS "conflictRule", d.order_by AS "orderBy", d.expand, t.label AS concept, s.label AS source,
              ARRAY(SELECT a->>'key' FROM jsonb_array_elements(s.attributes) a) AS "sourceFields",
              ARRAY(SELECT a->>'key' FROM jsonb_array_elements(t.attributes) a) AS "targetFields",
              ARRAY(SELECT jsonb_array_elements_text(i.fields)) AS identity
       FROM semantic_model.derived_sources d
       JOIN semantic_model.node_types t ON t.id=d.concept_id AND t.version_id=$2
       JOIN semantic_model.node_types s ON s.id=d.source_concept_id AND s.version_id=$2
       LEFT JOIN semantic_model.identity_rules i ON i.model_id=d.model_id AND i.concept_id=d.concept_id
       WHERE d.model_id=$1
       ORDER BY d.created_at`,
      [modelId, versionId],
    ).then((result) => result.rows).catch(() => []);
    return rows.flatMap((row) => {
      const { missing } = checkDerivedSource(row, new Set(row.sourceFields), new Set(row.targetFields), row.identity ?? []);
      if (!missing.length) return [];
      return [{
        key: `derived:${row.id}`,
        group: 'sources' as const,
        priority: 1 as const,
        kind: 'derived_source_broken',
        params: { concept: row.concept, source: row.source, fields: missing.map((field) => field.replaceAll('_', ' ')).join(', ') },
        action: { kind: 'repair_derived' as const, derivedSourceId: row.id, conceptId: row.conceptId },
      }];
    });
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
      `SELECT m.id::text AS id, COALESCE(m.source_label, p.profile->'metadata'->>'originalName', '') AS name
       FROM semantic_model.source_mappings m
       LEFT JOIN LATERAL (SELECT profile FROM semantic_datasource.discovery_profiles
         WHERE workspace_id=m.workspace_id AND asset_id=m.document_id ORDER BY completed_at DESC LIMIT 1) p ON true
       WHERE m.model_id=$1 AND m.id::text = ANY($2::text[])`,
      [modelId, [...new Set(mappingIds)]],
    ).catch(() => ({ rows: [] as Array<{ id: string; name: string }> }));
    for (const row of result.rows) names.set(row.id, row.name);
    return names;
  }

  /**
   * What the prepared draft data is missing: empty values, links that found no record, and rows that
   * could not become records. The same list Explore data shows, so both count the same problems.
   * Absent when nothing has been prepared yet.
   */
  private async dataGaps(userId: string, modelId: string): Promise<ReviewQueueItem[]> {
    try {
      const records = await this.runtime.getBoundRecords(modelId, userId, 1);
      const concepts = new Map(records.specification.concepts.map((concept) => [concept.conceptId, concept.label]));
      // The prepared data names a link by its key ("repond_a"); a person reads its label ("répond à").
      const relationLabels = await this.database.query<{ id: string; label: string }>(
        'SELECT r.id::text AS id, r.label FROM semantic_model.relation_types r JOIN semantic_model.models m ON m.current_draft_version_id=r.version_id WHERE m.id=$1',
        [modelId],
      ).then((result) => new Map(result.rows.map((row) => [row.id, row.label])));
      const relations = new Map((records.specification.relations ?? [])
        .map((relation) => [relation.relationId, relationLabels.get(relation.relationId) || relation.label]));
      const nodes = await this.database.query<{ id: string; attributes: Array<{ key: string; label: string; required?: boolean }> }>(
        'SELECT n.id::text AS id, n.attributes FROM semantic_model.node_types n JOIN semantic_model.models m ON m.current_draft_version_id=n.version_id WHERE m.id=$1',
        [modelId],
      ).then((result) => result.rows);
      const field = (conceptId: string, attribute: string) => nodes.find((node) => node.id === conceptId)
        ?.attributes?.find((candidate) => candidate.key === attribute);
      const gaps = records.gaps ?? { missingValues: [], unresolvedLinks: [], other: [] };
      const emptyFields = new Set(gaps.missingValues.map((gap) => `${gap.conceptId}:${gap.attribute}`));
      const otherItem = (gap: (typeof gaps.other)[number]): ReviewQueueItem | null => {
        const concept = gap.conceptId ? concepts.get(gap.conceptId) ?? '' : '';
        const key = `other:${gap.conceptId ?? 'model'}:${gap.kind}`;
        if (FIELD_NOT_FOUND.has(gap.kind)) {
          // Already listed as the values it leaves empty, which is where it is fixed.
          const fields = gap.fields ?? [];
          if (!gap.conceptId || !fields.length || fields.every((name) => emptyFields.has(`${gap.conceptId}:${name}`))) return null;
          const name = fields.find((candidate) => !emptyFields.has(`${gap.conceptId}:${candidate}`))!;
          return { key, group: 'data', priority: 2, kind: 'field_not_found', params: { concept, field: field(gap.conceptId, name)?.label || name, count: gap.count },
            action: { kind: 'fix_values', conceptId: gap.conceptId, attribute: name } };
        }
        if (gap.kind === 'missing_identity' && gap.conceptId) {
          return { key, group: 'sources', priority: 1, kind: 'rows_not_read', params: { concept, count: gap.count },
            action: { kind: 'review_rows', conceptId: gap.conceptId } };
        }
        if (gap.kind === 'ai_extraction_unavailable' && gap.conceptId) {
          return { key, group: 'sources', priority: 1, kind: 'extraction_failed', params: { concept, count: gap.count },
            action: { kind: 'open_sources', conceptId: gap.conceptId } };
        }
        if (DOCUMENT_NOT_READ.has(gap.kind) && gap.conceptId) {
          return { key, group: 'sources', priority: 1, kind: 'documents_not_read', params: { concept, count: gap.count },
            action: { kind: 'open_sources', conceptId: gap.conceptId } };
        }
        if (READING_LIMIT.has(gap.kind)) return { key, group: 'sources', priority: 2, kind: 'reading_limit', params: { count: gap.count }, action: { kind: 'view_data' } };
        if (gap.kind === 'conflicting_values') {
          return { key, group: 'decisions', priority: 2, kind: 'values_disagree', params: { concept, count: gap.count }, action: { kind: 'view_data' } };
        }
        return { key, group: 'data', priority: 2, kind: 'data_gap_other', params: { count: gap.count }, action: { kind: 'view_data' } };
      };
      return [
        // Rows that never became records hide data entirely and a link that found nothing loses a relationship;
        // an empty required field is a gap, an empty optional one only makes the data less complete.
        ...gaps.other.map(otherItem).filter((item): item is ReviewQueueItem => item !== null),
        ...gaps.unresolvedLinks.map((gap): ReviewQueueItem => ({
          key: `links:${gap.relationId}:${gap.kind}`, group: 'links', priority: 2, kind: 'unmatched_links',
          params: { relationship: relations.get(gap.relationId) ?? '', count: gap.count },
          action: { kind: 'check_links', relationId: gap.relationId },
        })),
        ...gaps.missingValues.map((gap): ReviewQueueItem => ({
          key: `gap:${gap.conceptId}:${gap.attribute}`,
          group: 'data',
          priority: field(gap.conceptId, gap.attribute)?.required ? 2 : 3,
          kind: 'missing_values',
          params: { concept: concepts.get(gap.conceptId) ?? '', field: field(gap.conceptId, gap.attribute)?.label || gap.attribute, missing: gap.missing, total: gap.total },
          action: { kind: 'fix_values', conceptId: gap.conceptId, attribute: gap.attribute },
        })),
      ];
    } catch (error) {
      this.logger.debug(`No prepared data to review for ${modelId}: ${(error as Error).message}`);
      return [];
    }
  }
}
