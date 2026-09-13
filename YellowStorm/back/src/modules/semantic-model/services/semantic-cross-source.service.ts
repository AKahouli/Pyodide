import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  reconcilePreviewEntities,
  resolveRelationMatches,
  type RelationResolutionRule,
  type RelationMatch,
  type ReconciledEntity,
  type ResolvedMappingEntity,
  type SourceResolutionPolicy,
} from '../domain/semantic-cross-source.types';
import type {
  DataPreviewDto,
  SaveRelationResolutionRuleDto,
  SaveSourceResolutionPolicyDto,
} from '../dto';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';
import { SemanticSourceMappingService } from './semantic-source-mapping.service';

export interface RelationRuleRow extends RelationResolutionRule {
  relationLabel: string;
  sourceConceptLabel: string;
  targetConceptLabel: string;
}

interface RelationDefinition {
  relationId: string;
  relationLabel: string;
  sourceConceptId: string;
  targetConceptId: string;
  sourceConceptLabel: string;
  targetConceptLabel: string;
  sourceAttributes: Array<{ key: string }>;
  targetAttributes: Array<{ key: string }>;
}

interface ReviewDecision {
  kind: 'ambiguous_relation' | 'source_conflict';
  targetId: string;
  details: Record<string, unknown>;
  resolution: { decision?: string; selectedTargetId?: string; selectedMappingId?: string };
}

