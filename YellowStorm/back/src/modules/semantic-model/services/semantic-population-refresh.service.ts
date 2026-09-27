import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import type { AttributeDefinition } from '../domain/semantic-model.types';
import type { RelationResolutionRule } from '../domain/semantic-cross-source.types';
import type { SourceFieldMapping } from '../domain/semantic-source-mapping.types';
import type { ConceptSpec, RelationSpec } from '../domain/model-specification.types';
import type { RecordCorrectionDto } from '../dto/semantic-model.dto';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { ModelSpecificationService } from './model-specification.service';
import { SemanticModelService } from './semantic-model.service';
import { SemanticRuntimeClientService, type RuntimeValueOrigin } from './semantic-runtime-client.service';
import { SemanticAttributeExtractionService } from './semantic-attribute-extraction.service';
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
  aliases?: string[];
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

interface RecordSource {
  mappingId: string;
  workspaceId: string;
  documentId: string;
  documentName: string;
  mimeType?: string;
  sheetName?: string;
  kind: string;
}

type RelationRuleRow =Pick<RelationResolutionRule,
  'relationId' | 'sourceAttribute' | 'targetAttribute' | 'strategy'>;

const POPULATION_KINDS = new Set(['excel_sheet', 'csv', 'document']);
const MAX_REFRESH_SOURCES = 25;
const MANUAL_BATCH_SIZE = 500;
const POPULATION_ENGINE_VERSION = 'r1-mvp-5';
// Version of the AI extraction contract (prompt + response shape). Must equal the
// ADK's reported extractorVersion; bump both together.
const AI_EXTRACTION_CONTRACT_VERSION = 'ai-attribute-v1';

