import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import { ConflictException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { CreateSemanticModelDto, SemanticModelQueryDto, UpdateSemanticModelDto } from '../dto';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticGraphRepository } from '../repositories/semantic-graph.repository';
import { SemanticModelRepository, SemanticModelRow } from '../repositories/semantic-model.repository';
import { SemanticRealtimeSignalService } from './semantic-realtime-signal.service';
import { RuntimeCloneDataCommand, SemanticRuntimeClientService } from './semantic-runtime-client.service';

interface CloneIdMaps {
  nodeIds: Map<string, string>;
  relationIds: Map<string, string>;
  recordIds: Map<string, string>;
  recordRelationIds: Map<string, string>;
  mappingIds: Map<string, string>;
  /** Every id above plus the model and version ids, for ids embedded in text and JSON. */
  all: Map<string, string>;
}

type CloneRow = Record<string, unknown>;

export interface CloneInclude {
  sources?: boolean;
  data?: boolean;
  shares?: boolean;
}

export type SemanticModelCloneResult = SemanticModelRow & {
  dataCopy: { status: 'copied' | 'skipped' | 'failed'; reason?: string; records?: number; links?: number };
};

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Rewrite every mapped id found anywhere in a string or JSON value (keys and values); other ids stay. */
export function remapCloneIds<T>(value: T, ids: Map<string, string>): T {
  if (value === null || value === undefined) return value;
  const swap = (text: string) => text.replace(UUID_PATTERN, (id) => ids.get(id) ?? ids.get(id.toLowerCase()) ?? id);
  if (typeof value === 'string') return swap(value) as T;
  if (value instanceof Date) return value;
  return JSON.parse(swap(JSON.stringify(value))) as T;
}

function withoutTimestamps(row: CloneRow): CloneRow {
  return Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'created_at' && column !== 'updated_at'));
}

/** Insert one copied row; objects and arrays go in as JSON. */
async function insertCloneRow(client: PoolClient, table: string, row: CloneRow): Promise<void> {
  const columns = Object.keys(row);
  const values = columns.map((column) => {
    const value = row[column];
    return value !== null && typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value;
  });
  await client.query(
    `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(',')}) VALUES (${columns.map((_, index) => `$${String(index + 1)}`).join(',')})`,
    values);
}

interface SemanticBindingRow {
  targetKind: 'model' | 'node_type' | 'relation_type' | 'record';
  targetId: string | null;
  resourceKind: 'workspace' | 'document';
  workspaceId: string;
  documentId: string | null;
  inclusionMode: 'dynamic' | 'explicit';
  retrievalMode: 'broad' | 'targeted' | 'evidence_only';
  priority: number;
  enabled: boolean;
  protected: boolean;
  availability: 'available' | 'indexing' | 'unavailable';
}

@Injectable()
export class SemanticModelService {
  private readonly logger = new Logger(SemanticModelService.name);

  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelRepository,
    private readonly graph: SemanticGraphRepository,
    private readonly workspaces: WorkspaceService,
    private readonly realtimeSignals: SemanticRealtimeSignalService,
    private readonly runtime: SemanticRuntimeClientService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  list(userId: string, query: SemanticModelQueryDto) {
    return this.models.listForUser(userId, query);
  }