@Injectable()
export class SemanticCrossSourceService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly sourceMappings: SemanticSourceMappingService,
  ) {}

  async listRules(userId: string, modelId: string) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    if (!model.currentDraftVersionId) return [];
    return this.ruleRows(model.id, model.currentDraftVersionId);
  }

  async saveRule(userId: string, modelId: string, dto: SaveRelationResolutionRuleDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const definition = await this.requireRelation(model.currentDraftVersionId, dto.relationId);
    this.assertRuleAttributes(definition, dto.sourceAttribute, dto.targetAttribute);
    const result = await this.database.transaction(async (client) => {
      const revision = await this.models.advanceRevision(client, model.id, dto.expectedRevision);
      const saved = await client.query<{ id: string }>(
        `INSERT INTO semantic_model.relation_resolution_rules
         (model_id,relation_id,source_attribute,target_attribute,strategy,ambiguity_policy,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (model_id,relation_id) DO UPDATE SET
           source_attribute=EXCLUDED.source_attribute,target_attribute=EXCLUDED.target_attribute,
           strategy=EXCLUDED.strategy,ambiguity_policy=EXCLUDED.ambiguity_policy,
           updated_by=EXCLUDED.updated_by,updated_at=now()
         RETURNING id`,
        [model.id, dto.relationId, dto.sourceAttribute, dto.targetAttribute, dto.strategy, dto.ambiguityPolicy, userId],
      );
      await this.models.audit(client, model.id, model.currentDraftVersionId, userId, 'relation_resolution_rule.saved', {
        relationId: dto.relationId,
      });
      return { id: saved.rows[0].id, revision };
    });
    return result;
  }

  async previewRule(userId: string, modelId: string, ruleId: string, limit = 25) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const rules = await this.ruleRows(model.id, model.currentDraftVersionId, ruleId);
    const rule = rules[0];
    if (!rule) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Relation resolution rule not found');
    const conceptIds = [...new Set([rule.sourceConceptId, rule.targetConceptId])];
    const [resolved, policies, graphData, decisions] = await Promise.all([
      this.sourceMappings.resolveConfigured(userId, model.id, conceptIds, limit),
      this.policyRows(model.id, conceptIds),
      this.graphPreviewData(model.id, model.currentDraftVersionId, conceptIds, limit),
      this.reviewDecisions(model.id),
    ]);
    const reconciled = reconcilePreviewEntities([...resolved.entities, ...graphData.manualEntities], policies, limit);
    const entities = reconciled.entities;
    const incompleteConceptIds = new Set([...(resolved.incompleteConceptIds ?? []), ...graphData.incompleteConceptIds, ...reconciled.incompleteConceptIds]);
    const matches = resolveRelationMatches(entities, rule, incompleteConceptIds)
      .map((match) => this.applyRelationDecision(match, rule.relationId, decisions));
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    await this.persistReviewItems(model.id, matches
      .filter((match) => match.status === 'ambiguous' && rule.ambiguityPolicy === 'review')
      .map((match) => this.ambiguousReviewItem(rule.id, rule.relationId, match, byId)));
    return {
      rule,
      matches: matches.map((match) => ({
        ...match,
        sourceLabel: byId.get(match.sourceEntityId)?.label ?? match.sourceEntityId,
        targetLabels: match.targetEntityIds.map((id) => byId.get(id)?.label ?? id),
      })),
      summary: this.matchSummary(matches),
      sourceIssues: resolved.issues,
    };
  }

  async listPolicies(userId: string, modelId: string) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    return this.policyRows(model.id);
  }

  async savePolicy(userId: string, modelId: string, conceptId: string, dto: SaveSourceResolutionPolicyDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const concept = await this.database.query(
      'SELECT 1 FROM semantic_model.node_types WHERE version_id=$1 AND id=$2',
      [model.currentDraftVersionId, conceptId],
    );
    if (!concept.rows[0]) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Concept not found in the current draft');
    const mappings = await this.database.query<{ id: string }>(
      'SELECT id FROM semantic_model.source_mappings WHERE model_id=$1 AND concept_id=$2 ORDER BY created_at',
      [model.id, conceptId],
    );
    this.assertPriorities(dto.priorities, mappings.rows.map((mapping) => mapping.id));
    const revision = await this.database.transaction(async (client) => {
      const nextRevision = await this.models.advanceRevision(client, model.id, dto.expectedRevision);
      await client.query(
        `INSERT INTO semantic_model.source_resolution_policies
         (model_id,concept_id,priorities,default_strategy,updated_by)
         VALUES ($1,$2,$3::jsonb,$4,$5)
         ON CONFLICT (model_id,concept_id) DO UPDATE SET
           priorities=EXCLUDED.priorities,default_strategy=EXCLUDED.default_strategy,
           updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [model.id, conceptId, JSON.stringify(dto.priorities), dto.defaultStrategy, userId],
      );
      await this.models.audit(client, model.id, model.currentDraftVersionId, userId, 'source_resolution_policy.saved', { conceptId });
      return nextRevision;
    });
    return { revision };
  }

  async dataPreview(userId: string, modelId: string, dto: DataPreviewDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor', 'viewer']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const [resolved, policies, rules, graphData, decisions] = await Promise.all([
      this.sourceMappings.resolveConfigured(userId, model.id, dto.conceptId ? [dto.conceptId] : [], dto.limit),
      this.policyRows(model.id, dto.conceptId ? [dto.conceptId] : []),
      this.ruleRows(model.id, model.currentDraftVersionId),
      this.graphPreviewData(model.id, model.currentDraftVersionId, dto.conceptId ? [dto.conceptId] : [], dto.limit),
      this.reviewDecisions(model.id),
    ]);
    const mapped = [...resolved.entities, ...graphData.manualEntities];
    const reconciled = reconcilePreviewEntities(mapped, policies, dto.limit);
    const entities = reconciled.entities;
    this.applyConflictDecisions(entities, decisions);
    const incompleteConceptIds = new Set([...(resolved.incompleteConceptIds ?? []), ...graphData.incompleteConceptIds, ...reconciled.incompleteConceptIds]);
    const matches = rules.flatMap((rule) => resolveRelationMatches(entities, rule, incompleteConceptIds)
      .map((match) => ({ rule, ...this.applyRelationDecision(match, rule.relationId, decisions) })));
    const reviewItems = [
      ...entities.flatMap((entity) => entity.conflicts.map((conflict) => ({
        kind: 'source_conflict' as const,
        targetId: entity.id,
        details: { conceptId: entity.conceptId, entityLabel: entity.label, ...conflict },
      }))),
      ...matches.filter((match) => match.status === 'ambiguous' && match.rule.ambiguityPolicy === 'review')
        .map((match) => this.ambiguousReviewItem(match.rule.id, match.rule.relationId, match, new Map(entities.map((entity) => [entity.id, entity])))),
    ];
    if (model.role !== 'viewer') await this.persistReviewItems(model.id, reviewItems);
    const conceptLabels = new Map(graphData.concepts.map((concept) => [concept.id, concept.label]));
    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    return {
      concepts: graphData.concepts.map((concept) => ({
        ...concept,
        entities: entities.filter((entity) => entity.conceptId === concept.id),
      })).filter((concept) => concept.entities.length || !dto.conceptId),
      relations: matches.map((match) => ({
        relationId: match.rule.relationId,
        relationLabel: match.rule.relationLabel,
        sourceConceptLabel: conceptLabels.get(match.rule.sourceConceptId),
        targetConceptLabel: conceptLabels.get(match.rule.targetConceptId),
        sourceEntityId: match.sourceEntityId,
        targetEntityIds: match.targetEntityIds,
        status: match.status,
        sourceValue: match.sourceValue,
        sourceAttribute: match.rule.sourceAttribute,
        targetAttribute: match.rule.targetAttribute,
        targetValues: match.targetEntityIds.map((id) => entityById.get(id)?.values[match.rule.targetAttribute]),
        strategy: match.strategy,
        partial: match.partial,
      })),
      sourceIssues: resolved.issues,
      summary: {
        entities: entities.length,
        resolvedRelations: matches.filter((match) => match.status === 'resolved').length,
        unresolvedRelations: matches.filter((match) => match.status === 'unresolved').length,
        ambiguousRelations: matches.filter((match) => match.status === 'ambiguous').length,
        conflicts: entities.reduce((count, entity) => count + entity.conflicts.length, 0),
      },
    };
  }

  private async ruleRows(modelId: string, versionId: string, ruleId?: string): Promise<RelationRuleRow[]> {
    const params: unknown[] = [modelId, versionId];
    const idFilter = ruleId ? ` AND rule.id=$${params.push(ruleId)}` : '';
    const result = await this.database.query<RelationRuleRow>(
      `SELECT rule.id, rule.relation_id AS "relationId", relation.label AS "relationLabel",
              relation.source_node_type_id AS "sourceConceptId", source.label AS "sourceConceptLabel",
              relation.target_node_type_id AS "targetConceptId", target.label AS "targetConceptLabel",
               rule.source_attribute AS "sourceAttribute", rule.target_attribute AS "targetAttribute", relation.cardinality,
              rule.strategy, rule.ambiguity_policy AS "ambiguityPolicy"
       FROM semantic_model.relation_resolution_rules rule
       JOIN semantic_model.relation_types relation ON relation.version_id=$2 AND relation.id=rule.relation_id
       JOIN semantic_model.node_types source ON source.version_id=relation.version_id AND source.id=relation.source_node_type_id
       JOIN semantic_model.node_types target ON target.version_id=relation.version_id AND target.id=relation.target_node_type_id
       WHERE rule.model_id=$1${idFilter} ORDER BY relation.created_at`, params);
    return result.rows;
  }

  private async policyRows(modelId: string, conceptIds: string[] = []): Promise<SourceResolutionPolicy[]> {
    const params: unknown[] = [modelId];
    const filter = conceptIds.length ? ` AND concept_id=ANY($${params.push(conceptIds)}::uuid[])` : '';
    const result = await this.database.query<SourceResolutionPolicy>(
      `SELECT concept_id AS "conceptId", priorities, default_strategy AS "defaultStrategy"
       FROM semantic_model.source_resolution_policies WHERE model_id=$1${filter}`,
      params,
    );
    return result.rows;
  }

  private async requireRelation(versionId: string | null, relationId: string): Promise<RelationDefinition> {
    if (!versionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const result = await this.database.query<RelationDefinition>(
      `SELECT relation.id AS "relationId", relation.label AS "relationLabel",
              source.id AS "sourceConceptId", source.label AS "sourceConceptLabel", source.attributes AS "sourceAttributes",
              target.id AS "targetConceptId", target.label AS "targetConceptLabel", target.attributes AS "targetAttributes"
       FROM semantic_model.relation_types relation
       JOIN semantic_model.node_types source ON source.version_id=relation.version_id AND source.id=relation.source_node_type_id
       JOIN semantic_model.node_types target ON target.version_id=relation.version_id AND target.id=relation.target_node_type_id
       WHERE relation.version_id=$1 AND relation.id=$2`, [versionId, relationId]);
    if (!result.rows[0]) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Relationship not found in the current draft');
    return result.rows[0];
  }

  private assertRuleAttributes(definition: RelationDefinition, sourceAttribute: string, targetAttribute: string): void {
    if (!definition.sourceAttributes.some((attribute) => attribute.key === sourceAttribute)
      || !definition.targetAttributes.some((attribute) => attribute.key === targetAttribute)) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Matching fields must belong to the relationship endpoint concepts');
    }
  }

  private assertPriorities(priorities: Array<{ mappingId: string; rank: number }>, mappingIds: string[]): void {
    const ids = priorities.map((priority) => priority.mappingId);
    const ranks = priorities.map((priority) => priority.rank).sort((a, b) => a - b);
    const expectedRanks = priorities.map((_, index) => index + 1);
    if (new Set(ids).size !== ids.length || JSON.stringify(ranks) !== JSON.stringify(expectedRanks)
      || ids.some((id) => !mappingIds.includes(id)) || mappingIds.some((id) => !ids.includes(id))) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Source priority must rank every mapping for this concept exactly once');
    }
  }

  private async graphPreviewData(modelId: string, versionId: string, conceptIds: string[] = [], limit = 25) {
    const graphParams: unknown[] = [modelId, versionId];
    const filter = conceptIds.length ? ` AND node.id=ANY($${graphParams.push(conceptIds)}::uuid[])` : '';
    const recordParams = [...graphParams, limit + 1];
    const sampleLimit = recordParams.length;
    const [concepts, records, identities] = await Promise.all([
      this.database.query<{ id: string; label: string }>(
        `SELECT node.id,node.label FROM semantic_model.node_types node WHERE node.model_id=$1 AND node.version_id=$2${filter} ORDER BY node.created_at`, graphParams),
      this.database.query<{ id: string; conceptId: string; label: string; values: Record<string, unknown>; samplePosition: number }>(
        `SELECT sampled.id,sampled."conceptId",sampled.label,sampled.values,sampled."samplePosition"
         FROM (
           SELECT record.id,record.node_type_id AS "conceptId",record.label,record.values,
                  ROW_NUMBER() OVER (PARTITION BY record.node_type_id ORDER BY record.created_at) AS "samplePosition"
           FROM semantic_model.records record
           WHERE record.model_id=$1 AND record.version_id=$2${conceptIds.length ? ' AND record.node_type_id=ANY($3::uuid[])' : ''}
         ) sampled WHERE sampled."samplePosition" <= $${sampleLimit}
         ORDER BY sampled."conceptId",sampled."samplePosition"`, recordParams),
      this.database.query<{ conceptId: string; fields: string[] }>(
        `SELECT concept_id AS "conceptId",fields FROM semantic_model.identity_rules WHERE model_id=$1${conceptIds.length ? ' AND concept_id=ANY($2::uuid[])' : ''}`,
        conceptIds.length ? [modelId, conceptIds] : [modelId]),
    ]);
    const identityByConcept = new Map(identities.rows.map((identity) => [identity.conceptId, identity.fields]));
    const incompleteConceptIds = new Set(records.rows
      .filter((record) => Number(record.samplePosition) > limit)
      .map((record) => record.conceptId));
    const manualEntities: ResolvedMappingEntity[] = records.rows
      .filter((record) => Number(record.samplePosition) <= limit)
      .map((record) => ({
      conceptId: record.conceptId,
      mappingId: `manual:${record.id}`,
      identityFields: identityByConcept.get(record.conceptId) ?? [],
      source: { kind: 'manual', documentName: 'Manual Business Record' },
      entity: { entityKey: record.id, label: record.label, values: record.values, provenance: {} },
    }));
    return { concepts: concepts.rows, manualEntities, incompleteConceptIds: [...incompleteConceptIds] };
  }

  private matchSummary(matches: Array<{ status: 'resolved' | 'ambiguous' | 'unresolved' }>) {
    return {
      resolved: matches.filter((match) => match.status === 'resolved').length,
      ambiguous: matches.filter((match) => match.status === 'ambiguous').length,
      unresolved: matches.filter((match) => match.status === 'unresolved').length,
    };
  }

  private async reviewDecisions(modelId: string): Promise<ReviewDecision[]> {
    const result = await this.database.query<ReviewDecision>(
      `SELECT kind,target_id AS "targetId",details,resolution FROM semantic_model.review_items
       WHERE model_id=$1 AND status='resolved' AND resolution->>'decision'='accepted'`,
      [modelId],
    );
    return result.rows;
  }

  private applyRelationDecision(match: RelationMatch, relationId: string, decisions: ReviewDecision[]): RelationMatch {
    if (match.status !== 'ambiguous') return match;
    const decision = decisions.find((candidate) => candidate.kind === 'ambiguous_relation'
      && candidate.targetId === relationId && candidate.details.sourceEntityId === match.sourceEntityId);
    const selected = decision?.resolution.selectedTargetId;
    return selected && match.targetEntityIds.includes(selected)
      ? { ...match, targetEntityIds: [selected], status: 'resolved' }
      : match;
  }

  private applyConflictDecisions(entities: ReconciledEntity[], decisions: ReviewDecision[]): void {
    for (const entity of entities) {
      entity.conflicts = entity.conflicts.filter((conflict) => {
        const decision = decisions.find((candidate) => candidate.kind === 'source_conflict'
          && candidate.targetId === entity.id && candidate.details.attribute === conflict.attribute
          && candidate.details.preferredMappingId === conflict.preferredMappingId
          && candidate.details.conflictingMappingId === conflict.conflictingMappingId);
        const selected = decision?.resolution.selectedMappingId;
        if (!selected || ![conflict.preferredMappingId, conflict.conflictingMappingId].includes(selected)) return true;
        entity.values[conflict.attribute] = selected === conflict.preferredMappingId ? conflict.preferred : conflict.conflicting;
        entity.provenance[conflict.attribute] = selected === conflict.preferredMappingId
          ? conflict.preferredProvenance
          : conflict.conflictingProvenance;
        return false;
      });
    }
  }

  private ambiguousReviewItem(ruleId: string, relationId: string, match: RelationMatch, entities: Map<string, ReconciledEntity>) {
    return {
      kind: 'ambiguous_relation' as const,
      targetId: relationId,
      details: {
        ruleId,
        sourceEntityId: match.sourceEntityId,
        targetEntityIds: match.targetEntityIds,
        sourceLabel: entities.get(match.sourceEntityId)?.label ?? match.sourceEntityId,
        targetLabels: match.targetEntityIds.map((id) => entities.get(id)?.label ?? id),
        sourceValue: match.sourceValue,
        strategy: match.strategy,
        partial: match.partial,
      },
    };
  }

  private async persistReviewItems(modelId: string, items: Array<{ kind: 'ambiguous_relation' | 'source_conflict'; targetId: string; details: unknown }>) {
    for (const item of items.slice(0, 200)) {
      const details = item.details as Record<string, unknown>;
      const identity = item.kind === 'ambiguous_relation'
        ? `${String(details.sourceEntityId)}:${[...(details.targetEntityIds as string[] ?? [])].sort().join(',')}`
        : `${String(details.attribute)}:${String(details.preferredMappingId)}:${String(details.conflictingMappingId)}`;
      const fingerprint = createHash('sha256').update(`${item.kind}:${item.targetId}:${identity}`).digest('hex');
      await this.database.query(
        `INSERT INTO semantic_model.review_items (model_id,kind,target_id,fingerprint,details)
         VALUES ($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT (model_id,fingerprint) DO UPDATE SET details=EXCLUDED.details,updated_at=now()`,
        [modelId, item.kind, item.targetId, fingerprint, JSON.stringify(item.details)],
      );
    }
  }
}
