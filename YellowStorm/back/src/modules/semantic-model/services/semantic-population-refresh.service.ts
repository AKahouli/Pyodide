import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import type { AttributeDefinition } from '../domain/semantic-model.types';
import type { RelationResolutionRule } from '../domain/semantic-cross-source.types';
import type { SourceFieldMapping } from '../domain/semantic-source-mapping.types';
import type { ConceptSpec, RelationSpec } from '../domain/model-specification.types';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { ModelSpecificationService } from './model-specification.service';
import { SemanticModelService } from './semantic-model.service';
import { SemanticRuntimeClientService } from './semantic-runtime-client.service';
import { DOCUMENT_MIME_TYPES, STRUCTURED_MIME_PREFIXES } from './semantic-source-mapping.service';

export type PopulationRefreshScope = { kind: 'model' } | { kind: 'mapping'; mappingId: string };

export interface RequestPopulationRefreshInput {
  purpose: 'build' | 'refresh';
  scope: { kind: 'model' | 'mapping'; mappingId?: string };
}

interface NodeTypeRow {
  id: string;
  key: string;
  label: string;
  attributes: AttributeDefinition[];
}

interface RelationTypeRow {
  id: string;
  key: string;
  sourceNodeTypeId: string;
  targetNodeTypeId: string;
  cardinality: RelationSpec['cardinality'];
}

interface MappingRow {
  id: string;
  conceptId: string;
  workspaceId: string;
  documentId: string;
  sheetName: string;
  assetKind: string;
  fieldMappings: SourceFieldMapping[];
  status: string;
  identityFields: string[] | null;
  sourceEnabled: boolean;
  validatedSourceVersion: string | null;
  updatedAt: Date;
}

type RelationRuleRow = Pick<RelationResolutionRule,
  'relationId' | 'sourceAttribute' | 'targetAttribute' | 'strategy'>;

const POPULATION_KINDS = new Set(['excel_sheet', 'csv', 'document']);
const MAX_REFRESH_SOURCES = 25;
const POPULATION_ENGINE_VERSION = 'r1-mvp-4';

