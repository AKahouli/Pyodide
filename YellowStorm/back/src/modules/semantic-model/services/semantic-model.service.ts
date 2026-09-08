import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import { ConflictException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { CreateSemanticModelDto, SemanticModelQueryDto, UpdateSemanticModelDto } from '../dto';
import { SemanticGraphOperation } from '../domain/semantic-model.types';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticAgeGraphRepository } from '../repositories/semantic-age-graph.repository';
import { SemanticGraphRepository } from '../repositories/semantic-graph.repository';
import { SemanticModelRepository, SemanticModelRow } from '../repositories/semantic-model.repository';

@Injectable()
export class SemanticModelService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelRepository,
    private readonly graph: SemanticGraphRepository,
    private readonly workspaces: WorkspaceService,
    private readonly ageGraph: SemanticAgeGraphRepository,
  ) {}

  list(userId: string, query: SemanticModelQueryDto) {
    return this.models.listForUser(userId, query);
  }

  async get(userId: string, modelId: string): Promise<SemanticModelRow & { role: string }> {
    const model = await this.models.findAccessible(userId, modelId);
    if (!model) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND);
    return model;
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
      const model = await this.models.update(modelId, dto.expectedRevision, dto);
      if (!model) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT);
      return model;
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NAME_EXISTS);
      throw error;
    }
  }

  async archive(userId: string, modelId: string, expectedRevision: number): Promise<void> {
    const model = await this.requireActiveRole(userId, modelId, ['owner']);
    const result = await this.database.query(
      `UPDATE semantic_model.models SET status='archived', archived_at=now(), revision=revision+1, updated_at=now()
       WHERE id=$1 AND revision=$2`, [model.id, expectedRevision]);
    if (!result.rowCount) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT);
    void this.ageGraph.dropGraph(modelId);
  }

  async clone(userId: string, modelId: string, name: string): Promise<SemanticModelRow> {
    const source = await this.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const versionId = source.currentDraftVersionId ?? source.currentPublishedVersionId;
    if (!versionId) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const revisionResult = await this.database.query<{ revision: number }>('SELECT revision::int FROM semantic_model.versions WHERE id=$1', [versionId]);
    const sourceGraph = await this.graph.getGraph(source.id, versionId, revisionResult.rows[0]?.revision ?? 0);
    const links = await this.database.query<{ workspaceId: string }>(
      'SELECT workspace_id AS "workspaceId" FROM semantic_model.workspace_links WHERE model_id=$1 AND enabled', [source.id]);
    const clone = await this.create(userId, { name, description: source.description, workspaceIds: links.rows.map((item) => item.workspaceId) });
    const nodeIds = new Map(sourceGraph.nodes.map((node) => [node.id, randomUUID()]));
    const relationIds = new Map(sourceGraph.relations.map((relation) => [relation.id, randomUUID()]));
    const recordIds = new Map(sourceGraph.records.map((record) => [record.id, randomUUID()]));
    const operations: SemanticGraphOperation[] = [
      ...sourceGraph.nodes.map((node): SemanticGraphOperation => ({ type: 'node_type.create', entity: { ...node, id: nodeIds.get(node.id)! } })),
      ...sourceGraph.relations.map((relation): SemanticGraphOperation => ({ type: 'relation_type.create', entity: { ...relation, id: relationIds.get(relation.id)!, sourceNodeTypeId: nodeIds.get(relation.sourceNodeTypeId)!, targetNodeTypeId: nodeIds.get(relation.targetNodeTypeId)! } })),
      ...sourceGraph.records.map((record): SemanticGraphOperation => ({ type: 'record.create', entity: { ...record, id: recordIds.get(record.id)!, nodeTypeId: nodeIds.get(record.nodeTypeId)! } })),
      ...sourceGraph.recordRelations.map((relation): SemanticGraphOperation => ({ type: 'record_relation.create', entity: { ...relation, id: randomUUID(), relationTypeId: relationIds.get(relation.relationTypeId)!, sourceRecordId: recordIds.get(relation.sourceRecordId)!, targetRecordId: recordIds.get(relation.targetRecordId)! } })),
    ];
    await this.database.transaction(async (client) => {
      for (const operation of operations) await this.graph.apply(client, clone.id, clone.currentDraftVersionId!, operation);
    });
    return clone;
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