  async get(userId: string, modelId: string): Promise<SemanticModelRow & { role: string }> {
    const model = await this.models.findAccessible(userId, modelId);
    if (!model) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND);
    return model;
  }

  /**
   * Resolve a semantic model for chat. Chat reads only the published data of a model, so the model
   * must be bound to a published runtime graph; an unpublished model is refused here rather than
   * answering from nothing.
   */
  async resolveChatModel(userId: string, modelId: string): Promise<{ id: string; name: string }> {
    const model = await this.get(userId, modelId);
    if (model.status === 'archived') throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND);
    try {
      await this.runtime.getPublishedBinding(model.id, userId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new ConflictException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE, 'Publish this semantic model to use it in chat');
      }
      throw error;
    }
    return { id: model.id, name: model.name };
  }

  async create(userId: string, dto: CreateSemanticModelDto): Promise<SemanticModelRow> {
    const workspaceIds = [...new Set(dto.workspaceIds ?? [])];
    await this.assertOwnedWorkspaces(userId, workspaceIds);
    try {
      return await this.database.transaction((client) => this.models.create(client, {
        ownerUserId: userId,
        name: dto.name.trim(),
        description: dto.description?.trim() ?? '',
        kind: 'designed',
        nameManagedBySystem: false,
        workspaceIds,
      }));
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NAME_EXISTS);
      throw error;
    }
  }

  async ensureWorkspaceDefault(userId: string, workspaceId: string): Promise<SemanticModelRow> {
    const existing = await this.models.findByOriginWorkspace(workspaceId, userId);
    if (existing) return existing;
    const workspace = await this.workspaces.findById(workspaceId);
    if (workspace.createdBy !== userId) throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_ACCESS_DENIED);
    try {
      return await this.database.transaction(async (client) => {
        const model = await this.models.create(client, {
          ownerUserId: userId,
          name: `${workspace.name} model`,
          description: `Automatic business model for ${workspace.name}`,
          kind: 'workspace_default',
          originWorkspaceId: workspaceId,
          nameManagedBySystem: true,
          workspaceIds: [workspaceId],
        });
        const documentsNodeId = randomUUID();
        await this.graph.apply(client, model.id, model.currentDraftVersionId!, {
          type: 'node_type.create',
          entity: {
            id: documentsNodeId,
            key: 'documents',
            label: 'Documents',
            description: 'All documents currently available in the origin workspace.',
            category: 'system_collection',
            recordPolicy: 'none',
            systemKey: 'workspace_documents',
            aliases: [],
            attributes: [],
            position: { x: 80, y: 160 },
          },
        });
        await client.query(
          `INSERT INTO semantic_model.knowledge_bindings
           (model_id,target_kind,target_id,resource_kind,workspace_id,inclusion_mode,retrieval_mode,protected,created_by)
           VALUES ($1,'node_type',$2,'workspace',$3,'dynamic','broad',true,$4)`,
          [model.id, documentsNodeId, workspaceId, userId],
        );
        await this.audit(client, model.id, model.currentDraftVersionId, userId, 'model.provisioned', { workspaceId });
        return model;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const raced = await this.models.findByOriginWorkspace(workspaceId, userId);
        if (raced) return raced;
      }
      throw error;
    }
  }

  async update(userId: string, modelId: string, dto: UpdateSemanticModelDto): Promise<SemanticModelRow> {
    await this.requireActiveRole(userId, modelId, ['owner', 'editor']);
    try {
      return await this.database.transaction(async (client) => {
        const model = await this.models.update(client, modelId, dto.expectedRevision, dto);
        if (!model) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT);
        await this.audit(client, modelId, model.currentDraftVersionId, userId, 'model.updated', {});
        return model;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NAME_EXISTS);
      throw error;
    }
  }

  async archive(userId: string, modelId: string, expectedRevision: number): Promise<void> {
    const model = await this.requireActiveRole(userId, modelId, ['owner']);
    await this.database.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[modelId]);
      const result = await client.query(
        `UPDATE semantic_model.models SET status='archived', archived_at=now(), revision=revision+1, updated_at=now()
         WHERE id=$1 AND revision=$2`, [model.id, expectedRevision]);
      if (!result.rowCount) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT);
      await this.audit(client, modelId, model.currentDraftVersionId, userId, 'model.archived', {});
    });
  }

  /**
   * Delete a model for good: its runtime data first, then every row of it here, in one transaction.
   *
   * Order: the runtime purge is idempotent and refuses (409) while a build or index job of the model
   * runs, so it goes first; nothing is deleted here unless it succeeded. Should the deletion here then
   * fail, the model stays with no data and can simply be deleted again; the reverse order would
   * leave runtime rows no model points to any more. Workspace documents are never touched.
   */
  async deletePermanently(userId: string, modelId: string): Promise<void> {
    const model = await this.requireRole(userId, modelId, ['owner']);
    await this.runtime.deleteModel(model.id, userId);
    await this.database.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [model.id]);
      // Rows that point at concepts and relations without cascading go first; every other table
      // keyed by the model (versions, links, bindings, mappings, shares, review, history, grants…)
      // cascades from the model row.
      await client.query('DELETE FROM semantic_model.record_relations WHERE model_id=$1', [model.id]);
      await client.query('DELETE FROM semantic_model.records WHERE model_id=$1', [model.id]);
      await client.query('DELETE FROM semantic_model.relation_types WHERE model_id=$1', [model.id]);
      await client.query('DELETE FROM semantic_model.node_types WHERE model_id=$1', [model.id]);
      await client.query('DELETE FROM semantic_model.models WHERE id=$1', [model.id]);
    });
    this.logger.log(`Semantic model ${model.id} deleted permanently by ${userId}`);
  }

  /**
   * Copy a model into a new draft owned by the caller.
   *
   * Always copied: the structure (concepts, fields, relations, identity rules, canvas positions).
   * `include.sources`: workspace links, knowledge bindings, source mappings, derived sources,
   * relation/source resolution rules, mapping presets and hand-typed records.
   * `include.data` (forces sources): the source's draft data revision, copied by the runtime.
   * `include.shares` (source owner only): the other members, the source owner becoming an editor.
   * Never copied: history, assistant change sets, read grants, published versions, runs.
   *
   * Ordering: the back rows are written first in one transaction, then the runtime copies the data.
   * A running job of the source (409) undoes the clone and is reported, so the user simply retries;
   * any other runtime failure keeps the clone (structure + sources) and says the data was not
   * copied: a build of the clone gives it data again.
   */
  async clone(userId: string, modelId: string, name: string, include: CloneInclude = {}): Promise<SemanticModelCloneResult> {
    const options = { sources: include.sources ?? true, data: include.data ?? false, shares: include.shares ?? false };
    if (options.data) options.sources = true;
    const source = await this.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    if (options.shares && source.role !== 'owner') {
      throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_ACCESS_DENIED, 'Only the owner can copy who the model is shared with');
    }
    const versionId = source.currentDraftVersionId ?? source.currentPublishedVersionId;
    if (!versionId) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const revisionResult = await this.database.query<{ revision: number }>('SELECT revision::int FROM semantic_model.versions WHERE id=$1', [versionId]);
    const sourceGraph = await this.graph.getGraph(source.id, versionId, revisionResult.rows[0]?.revision ?? 0);
    const ids = this.createCloneIdMaps(sourceGraph);
    let clone: SemanticModelRow;
    try {
      clone = await this.database.transaction(async (client) => {
        const target = await this.createCloneModel(client, userId, name, source.description, []);
        ids.all.set(source.id, target.id);
        ids.all.set(versionId, target.currentDraftVersionId!);
        await this.copyCloneGraph(client, target.id, target.currentDraftVersionId!, sourceGraph, ids, options.sources);
        await this.copyCloneStructure(client, source.id, target.id, userId, ids, options.sources);
        if (options.sources) await this.copyCloneSources(client, source.id, target.id, userId, ids);
        if (options.shares) await this.copyCloneShares(client, source.id, target.id, userId);
        await this.audit(client, target.id, target.currentDraftVersionId, userId, 'model.cloned', {
          sourceModelId: source.id,
          sourceVersionId: versionId,
          include: options,
        });
        return target;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NAME_EXISTS);
      throw error;
    }
    if (!options.data) return { ...clone, dataCopy: { status: 'skipped' } };
    try {
      const planned = await this.plannedCloneData(userId, source.id, clone.id);
      const copied = await this.runtime.cloneModelData(source.id, {
        targetModelId: clone.id,
        targetModelVersionId: clone.currentDraftVersionId!,
        ...planned,
        idMap: {
          concepts: Object.fromEntries(ids.nodeIds),
          relations: Object.fromEntries(ids.relationIds),
          mappings: Object.fromEntries(ids.mappingIds),
        },
      }, userId);
      if (!copied) return { ...clone, dataCopy: { status: 'skipped', reason: 'runtime_disabled' } };
      if (!copied.copied) return { ...clone, dataCopy: { status: 'skipped', reason: copied.reason ?? 'no_data' } };
      return { ...clone, dataCopy: { status: 'copied', records: copied.counts?.entities ?? 0, links: copied.counts?.relationships ?? 0 } };
    } catch (error) {
      if ((error as { status?: number }).status === 409) {
        await this.deletePermanently(userId, clone.id).catch((cleanup: unknown) => {
          this.logger.error(`Could not undo clone ${clone.id} after a refused data copy: ${(cleanup as Error).message}`);
        });
        throw error;
      }
      this.logger.warn(`Clone ${clone.id} of ${source.id} kept without data: ${(error as Error).message}`);
      return { ...clone, dataCopy: { status: 'failed', reason: 'runtime_copy_failed' } };
    }
  }

  /**
   * When the source's data is current, what a build of the clone would run with: the copied revision
   * is stamped with it so the clone reads as current too (and can be published without a rebuild).
   * Otherwise nothing, and the runtime keeps the source's own specification, remapped.
   */
  private async plannedCloneData(userId: string, sourceId: string, targetId: string): Promise<Partial<RuntimeCloneDataCommand>> {
    if (!this.moduleRef) return {};
    try {
      // Loaded here: the refresh service depends on this one, a top-level import would be circular.
      const { SemanticPopulationRefreshService } = await import('./semantic-population-refresh.service');
      const population = this.moduleRef.get(SemanticPopulationRefreshService, { strict: false });
      if ((await population.freshness(userId, sourceId)).state !== 'current') return {};
      return await population.plannedExecution(userId, targetId);
    } catch (error) {
      this.logger.warn(`Clone ${targetId}: build plan unavailable (${(error as Error).message}); its data will read as outdated`);
      return {};
    }
  }

  /** Counts shown next to the clone options: source links, built records, people the model is shared with. */
  async clonePreview(userId: string, modelId: string): Promise<{ sources: number; records: number | null; people: number }> {
    const model = await this.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const counts = await this.database.query<{ sources: number; people: number }>(
      `SELECT (SELECT COUNT(*)::int FROM semantic_model.source_mappings WHERE model_id=$1)
            + (SELECT COUNT(*)::int FROM semantic_model.derived_sources WHERE model_id=$1) AS sources,
              (SELECT COUNT(*)::int FROM semantic_model.memberships WHERE model_id=$1 AND user_id<>$2) AS people`,
      [model.id, userId]);
    let records: number | null = null;
    try {
      records = (await this.runtime.getDataSummary(model.id, userId)).draft?.records ?? 0;
    } catch {
      records = null;
    }
    return { sources: counts.rows[0]?.sources ?? 0, records, people: counts.rows[0]?.people ?? 0 };
  }

  private createCloneIdMaps(graph: Awaited<ReturnType<SemanticGraphRepository['getGraph']>>): CloneIdMaps {
    const ids: CloneIdMaps = {
      nodeIds: new Map(graph.nodes.map((node) => [node.id, randomUUID()])),
      relationIds: new Map(graph.relations.map((relation) => [relation.id, randomUUID()])),
      recordIds: new Map(graph.records.map((record) => [record.id, randomUUID()])),
      recordRelationIds: new Map(graph.recordRelations.map((relation) => [relation.id, randomUUID()])),
      mappingIds: new Map(),
      all: new Map(),
    };
    for (const map of [ids.nodeIds, ids.relationIds, ids.recordIds, ids.recordRelationIds]) {
      for (const [from, to] of map) ids.all.set(from, to);
    }
    return ids;
  }

  private async createCloneModel(client: PoolClient, userId: string, name: string, description: string, workspaceIds: string[]): Promise<SemanticModelRow> {
    return this.models.create(client, {
      ownerUserId: userId,
      name: name.trim(),
      description,
      kind: 'designed',
      nameManagedBySystem: false,
      workspaceIds: [...new Set(workspaceIds)],
    });
  }

  private async copyCloneGraph(client: PoolClient, modelId: string, versionId: string, source: Awaited<ReturnType<SemanticGraphRepository['getGraph']>>, ids: CloneIdMaps, withRecords: boolean): Promise<void> {
    for (const node of source.nodes) {
      await this.graph.apply(client, modelId, versionId, { type: 'node_type.create', entity: { ...remapCloneIds(node, ids.all), id: ids.nodeIds.get(node.id)! } });
    }
    for (const relation of source.relations) {
      await this.graph.apply(client, modelId, versionId, {
        type: 'relation_type.create',
        entity: { ...remapCloneIds(relation, ids.all), id: ids.relationIds.get(relation.id)!, sourceNodeTypeId: ids.nodeIds.get(relation.sourceNodeTypeId)!, targetNodeTypeId: ids.nodeIds.get(relation.targetNodeTypeId)! },
      });
    }
    // Hand-typed records are an input of the build (a "typed" source), so they travel with the sources.
    if (!withRecords) return;
    for (const record of source.records) {
      await this.graph.apply(client, modelId, versionId, {
        type: 'record.create',
        entity: { ...record, id: ids.recordIds.get(record.id)!, nodeTypeId: ids.nodeIds.get(record.nodeTypeId)!, values: this.remapRecordValues(record.id, record.values, ids) },
      });
    }
    for (const relation of source.recordRelations) {
      await this.graph.apply(client, modelId, versionId, {
        type: 'record_relation.create',
        entity: { ...relation, id: ids.recordRelationIds.get(relation.id)!, relationTypeId: ids.relationIds.get(relation.relationTypeId)!, sourceRecordId: ids.recordIds.get(relation.sourceRecordId)!, targetRecordId: ids.recordIds.get(relation.targetRecordId)! },
      });
    }
  }

  /** Identity rules and canvas positions; source boxes on the canvas only when the sources come along. */
  private async copyCloneStructure(client: PoolClient, sourceId: string, targetId: string, userId: string, ids: CloneIdMaps, withSources: boolean): Promise<void> {
    const rules = await client.query<{ conceptId: string; fields: unknown }>(
      'SELECT concept_id AS "conceptId", fields FROM semantic_model.identity_rules WHERE model_id=$1', [sourceId]);
    for (const rule of rules.rows) {
      const conceptId = ids.nodeIds.get(rule.conceptId);
      if (!conceptId) continue;
      await client.query(
        'INSERT INTO semantic_model.identity_rules (model_id, concept_id, fields, updated_by) VALUES ($1,$2,$3::jsonb,$4)',
        [targetId, conceptId, JSON.stringify(rule.fields ?? []), userId]);
    }
    const positions = await client.query<{ elementId: string; x: number; y: number }>(
      'SELECT element_id AS "elementId", x, y FROM semantic_model.canvas_positions WHERE model_id=$1', [sourceId]);
    for (const position of positions.rows) {
      if (!withSources && (position.elementId.startsWith('source:') || position.elementId.startsWith('typed:'))) continue;
      await client.query(
        'INSERT INTO semantic_model.canvas_positions (model_id, element_id, x, y) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [targetId, remapCloneIds(position.elementId, ids.all), position.x, position.y]);
    }
  }

  private async copyCloneSources(client: PoolClient, sourceId: string, targetId: string, userId: string, ids: CloneIdMaps): Promise<void> {
    const links = await client.query<{ workspaceId: string; role: string; enabled: boolean }>(
      'SELECT workspace_id AS "workspaceId", role, enabled FROM semantic_model.workspace_links WHERE model_id=$1', [sourceId]);
    for (const link of links.rows) {
      await client.query(
        `INSERT INTO semantic_model.workspace_links (model_id, workspace_id, role, enabled, created_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (model_id, workspace_id) DO NOTHING`, [targetId, link.workspaceId, link.role, link.enabled, userId]);
    }
    const bindings = await client.query<SemanticBindingRow>(
      `SELECT target_kind AS "targetKind", target_id AS "targetId", resource_kind AS "resourceKind",
              workspace_id AS "workspaceId", document_id AS "documentId", inclusion_mode AS "inclusionMode",
              retrieval_mode AS "retrievalMode", priority, enabled, protected, availability
       FROM semantic_model.knowledge_bindings WHERE model_id=$1`, [sourceId]);
    await this.copyCloneBindings(client, targetId, userId, bindings.rows, ids);

    const mappings = await client.query<CloneRow & { id: string; concept_id: string }>(
      'SELECT * FROM semantic_model.source_mappings WHERE model_id=$1 ORDER BY created_at', [sourceId]);
    for (const row of mappings.rows) ids.mappingIds.set(row.id, randomUUID());
    for (const [from, to] of ids.mappingIds) ids.all.set(from, to);
    for (const row of mappings.rows) {
      const conceptId = ids.nodeIds.get(row.concept_id);
      if (!conceptId) continue;
      await insertCloneRow(client, 'semantic_model.source_mappings', {
        ...remapCloneIds(withoutTimestamps(row), ids.all),
        id: ids.mappingIds.get(row.id), model_id: targetId, concept_id: conceptId, created_by: userId,
      });
    }
    const derived = await client.query<CloneRow & { concept_id: string; source_concept_id: string }>(
      'SELECT * FROM semantic_model.derived_sources WHERE model_id=$1', [sourceId]);
    for (const row of derived.rows) {
      const conceptId = ids.nodeIds.get(row.concept_id);
      const sourceConceptId = ids.nodeIds.get(row.source_concept_id);
      if (!conceptId || !sourceConceptId) continue;
      await insertCloneRow(client, 'semantic_model.derived_sources', {
        ...remapCloneIds(withoutTimestamps(row), ids.all),
        id: randomUUID(), model_id: targetId, concept_id: conceptId, source_concept_id: sourceConceptId, created_by: userId,
      });
    }
    const relationRules = await client.query<CloneRow & { relation_id: string }>(
      'SELECT * FROM semantic_model.relation_resolution_rules WHERE model_id=$1', [sourceId]);
    for (const row of relationRules.rows) {
      const relationId = ids.relationIds.get(row.relation_id);
      if (!relationId) continue;
      await insertCloneRow(client, 'semantic_model.relation_resolution_rules', {
        ...withoutTimestamps(row), id: randomUUID(), model_id: targetId, relation_id: relationId, updated_by: userId,
      });
    }
    const policies = await client.query<CloneRow & { concept_id: string; priorities: unknown }>(
      'SELECT * FROM semantic_model.source_resolution_policies WHERE model_id=$1', [sourceId]);
    for (const row of policies.rows) {
      const conceptId = ids.nodeIds.get(row.concept_id);
      if (!conceptId) continue;
      // A priority naming a mapping that is gone has nothing to point at in the clone.
      const priorities = Array.isArray(row.priorities)
        ? (row.priorities as { mappingId?: string }[])
          .filter((item) => !item.mappingId || ids.mappingIds.has(item.mappingId))
          .map((item) => remapCloneIds(item, ids.all))
        : [];
      await insertCloneRow(client, 'semantic_model.source_resolution_policies', {
        ...withoutTimestamps(row), model_id: targetId, concept_id: conceptId, priorities, updated_by: userId,
      });
    }
    const presets = await client.query<CloneRow & { concept_id: string | null }>(
      'SELECT * FROM semantic_model.mapping_presets WHERE model_id=$1', [sourceId]);
    for (const row of presets.rows) {
      const conceptId = row.concept_id ? ids.nodeIds.get(row.concept_id) : null;
      if (row.concept_id && !conceptId) continue;
      await insertCloneRow(client, 'semantic_model.mapping_presets', {
        ...remapCloneIds(withoutTimestamps(row), ids.all),
        id: randomUUID(), model_id: targetId, concept_id: conceptId, created_by: userId, updated_by: userId,
      });
    }
  }

  /** Every other member keeps their role; the caller owns the clone and the source owner becomes an editor. */
  private async copyCloneShares(client: PoolClient, sourceId: string, targetId: string, userId: string): Promise<void> {
    await client.query(
      `INSERT INTO semantic_model.memberships (model_id, user_id, role, email, first_name, last_name)
       SELECT $2, user_id, CASE WHEN role='owner' THEN 'editor' ELSE role END, email, first_name, last_name
       FROM semantic_model.memberships WHERE model_id=$1 AND user_id<>$3
       ON CONFLICT (model_id, user_id) DO NOTHING`, [sourceId, targetId, userId]);
  }

  private async copyCloneBindings(client: PoolClient, modelId: string, createdBy: string, bindings: SemanticBindingRow[], ids: CloneIdMaps): Promise<void> {
    for (const binding of bindings) {
      const targetId = binding.targetKind === 'node_type' ? ids.nodeIds.get(binding.targetId ?? '')
        : binding.targetKind === 'relation_type' ? ids.relationIds.get(binding.targetId ?? '')
          : binding.targetKind === 'record' ? ids.recordIds.get(binding.targetId ?? '') : null;
      if (binding.targetKind !== 'model' && !targetId) {
        throw new ConflictException(ErrorCode.SEMANTIC_MODEL_BINDING_INVALID, 'The source contains an invalid knowledge binding');
      }
      await client.query(
        `INSERT INTO semantic_model.knowledge_bindings
         (model_id,target_kind,target_id,resource_kind,workspace_id,document_id,inclusion_mode,retrieval_mode,priority,enabled,protected,availability,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [modelId, binding.targetKind, targetId, binding.resourceKind, binding.workspaceId, binding.documentId,
          binding.inclusionMode, binding.retrievalMode, binding.priority, binding.enabled, binding.protected, binding.availability, createdBy],
      );
    }
  }

  private remapRecordValues(recordId: string, values: Record<string, unknown>, ids: CloneIdMaps): Record<string, unknown> {
    if (values['_entity_key'] !== recordId) return { ...values };
    return { ...values, _entity_key: ids.recordIds.get(recordId)! };
  }

  async overview(userId: string, modelId: string): Promise<Record<string, unknown>> {
    const model = await this.get(userId, modelId);
    const result = await this.database.query<Record<string, number>>(
      `SELECT
       (SELECT COUNT(*)::int FROM semantic_model.workspace_links WHERE model_id=$1 AND enabled) AS "workspaceCount",
       (SELECT COUNT(*)::int FROM semantic_model.node_types WHERE version_id=$2) AS "nodeCount",
       (SELECT COUNT(*)::int FROM semantic_model.relation_types WHERE version_id=$2) AS "relationCount",
       (SELECT COUNT(*)::int FROM semantic_model.records WHERE version_id=$2) AS "recordCount",
       (SELECT COUNT(*)::int FROM semantic_model.knowledge_bindings WHERE model_id=$1 AND enabled) AS "bindingCount",
       (SELECT COUNT(*)::int FROM semantic_model.knowledge_bindings WHERE model_id=$1 AND enabled AND availability='unavailable') AS "brokenBindingCount"`,
      [model.id, model.currentDraftVersionId],
    );
    return { ...model, ...result.rows[0] };
  }

  async requireRole(userId: string, modelId: string, roles: string[]): Promise<SemanticModelRow & { role: string }> {
    const model = await this.get(userId, modelId);
    if (!roles.includes(model.role)) throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_ACCESS_DENIED);
    return model;
  }

  async requireActiveRole(userId: string, modelId: string, roles: string[]): Promise<SemanticModelRow & { role: string }> {
    const model = await this.requireRole(userId, modelId, roles);
    if (model.status === 'archived') {
      throw new ConflictException(ErrorCode.SEMANTIC_MODEL_VERSION_IMMUTABLE, 'Archived semantic models are read-only');
    }
    return model;
  }

  async audit(client: PoolClient, modelId: string, versionId: string | null, actorId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
    await client.query(
      'INSERT INTO semantic_model.events (model_id,version_id,actor_user_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)',
      [modelId, versionId, actorId, eventType, JSON.stringify(payload)],
    );
    await this.realtimeSignals.enqueue(client, modelId,
      eventType.startsWith('review_item.') ? 'review-items-changed' : 'model-read-state-changed', {
      reason: eventType,
    });
  }

  async advanceRevision(client: PoolClient, modelId: string, expectedRevision: number): Promise<number> {
    const result = await client.query<{ revision: number }>(
      `UPDATE semantic_model.models SET revision=revision+1,updated_at=now()
       WHERE id=$1 AND revision=$2 RETURNING revision::int`, [modelId,expectedRevision]);
    if (!result.rows[0]) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT);
    return result.rows[0].revision;
  }

  private async assertOwnedWorkspaces(userId: string, workspaceIds: string[]): Promise<void> {
    for (const workspaceId of workspaceIds) {
      const workspace = await this.workspaces.findById(workspaceId);
      if (workspace.createdBy !== userId) throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_WORKSPACE_INVALID);
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}