@Injectable()
export class SemanticPopulationRefreshService {
  private readonly logger = new Logger(SemanticPopulationRefreshService.name);

  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly documents: WorkspaceDocumentService,
    private readonly specifications: ModelSpecificationService,
    private readonly runtime: SemanticRuntimeClientService,
  ) {}

  async getJob(userId: string, modelId: string, jobId: string) {
    await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const job = await this.runtime.getJob(jobId, userId);
    if (job.jobType !== 'population.run' || job.modelId !== modelId) {
      throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Population job not found');
    }
    return job;
  }

  async boundRecords(userId: string, modelId: string, limit: number, conceptId?: string, dataRevisionId?: string) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const records = await this.runtime.getBoundRecords(model.id, userId, limit, conceptId, dataRevisionId);
    const entities = records.entities;
    const entityIds = new Set(entities.map((entity) => entity.entityId));
    const relationLabels = new Map(records.specification.relations.map((relation) => [relation.relationId, relation.label]));
    return {
      dataRevisionId: records.dataRevisionId,
      concepts: records.specification.concepts
        .filter((concept) => !conceptId || concept.conceptId === conceptId)
        .map((concept) => ({
          id: concept.conceptId,
          label: concept.label,
          entities: entities.filter((entity) => entity.conceptId === concept.conceptId).map((entity) => ({
            id: entity.entityId,
            conceptId: entity.conceptId,
            entityKey: entity.entityId,
            label: entity.label,
            values: entity.attributes,
            provenance: {},
            conflicts: [],
          })),
        })),
      relations: records.relationships
        .filter((relation) => entityIds.has(relation.sourceEntityId) && entityIds.has(relation.targetEntityId))
        .map((relation) => ({
          relationId: relation.relationId,
          relationLabel: relationLabels.get(relation.relationId) ?? relation.relationId,
          sourceEntityId: relation.sourceEntityId,
          targetEntityIds: [relation.targetEntityId],
          status: 'resolved' as const,
          sourceValue: null,
          sourceAttribute: '',
          targetAttribute: '',
          targetValues: [],
          strategy: relation.matchingStrategy ?? 'normalized',
          partial: false,
        })),
      sourceIssues: [],
      summary: {
        entities: records.counts.entities,
        resolvedRelations: records.counts.relationships,
        unresolvedRelations: 0,
        ambiguousRelations: 0,
        conflicts: 0,
      },
    };
  }

  async boundGraph(userId: string, modelId: string, dataRevisionId?: string) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const graph = await this.runtime.getBoundGraph(model.id, userId, dataRevisionId);
    const conceptById = new Map(graph.specification.concepts.map((concept) => [concept.conceptId, concept]));
    const relationLabels = new Map(graph.specification.relations.map((relation) => [relation.relationId, relation.label]));
    return {
      dataRevisionId: graph.dataRevisionId,
      nodes: graph.nodes.map((node) => {
        const concept = conceptById.get(String(node.properties.concept_id ?? node.label));
        return {
          ...node,
          label: concept?.label ?? node.label,
          properties: {
            ...node.properties,
            _meta: {
              nodeTypeLabel: concept?.label ?? node.label,
              attributes: (concept?.allowedFields ?? []).map((field) => ({
                key: field,
                label: field,
                value: node.properties[field] ?? null,
              })),
            },
          },
        };
      }),
      edges: graph.edges.map((edge) => ({
        ...edge,
        label: relationLabels.get(edge.label) ?? edge.label,
      })),
    };
  }

  async requestRefresh(userId: string, modelId: string, input: RequestPopulationRefreshInput) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const scope: PopulationRefreshScope = input.scope.kind === 'mapping'
      ? { kind: 'mapping', mappingId: input.scope.mappingId ?? '' }
      : { kind: 'model' };
    const [nodes, relationRows, identityRules, relationRules, links] = await Promise.all([
      this.database.query<NodeTypeRow>(
        'SELECT id, key, label, attributes FROM semantic_model.node_types WHERE version_id=$1',
        [model.currentDraftVersionId],
      ).then((result) => result.rows),
      this.database.query<RelationTypeRow>(
        `SELECT id, key, source_node_type_id AS "sourceNodeTypeId",
                target_node_type_id AS "targetNodeTypeId", cardinality
         FROM semantic_model.relation_types WHERE version_id=$1`,
        [model.currentDraftVersionId],
      ).then((result) => result.rows),
      this.database.query<{ conceptId: string; fields: string[] }>(
        'SELECT concept_id AS "conceptId", fields FROM semantic_model.identity_rules WHERE model_id=$1',
        [model.id],
      ).then((result) => new Map(result.rows.map((row) => [row.conceptId, row.fields]))),
      this.database.query<RelationRuleRow>(
        `SELECT relation_id AS "relationId", source_attribute AS "sourceAttribute",
                target_attribute AS "targetAttribute", strategy
         FROM semantic_model.relation_resolution_rules WHERE model_id=$1`,
        [model.id],
      ).then((result) => result.rows),
      this.database.query<{ workspaceId: string; role: string }>(
        'SELECT workspace_id AS "workspaceId", role FROM semantic_model.workspace_links WHERE model_id=$1 AND enabled',
        [model.id],
      ).then((result) => result.rows),
    ]);
    const homeWorkspaceId = links.find((link) => link.role === 'origin')?.workspaceId;
    if (!homeWorkspaceId) {
      throw new ConflictException(ErrorCode.SEMANTIC_MODEL_WORKSPACE_INVALID, 'The model has no origin workspace');
    }
    const mappings = await this.loadScopeMappings(model.id, scope);
    const sources = [];
    const usableMappings: MappingRow[] = [];
    const skipped: Array<{ mappingId: string; reason: string }> = [];
    for (const mapping of [...mappings].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
      try {
        const node = nodes.find((candidate) => candidate.id === mapping.conceptId);
        if (!node) {
          throw new BadRequestException(
            ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
            'The mapped concept is not present in the current draft',
          );
        }
        sources.push(await this.populationSource(mapping, node));
        usableMappings.push(mapping);
      } catch (error) {
        if (scope.kind === 'mapping') throw error;
        skipped.push({ mappingId: mapping.id, reason: (error as Error).message });
      }
    }
    if (!sources.length) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'No usable source in the selected scope');
    }
    const scopedConceptIds = new Set(usableMappings.map((mapping) => mapping.conceptId));
    const concepts = nodes
      .filter((node) => scopedConceptIds.has(node.id))
      .map((node) => this.conceptSpec(node, identityRules.get(node.id) ?? []));
    const inScope = new Set(concepts.map((concept) => concept.conceptId));
    const relations: RelationSpec[] = [];
    const relationBindings: Array<{ relationId: string; referenceField: string; targetField: string }> = [];
    for (const relation of relationRows.filter(
      (candidate) => inScope.has(candidate.sourceNodeTypeId) && inScope.has(candidate.targetNodeTypeId),
    )) {
      const rule = relationRules.find((candidate) => candidate.relationId === relation.id);
      relations.push({
        relationId: relation.id,
        key: relation.key,
        label: relation.key,
        sourceConceptId: relation.sourceNodeTypeId,
        targetConceptId: relation.targetNodeTypeId,
        cardinality: relation.cardinality,
        matchingStrategy: rule?.strategy ?? 'normalized',
      });
      if (rule) {
        const sourceFieldMapped = sources.some((source) => {
          if (source.conceptId !== relation.sourceNodeTypeId) return false;
          if ('columnMapping' in source) return Object.values(source.columnMapping).includes(rule.sourceAttribute);
          return source.fieldMappings.some((field) => field.targetAttribute === rule.sourceAttribute);
        });
        const targetFieldMapped = sources.some((source) => {
          if (source.conceptId !== relation.targetNodeTypeId) return false;
          if ('columnMapping' in source) return Object.values(source.columnMapping).includes(rule.targetAttribute);
          return source.fieldMappings.some((field) => field.targetAttribute === rule.targetAttribute);
        });
        const sourceType = nodes.find((node) => node.id === relation.sourceNodeTypeId)
          ?.attributes.find((attribute) => attribute.key === rule.sourceAttribute)?.type;
        const targetType = nodes.find((node) => node.id === relation.targetNodeTypeId)
          ?.attributes.find((attribute) => attribute.key === rule.targetAttribute)?.type;
        if (!sourceFieldMapped || !targetFieldMapped || !sourceType || sourceType !== targetType) {
          throw new BadRequestException(
            ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
            `Relation "${relation.key}" cannot be populated by the selected mappings`,
          );
        }
        relationBindings.push({
          relationId: relation.id,
          referenceField: rule.sourceAttribute,
          targetField: rule.targetAttribute,
        });
      }
    }
    if (!concepts.length) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'The selected scope has no mapped concepts');
    }
    const draft = {
      modelId: model.id,
      modelVersionId: model.currentDraftVersionId,
      homeWorkspaceId,
      concepts,
      relations,
      sourceScope: [...new Map(
        usableMappings.map((mapping) => [`${mapping.workspaceId}:${mapping.documentId}`, { workspaceId: mapping.workspaceId, assetId: mapping.documentId }]),
      ).values()],
    };
    const issues = this.specifications.validate(draft);
    if (issues.length) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, issues[0]?.message ?? 'The population specification is invalid');
    }
    const snapshot = this.specifications.buildSnapshot(draft);
    if (!snapshot.specHash) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'The population specification could not be hashed');
    }
    const { specHash, ...specification } = snapshot;
    await this.runtime.mirrorSpecification({
      homeWorkspaceId,
      modelId: model.id,
      modelVersionId: model.currentDraftVersionId,
      specHash,
      specification,
    });
    const scopeKey = scope.kind === 'model' ? 'model' : `mapping:${scope.mappingId}`;
    relationBindings.sort((left, right) => left.relationId < right.relationId ? -1 : left.relationId > right.relationId ? 1 : 0);
    const runtimeSources = JSON.parse(JSON.stringify(sources)) as typeof sources;
    const populationExecutionFingerprint = this.specifications.hashCanonical({
      specHash,
      sources: runtimeSources.map((source) => ({
        conceptId: source.conceptId,
        sourceKind: source.sourceKind,
        source: source.source,
        mappingVersion: source.mappingVersion,
        columnMapping: 'columnMapping' in source ? source.columnMapping : null,
        constantMapping: 'constantMapping' in source ? source.constantMapping : null,
        fieldMappings: 'fieldMappings' in source ? source.fieldMappings : null,
        options: 'options' in source ? source.options : {},
        labelField: 'labelField' in source ? source.labelField ?? null : null,
      })),
      relationBindings,
      populationEngineVersion: POPULATION_ENGINE_VERSION,
    });
    const idempotencyKey = createHash('sha256')
      .update(JSON.stringify({
        modelVersionId: model.currentDraftVersionId,
        specHash: snapshot.specHash,
        populationExecutionFingerprint,
        purpose: input.purpose,
        scope: scopeKey,
        sources: runtimeSources,
        relationBindings,
      }))
      .digest('hex');
    const accepted = await this.runtime.requestPopulationRun({
      actorUserId: userId,
      modelId: model.id,
      workspaceId: homeWorkspaceId,
      payload: {
        modelVersionId: model.currentDraftVersionId,
        specHash: snapshot.specHash,
        populationExecutionFingerprint,
        purpose: input.purpose,
        scope,
        specification: snapshot,
        sources: runtimeSources,
        relationBindings,
      },
    }, idempotencyKey);
    return { ...accepted, skipped };
  }

  private conceptSpec(node: NodeTypeRow, identityFields: string[]): ConceptSpec {
    const knownKeys = new Set((node.attributes ?? []).map((attribute) => attribute.key));
    const keyComponents = identityFields.filter((field) => knownKeys.has(field));
    if (!keyComponents.length) {
      throw new BadRequestException(
        ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        `Concept "${node.label}" has no usable identity fields`,
      );
    }
    return {
      conceptId: node.id,
      key: node.key,
      label: node.label,
      identity: { namespace: node.key, keyComponents },
      populationMode: 'materialized',
      allowedFields: (node.attributes ?? []).map((attribute) => attribute.key),
    };
  }

  private async loadScopeMappings(modelId: string, scope: PopulationRefreshScope): Promise<MappingRow[]> {
    if (scope.kind === 'mapping') {
      if (!scope.mappingId) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'A mapping scope requires a mappingId');
      }
      const result = await this.database.query<MappingRow>(
        `SELECT m.id, m.concept_id AS "conceptId", m.workspace_id AS "workspaceId",
                m.document_id AS "documentId", m.sheet_name AS "sheetName",
                m.asset_kind AS "assetKind", m.field_mappings AS "fieldMappings",
                m.status, i.fields AS "identityFields",
                COALESCE(w.enabled, false) AS "sourceEnabled",
                m.validated_source_version AS "validatedSourceVersion", m.updated_at AS "updatedAt"
         FROM semantic_model.source_mappings m
         LEFT JOIN semantic_model.workspace_links w ON w.model_id=m.model_id AND w.workspace_id=m.workspace_id
         LEFT JOIN semantic_model.identity_rules i ON i.model_id=m.model_id AND i.concept_id=m.concept_id
         WHERE m.model_id=$1 AND m.id=$2`,
        [modelId, scope.mappingId],
      );
      const mapping = result.rows[0];
      if (!mapping) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Source mapping not found');
      this.assertUsable(mapping);
      return [mapping];
    }
    const result = await this.database.query<MappingRow>(
      `SELECT m.id, m.concept_id AS "conceptId", m.workspace_id AS "workspaceId",
              m.document_id AS "documentId", m.sheet_name AS "sheetName",
              m.asset_kind AS "assetKind", m.field_mappings AS "fieldMappings",
              m.status, i.fields AS "identityFields",
              COALESCE(w.enabled, false) AS "sourceEnabled",
              m.validated_source_version AS "validatedSourceVersion", m.updated_at AS "updatedAt"
       FROM semantic_model.source_mappings m
       LEFT JOIN semantic_model.workspace_links w ON w.model_id=m.model_id AND w.workspace_id=m.workspace_id
       LEFT JOIN semantic_model.identity_rules i ON i.model_id=m.model_id AND i.concept_id=m.concept_id
       WHERE m.model_id=$1 AND m.status='ready' AND COALESCE(w.enabled, false)
       ORDER BY m.id`,
      [modelId],
    );
    if (result.rows.length > MAX_REFRESH_SOURCES) {
      throw new BadRequestException(
        ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        `Whole-model refresh supports at most ${MAX_REFRESH_SOURCES} sources; refresh a single mapping instead`,
      );
    }
    return result.rows;
  }

  private assertUsable(mapping: MappingRow): void {
    if (!POPULATION_KINDS.has(mapping.assetKind)) {
      throw new BadRequestException(
        ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        'The mapped source kind cannot populate',
      );
    }
    if (!mapping.sourceEnabled || mapping.status !== 'ready') {
      throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT, 'The mapped source is not available');
    }
  }

  private async populationSource(mapping: MappingRow, node: NodeTypeRow) {
    this.assertUsable(mapping);
    const document = await this.documents.findById(mapping.workspaceId, mapping.documentId);
    const currentSourceVersion = document.contentHash || `${document.updatedAt}:${document.size}`;
    const currentKind = STRUCTURED_MIME_PREFIXES.some((prefix) => document.mimeType.startsWith(prefix))
      ? document.mimeType.includes('csv') ? 'csv' : 'excel_sheet'
      : DOCUMENT_MIME_TYPES.has(document.mimeType) ? 'document' : null;
    if (currentSourceVersion !== mapping.validatedSourceVersion || currentKind !== mapping.assetKind) {
      throw new ConflictException(
        ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT,
        'The mapped source changed since this mapping was validated',
      );
    }
    const knownAttributes = new Set((node.attributes ?? []).map((attribute) => attribute.key));
    const activeMappings = (mapping.fieldMappings ?? []).filter((field) => field.mode !== 'ignore');
    if (activeMappings.some((field) => !knownAttributes.has(field.targetAttribute))) {
      throw new BadRequestException(
        ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        'The mapping targets an attribute that is not present in the current draft',
      );
    }
    const allowedModes = mapping.assetKind === 'document'
      ? new Set(['extract', 'metadata', 'constant'])
      : new Set(['direct', 'constant']);
    if (activeMappings.some((field) => !allowedModes.has(field.mode))) {
      throw new BadRequestException(
        ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        'The mapping contains a field mode unsupported by its source kind',
      );
    }
    const mappedAttributes = new Set(activeMappings.map((field) => field.targetAttribute));
    if (mappedAttributes.size !== activeMappings.length) {
      throw new BadRequestException(
        ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        'A concept attribute can only be mapped once per source',
      );
    }
    const identityFields = new Set(mapping.identityFields ?? []);
    if ([...identityFields].some((field) => !mappedAttributes.has(field))) {
      throw new BadRequestException(
        ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        'The mapping must populate every identity field',
      );
    }
    const source = {
      workspaceId: mapping.workspaceId,
      assetId: mapping.documentId,
      assetVersionId: mapping.validatedSourceVersion ?? undefined,
      originalName: document.originalName,
      uploaderUserId: document.createdBy,
      mimeType: document.mimeType,
      sizeBytes: document.size,
      indexingStatus: document.indexingStatus,
      contentHash: document.contentHash,
      uploadedAt: document.uploadedAt,
    };
    const mappingVersion = mapping.updatedAt instanceof Date ? mapping.updatedAt.toISOString() : String(mapping.updatedAt);
    if (mapping.assetKind === 'document') {
      const labels = new Map((node.attributes ?? []).map((attribute) => [attribute.key, attribute.label]));
      return {
        sourceKind: 'document' as const,
        conceptId: mapping.conceptId,
        source,
        fieldMappings: activeMappings.map((field) => field.mode === 'extract' && !field.sourceField
          ? { ...field, sourceField: labels.get(field.targetAttribute) || field.targetAttribute }
          : field),
        mappingVersion,
      };
    }
    const columnMapping: Record<string, string> = {};
    const constantMapping: Record<string, unknown> = {};
    for (const field of mapping.fieldMappings ?? []) {
      if (field.mode === 'direct' && field.sourceField) columnMapping[field.sourceField] = field.targetAttribute;
      if (field.mode === 'constant') constantMapping[field.targetAttribute] = field.constantValue;
    }
    if ((!Object.keys(columnMapping).length && !Object.keys(constantMapping).length)
      || [...identityFields].some((field) => !mappedAttributes.has(field))) {
      throw new BadRequestException(
        ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        'The mapping must directly map every identity field',
      );
    }
    const labelField = (mapping.fieldMappings ?? []).find(
      (field) => field.mode === 'direct' && !identityFields.has(field.targetAttribute),
    )?.targetAttribute;
    return {
      sourceKind: mapping.assetKind,
      conceptId: mapping.conceptId,
      source,
      options: mapping.sheetName ? { sheetName: mapping.sheetName } : {},
      columnMapping,
      ...(Object.keys(constantMapping).length ? { constantMapping } : {}),
      ...(labelField ? { labelField } : {}),
      mappingVersion,
    };
  }
}
