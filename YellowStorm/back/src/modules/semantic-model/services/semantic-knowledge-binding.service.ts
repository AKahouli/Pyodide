import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { CreateBindingDto, UpdateBindingDto } from '../dto';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';
import { SemanticModelWorkspaceService } from './semantic-model-workspace.service';

@Injectable()
export class SemanticKnowledgeBindingService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly workspaceService: SemanticModelWorkspaceService,
  ) {}

  async list(userId: string, modelId: string) {
    await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const result = await this.database.query(
      `SELECT id,target_kind AS "targetKind",target_id AS "targetId",resource_kind AS "resourceKind",
       workspace_id AS "workspaceId",document_id AS "documentId",inclusion_mode AS "inclusionMode",
       retrieval_mode AS "retrievalMode",priority,enabled,protected,availability
       FROM semantic_model.knowledge_bindings WHERE model_id=$1 ORDER BY priority DESC,created_at`, [modelId]);
    return result.rows;
  }

  async create(userId: string, modelId: string, dto: CreateBindingDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const connected = await this.database.query(
      'SELECT 1 FROM semantic_model.workspace_links WHERE model_id=$1 AND workspace_id=$2 AND enabled', [modelId,dto.workspaceId]);
    if (!connected.rowCount) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_WORKSPACE_INVALID);
    if (dto.resourceKind === 'document') {
      if (!dto.documentId || dto.inclusionMode !== 'explicit') throw new ConflictException(ErrorCode.SEMANTIC_MODEL_BINDING_INVALID);
      await this.workspaceService.assertDocument(dto.workspaceId, dto.documentId);
    }
    if (dto.targetKind !== 'model' && !dto.targetId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_BINDING_INVALID);
    const id = randomUUID();
    return this.database.transaction(async (client) => {
      const revision = await this.models.advanceRevision(client,modelId,dto.expectedRevision);
      await this.assertTarget(client,modelId,model.currentDraftVersionId ?? model.currentPublishedVersionId,dto.targetKind,dto.targetId);
      const result = await client.query(
        `INSERT INTO semantic_model.knowledge_bindings
       (id,model_id,target_kind,target_id,resource_kind,workspace_id,document_id,inclusion_mode,retrieval_mode,priority,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id,target_kind AS "targetKind",target_id AS "targetId",resource_kind AS "resourceKind",
       workspace_id AS "workspaceId",document_id AS "documentId",inclusion_mode AS "inclusionMode",
       retrieval_mode AS "retrievalMode",priority,enabled,protected,availability`,
        [id,modelId,dto.targetKind,dto.targetId ?? null,dto.resourceKind,dto.workspaceId,dto.documentId ?? null,dto.inclusionMode,dto.retrievalMode ?? 'broad',dto.priority ?? 0,userId],
      );
      return { ...result.rows[0], revision };
    });
  }

  async update(userId: string, modelId: string, bindingId: string, dto: UpdateBindingDto) {
    await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    return this.database.transaction(async (client) => {
      const binding = await client.query<{ protected: boolean }>(
        'SELECT protected FROM semantic_model.knowledge_bindings WHERE model_id=$1 AND id=$2 FOR UPDATE', [modelId,bindingId]);
      if (!binding.rows[0]) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_BINDING_INVALID);
      if (binding.rows[0].protected) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_PROTECTED_RESOURCE);
      const revision = await this.models.advanceRevision(client,modelId,dto.expectedRevision);
      const result = await client.query(
      `UPDATE semantic_model.knowledge_bindings SET retrieval_mode=COALESCE($4,retrieval_mode),
       priority=COALESCE($5,priority),enabled=COALESCE($6,enabled),updated_at=now()
       WHERE model_id=$1 AND id=$2
       RETURNING id,target_kind AS "targetKind",target_id AS "targetId",resource_kind AS "resourceKind",
       workspace_id AS "workspaceId",document_id AS "documentId",inclusion_mode AS "inclusionMode",
       retrieval_mode AS "retrievalMode",priority,enabled,protected,availability`,
        [modelId,bindingId,userId,dto.retrievalMode ?? null,dto.priority ?? null,dto.enabled ?? null],
      );
      return { ...result.rows[0], revision };
    });
  }

  async delete(userId: string, modelId: string, bindingId: string, expectedRevision: number): Promise<{ revision: number }> {
    await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    return this.database.transaction(async (client) => {
      const binding = await client.query<{ protected: boolean }>(
        'SELECT protected FROM semantic_model.knowledge_bindings WHERE model_id=$1 AND id=$2 FOR UPDATE', [modelId,bindingId]);
      if (!binding.rows[0]) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_BINDING_INVALID);
      if (binding.rows[0].protected) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_PROTECTED_RESOURCE);
      const revision = await this.models.advanceRevision(client,modelId,expectedRevision);
      await client.query('DELETE FROM semantic_model.knowledge_bindings WHERE model_id=$1 AND id=$2', [modelId,bindingId]);
      return { revision };
    });
  }

  private async assertTarget(
    client: import('pg').PoolClient,
    modelId: string,
    versionId: string | null,
    targetKind: CreateBindingDto['targetKind'],
    targetId?: string,
  ): Promise<void> {
    if (targetKind === 'model') {
      if (targetId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_BINDING_INVALID);
      return;
    }
    if (!versionId || !targetId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_BINDING_INVALID);
    const tables = { node_type: 'node_types', relation_type: 'relation_types', record: 'records' } as const;
    const table = tables[targetKind];
    const result = await client.query(
      `SELECT 1 FROM semantic_model.${table} WHERE model_id=$1 AND version_id=$2 AND id=$3`, [modelId,versionId,targetId]);
    if (!result.rowCount) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_BINDING_INVALID);
  }
}