@Injectable()
export class SemanticPopulationRefreshService {
  private readonly logger = new Logger(SemanticPopulationRefreshService.name);

  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly documents: WorkspaceDocumentService,
    private readonly specifications: ModelSpecificationService,
    private readonly runtime: SemanticRuntimeClientService,
    private readonly aiExtractionAgent: SemanticAttributeExtractionService,
  ) {}

  /**
   * Identity of the AI extractor actually used, or null when no mapping needs
   * it. Resolved from the admin-managed default agent so a model change there
   * changes the revision identity.
   */
  private async aiExtractionIdentity(
    sources: object[],
  ): Promise<{ agentSlug: string; model: string | null; contractVersion: string } | null> {
    const usesAi = sources.some((source) => ((source as { fieldMappings?: SourceFieldMapping[] | null }).fieldMappings ?? [])
      .some((field) => field.mode === 'extract' && field.extractionStrategy === 'ai'));
    if (!usesAi) return null;
    const agent = await this.aiExtractionAgent.resolveAgent();
    return {
      agentSlug: agent.slug,
      model: agent.llmModel ?? null,
      contractVersion: AI_EXTRACTION_CONTRACT_VERSION,
    };
  }

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
    const [nodes, sources] = await Promise.all([
      this.database.query<NodeTypeRow>(
        'SELECT id, key, label, attributes FROM semantic_model.node_types WHERE version_id=$1',
        [model.currentDraftVersionId],
      ).then((result) => result.rows),
      this.recordSources(model.id, entities.flatMap((entity) => Object.values(entity.origins ?? {}))),
    ]);
    const correctors = await this.correctorNames(model.id, userId,
      entities.flatMap((entity) => Object.values(entity.origins ?? {}).map((origin) => origin.correctedBy)));
    const attributeLabel = (concept: string, attribute: string) => nodes.find((node) => node.id === concept)
      ?.attributes?.find((candidate) => candidate.key === attribute)?.label || attribute;
    const entityIds = new Set(entities.map((entity) => entity.entityId));
    const relationLabels = new Map(records.specification.relations.map((relation) => [relation.relationId, relation.label]));
    const conceptLabels = new Map(records.specification.concepts.map((concept) => [concept.conceptId, concept.label]));
    const gaps = records.gaps ?? { missingValues: [], unresolvedLinks: [], other: [] };
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
            provenance: Object.fromEntries(Object.entries(entity.origins ?? {})
              .map(([attribute, origin]) => [attribute, this.withCorrection(this.valueProvenance(origin, sources), origin, correctors)])),
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
      gaps: {
        missingValues: gaps.missingValues.map((gap) => ({
          ...gap,
          conceptLabel: conceptLabels.get(gap.conceptId) ?? gap.conceptId,
          attributeLabel: attributeLabel(gap.conceptId, gap.attribute),
        })),
        unresolvedLinks: gaps.unresolvedLinks.map((gap) => ({
          ...gap,
          relationLabel: relationLabels.get(gap.relationId) ?? gap.relationId,
        })),
        other: gaps.other.map((gap) => ({
          ...gap,
          conceptLabel: gap.conceptId ? conceptLabels.get(gap.conceptId) ?? null : null,
        })),
      },
      summary: {
        entities: records.counts.entities,
        resolvedRelations: records.counts.relationships,
        unresolvedRelations: gaps.unresolvedLinks.reduce((total, gap) => total + gap.count, 0),
        ambiguousRelations: 0,
        conflicts: 0,
      },
    };
  }

  /** Fixes people made on the data, still in force, newest first, with who made them. */
  async listCorrections(userId: string, modelId: string) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const listed = await this.runtime.listCorrections(model.id, userId);
    const names = await this.correctorNames(model.id, userId, listed.corrections.map((correction) => correction.actorUserId));
    return {
      corrections: [...listed.corrections].reverse().map((correction) => {
        const who = correction.actorUserId ? names.get(correction.actorUserId) : undefined;
        return {
          sequence: correction.sequence,
          action: correction.action,
          targetIdentity: correction.targetIdentity,
          payload: correction.payload,
          reason: correction.reason,
          createdAt: correction.createdAt,
          correctedBy: who?.name ?? '',
          correctedByYou: who?.self ?? false,
        };
      }),
    };
  }

  /**
   * Records a fix on the data (value, hidden record or link, added link) and rebuilds the draft so it
   * shows at once. The fix is replayed on every later rebuild, so new source data never undoes it.
   */
  async recordCorrection(userId: string, modelId: string, input: RecordCorrectionDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const target = input.targetIdentity ?? {};
    const text = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 300;
    const valid = input.action === 'edit_entity' || input.action === 'remove_entity'
      ? text(target.entityId)
      : text(target.relationId) && text(target.sourceEntityId) && text(target.targetEntityId);
    if (!valid || (input.action === 'edit_entity' && !text(input.payload?.attribute))) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'This fix does not point to a record or link');
    }
    const { correctionSequence } = await this.runtime.listCorrections(model.id, userId);
    const recorded = await this.runtime.recordCorrection({
      actorUserId: userId,
      modelId: model.id,
      modelVersionId: model.currentDraftVersionId,
      action: input.action,
      targetIdentity: target,
      payload: input.action === 'edit_entity'
        ? { attribute: input.payload?.attribute, value: input.payload?.value ?? null }
        : {},
      reason: input.reason ?? '',
      expectedCorrectionSequence: correctionSequence,
    });
    return { sequence: recorded.sequence, rebuild: await this.rebuildAfterCorrection(userId, model.id) };
  }

  /** Undoing is itself recorded, so the history stays complete and rebuilds replay the same result. */
  async undoCorrection(userId: string, modelId: string, sequence: number) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const listed = await this.runtime.listCorrections(model.id, userId);
    const correction = listed.corrections.find((candidate) => candidate.sequence === sequence);
    if (!correction) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'This fix no longer exists');
    const recorded = await this.runtime.recordCorrection({
      actorUserId: userId,
      modelId: model.id,
      modelVersionId: model.currentDraftVersionId,
      action: 'revert',
      targetIdentity: correction.targetIdentity,
      payload: { sequence },
      expectedCorrectionSequence: listed.correctionSequence,
    });
    return { sequence: recorded.sequence, rebuild: await this.rebuildAfterCorrection(userId, model.id) };
  }

  private async rebuildAfterCorrection(userId: string, modelId: string) {
    try {
      const accepted = await this.requestRefresh(userId, modelId, { purpose: 'refresh', scope: { kind: 'model' } });
      return { jobId: String(accepted.jobId), status: String(accepted.status) };
    } catch (error) {
      // The fix is kept; it applies on the next successful build.
      this.logger.warn(`Rebuild after a data fix was not started: ${(error as Error).message}`);
      return null;
    }
  }

  /** Display names of the people behind corrections; the viewer is flagged so the UI can say "you". */
  private async correctorNames(modelId: string, viewerId: string, userIds: Array<string | null | undefined>) {
    const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
    const names = new Map<string, { name: string; self: boolean }>();
    if (!ids.length) return names;
    const rows = await this.database.query<{ userId: string; email: string | null; firstName: string | null; lastName: string | null }>(
      `SELECT user_id AS "userId", email, first_name AS "firstName", last_name AS "lastName"
       FROM semantic_model.memberships WHERE model_id=$1 AND user_id = ANY($2::text[])`,
      [modelId, ids],
    ).then((result) => result.rows).catch(() => []);
    for (const id of ids) {
      const row = rows.find((candidate) => candidate.userId === id);
      const name = [row?.firstName, row?.lastName].filter(Boolean).join(' ') || row?.email || '';
      names.set(id, { name, self: id === viewerId });
    }
    return names;
  }

  private withCorrection<T extends object>(provenance: T, origin: RuntimeValueOrigin,
    correctors: Map<string, { name: string; self: boolean }>) {
    if (origin.kind !== 'human' || origin.correctionSequence == null) return provenance;
    const who = origin.correctedBy ? correctors.get(origin.correctedBy) : undefined;
    return {
      ...provenance,
      correction: {
        sequence: origin.correctionSequence,
        correctedBy: who?.name ?? '',
        correctedByYou: who?.self ?? false,
        originalValue: origin.originalValue ?? null,
      },
    };
  }

  /** Files behind record values; typed-by-hand values (manual snapshot) have no file. */
  private async recordSources(modelId: string, origins: RuntimeValueOrigin[]) {
    const assetIds = [...new Set(origins.map((origin) => origin.assetId)
      .filter((assetId): assetId is string => typeof assetId === 'string' && !assetId.startsWith('manual:')))];
    const sources = new Map<string, RecordSource>();
    if (!assetIds.length) return sources;
    const mappings = await this.database.query<Pick<MappingRow, 'id' | 'workspaceId' | 'documentId' | 'sheetName' | 'assetKind'>>(
      `SELECT id, workspace_id AS "workspaceId", document_id AS "documentId", sheet_name AS "sheetName",
              asset_kind AS "assetKind"
       FROM semantic_model.source_mappings WHERE model_id=$1 AND document_id = ANY($2::text[])
       ORDER BY id`,
      [modelId, assetIds],
    );
    for (const mapping of mappings.rows) {
      if (sources.has(mapping.documentId)) continue;
      const document = await this.documents.findById(mapping.workspaceId, mapping.documentId).catch(() => null);
      sources.set(mapping.documentId, {
        mappingId: mapping.id,
        workspaceId: mapping.workspaceId,
        documentId: mapping.documentId,
        documentName: document?.originalName ?? '',
        mimeType: document?.mimeType,
        sheetName: mapping.assetKind === 'excel_sheet' ? mapping.sheetName || undefined : undefined,
        kind: mapping.assetKind,
      });
    }
    return sources;
  }

  private valueProvenance(origin: RuntimeValueOrigin, sources: Map<string, RecordSource>) {
    const manual = typeof origin.assetId === 'string' && origin.assetId.startsWith('manual:');
    const source = origin.assetId && !manual ? sources.get(origin.assetId) : undefined;
    if (manual || !source) return { mappingId: '', source: { kind: 'manual' as const, documentName: '' } };
    const method = origin.kind === 'metadata' ? 'document_metadata' as const
      : origin.kind === 'ai' ? 'semantic_extraction' as const
        : origin.kind === 'human' ? 'fixed_value' as const : 'direct_mapping' as const;
    return {
      mappingId: source.mappingId,
      source: {
        kind: source.kind,
        workspaceId: source.workspaceId,
        documentId: source.documentId,
        documentName: source.documentName,
        mimeType: source.mimeType,
        sheetName: origin.sheet ?? source.sheetName,
      },
      ...(typeof origin.rowNumber === 'number' ? { rowNumber: origin.rowNumber } : {}),
      field: {
        method,
        ...(origin.column && method === 'direct_mapping' ? { reference: origin.column } : {}),
        ...(origin.pageNumber != null ? { page: String(origin.pageNumber) } : {}),
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
        'SELECT id, key, label, aliases, attributes FROM semantic_model.node_types WHERE version_id=$1',
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
    const manual = scope.kind === 'model'
      ? await this.manualSource(model.id, model.currentDraftVersionId, homeWorkspaceId, nodes)
      : null;
    if (manual) sources.push(...manual.sources);
    if (!sources.length) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'No usable source in the selected scope');
    }
    const scopedConceptIds = new Set(usableMappings.map((mapping) => mapping.conceptId));
    const manualOnly = new Set((manual?.sources ?? []).map((source) => source.conceptId).filter((id) => !scopedConceptIds.has(id)));
    const concepts = nodes
      .filter((node) => scopedConceptIds.has(node.id) || manualOnly.has(node.id))
      .map((node) => this.conceptSpec(node, identityRules.get(node.id) ?? [], manualOnly.has(node.id)));
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
      ).values(), ...(manual ? [{ workspaceId: homeWorkspaceId, assetId: manual.assetId }] : [])],
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
    // The AI agent's effective model is part of revision identity, so an admin
    // changing it produces a new revision instead of reusing persisted rows.
    const aiExtraction = await this.aiExtractionIdentity(runtimeSources);
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
      aiExtraction,
      populationEngineVersion: POPULATION_ENGINE_VERSION,
    });
    // A new data fix must rebuild even when every source is unchanged.
    const correctionSequence = scope.kind === 'model' && typeof this.runtime.listCorrections === 'function'
      ? await this.runtime.listCorrections(model.id, userId).then((listed) => listed.correctionSequence).catch(() => 0)
      : 0;
    const idempotencyKey = createHash('sha256')
      .update(JSON.stringify({
        ...(correctionSequence ? { correctionSequence } : {}),
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
        aiExtraction,
      },
    }, idempotencyKey);
    return { ...accepted, skipped };
  }

  private conceptSpec(node: NodeTypeRow, identityFields: string[], manualOnly = false): ConceptSpec {
    const knownKeys = new Set((node.attributes ?? []).map((attribute) => attribute.key));
    const keyComponents = identityFields.filter((field) => knownKeys.has(field));
    // Records typed by hand need no key: the runtime falls back to each record's own id.
    if (!keyComponents.length && manualOnly && node.attributes?.length) keyComponents.push(node.attributes[0].key);
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
      ...this.conceptAliases(node),
    };
  }

  /** Synonyms go into the spec only when present, so a model without any keeps its specification hash. */
  private conceptAliases(node: NodeTypeRow): Pick<ConceptSpec, 'aliases' | 'fieldAliases'> {
    const clean = (values: string[] | undefined) => [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
    const aliases = clean(node.aliases);
    const fieldAliases = Object.fromEntries((node.attributes ?? [])
      .map((attribute) => [attribute.key, clean(attribute.aliases)] as const)
      .filter(([, values]) => values.length));
    return {
      ...(aliases.length ? { aliases } : {}),
      ...(Object.keys(fieldAliases).length ? { fieldAliases } : {}),
    };
  }

  /**
   * Records entered by hand on the draft (including records migrated from the legacy pipeline) as one
   * immutable runtime snapshot. The snapshot id hashes its content, so unchanged records reuse it.
   */
  private async manualSource(modelId: string, versionId: string, workspaceId: string, nodes: NodeTypeRow[]) {
    const withFields = new Map(nodes.filter((node) => node.attributes?.length).map((node) => [node.id, node]));
    const [records, recordRelations] = await Promise.all([
      this.database.query<{ id: string; nodeTypeId: string; label: string; values: Record<string, unknown> }>(
        `SELECT id, node_type_id AS "nodeTypeId", label, values FROM semantic_model.records
         WHERE model_id=$1 AND version_id=$2 AND status='active' ORDER BY id`,
        [modelId, versionId],
      ).then((result) => result.rows.filter((row) => withFields.has(row.nodeTypeId))),
      this.database.query<{ relationTypeId: string; sourceRecordId: string; targetRecordId: string }>(
        `SELECT relation_type_id AS "relationTypeId", source_record_id AS "sourceRecordId", target_record_id AS "targetRecordId"
         FROM semantic_model.record_relations WHERE model_id=$1 AND version_id=$2
         ORDER BY relation_type_id, source_record_id, target_record_id`,
        [modelId, versionId],
      ).then((result) => result.rows),
    ]);
    if (!records.length) return null;
    const known = new Set(records.map((record) => record.id));
    const rows = records.map((record) => ({
      conceptId: record.nodeTypeId,
      rowKey: record.id,
      label: record.label ?? '',
      values: Object.fromEntries(Object.entries(record.values ?? {}).filter(([key]) => !key.startsWith('_'))),
    }));
    const links = recordRelations
      .filter((link) => known.has(link.sourceRecordId) && known.has(link.targetRecordId))
      .map((link) => ({ relationId: link.relationTypeId, sourceRowKey: link.sourceRecordId, targetRowKey: link.targetRecordId }));
    const snapshotId = `m${this.specifications.hashCanonical({ modelId, rows, links }).replace(/^sha256:/, '').slice(0, 40)}`;
    for (let index = 0; index < Math.max(rows.length, links.length); index += MANUAL_BATCH_SIZE) {
      await this.runtime.appendManualRows(modelId, snapshotId, {
        rows: rows.slice(index, index + MANUAL_BATCH_SIZE),
        links: links.slice(index, index + MANUAL_BATCH_SIZE),
      });
    }
    await this.runtime.commitManualSnapshot(modelId, snapshotId, { rowCount: rows.length, linkCount: links.length });
    const assetId = `manual:${snapshotId}`;
    const sources = [...new Set(rows.map((row) => row.conceptId))].map((conceptId) => {
      const keys = withFields.get(conceptId)!.attributes.map((attribute) => attribute.key);
      return {
        sourceKind: 'manual' as const,
        conceptId,
        source: { workspaceId, assetId, snapshotId },
        options: {},
        columnMapping: Object.fromEntries(keys.map((key) => [key, key])),
        mappingVersion: snapshotId,
      };
    });
    return { assetId, sources };
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
