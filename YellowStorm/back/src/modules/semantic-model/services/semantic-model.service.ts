import { Injectable, Logger } from '@nestjs/common';
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
import { SemanticRuntimeClientService } from './semantic-runtime-client.service';

interface CloneIdMaps {
  nodeIds: Map<string, string>;
  relationIds: Map<string, string>;
  recordIds: Map<string, string>;
  recordRelationIds: Map<string, string>;
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

  async clone(userId: string, modelId: string, name: string): Promise<SemanticModelRow> {
    const source = await this.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const versionId = source.currentDraftVersionId ?? source.currentPublishedVersionId;
    if (!versionId) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const revisionResult = await this.database.query<{ revision: number }>('SELECT revision::int FROM semantic_model.versions WHERE id=$1', [versionId]);
    const sourceGraph = await this.graph.getGraph(source.id, versionId, revisionResult.rows[0]?.revision ?? 0);
    const [links, bindings] = await Promise.all([
      this.database.query<{ workspaceId: string }>(
        'SELECT workspace_id AS "workspaceId" FROM semantic_model.workspace_links WHERE model_id=$1 AND enabled', [source.id]),
      this.database.query<SemanticBindingRow>(
        `SELECT target_kind AS "targetKind", target_id AS "targetId", resource_kind AS "resourceKind",
                workspace_id AS "workspaceId", document_id AS "documentId", inclusion_mode AS "inclusionMode",
                retrieval_mode AS "retrievalMode", priority, enabled, protected, availability
         FROM semantic_model.knowledge_bindings WHERE model_id=$1`, [source.id]),
    ]);
    const ids = this.createCloneIdMaps(sourceGraph);
    try {
      const clone = await this.database.transaction(async (client) => {
        const target = await this.createCloneModel(client, userId, name, source.description, links.rows.map((item) => item.workspaceId));
        await this.copyCloneGraph(client, target.id, target.currentDraftVersionId!, sourceGraph, ids);
        await this.copyCloneBindings(client, target.id, userId, bindings.rows, ids);
        await this.audit(client, target.id, target.currentDraftVersionId, userId, 'model.cloned', {
          sourceModelId: source.id,
          sourceVersionId: versionId,
        });
        return target;
      });
      return clone;
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NAME_EXISTS);
      throw error;
    }
  }

  private createCloneIdMaps(graph: Awaited<ReturnType<SemanticGraphRepository['getGraph']>>): CloneIdMaps {
    return {
      nodeIds: new Map(graph.nodes.map((node) => [node.id, randomUUID()])),
      relationIds: new Map(graph.relations.map((relation) => [relation.id, randomUUID()])),
      recordIds: new Map(graph.records.map((record) => [record.id, randomUUID()])),
      recordRelationIds: new Map(graph.recordRelations.map((relation) => [relation.id, randomUUID()])),
    };
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

  private async copyCloneGraph(client: PoolClient, modelId: string, versionId: string, source: Awaited<ReturnType<SemanticGraphRepository['getGraph']>>, ids: CloneIdMaps): Promise<void> {
    for (const node of source.nodes) {
      await this.graph.apply(client, modelId, versionId, { type: 'node_type.create', entity: { ...node, id: ids.nodeIds.get(node.id)! } });
    }
    for (const relation of source.relations) {
      await this.graph.apply(client, modelId, versionId, {
        type: 'relation_type.create',
        entity: { ...relation, id: ids.relationIds.get(relation.id)!, sourceNodeTypeId: ids.nodeIds.get(relation.sourceNodeTypeId)!, targetNodeTypeId: ids.nodeIds.get(relation.targetNodeTypeId)! },
      });
    }
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
    if (values._entity_key !== recordId) return { ...values };
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
