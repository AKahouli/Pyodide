import { Injectable } from '@nestjs/common';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';
import { ConflictException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ConnectWorkspaceDto } from '../dto';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';

@Injectable()
export class SemanticModelWorkspaceService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly workspaces: WorkspaceService,
    private readonly workspaceShares: WorkspaceShareService,
    private readonly documents: WorkspaceDocumentService,
  ) {}

  async list(userId: string, modelId: string) {
    await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const result = await this.database.query(
      `SELECT workspace_id AS "workspaceId",role,enabled,created_at AS "createdAt"
       FROM semantic_model.workspace_links WHERE model_id=$1 ORDER BY role DESC,created_at`, [modelId]);
    return result.rows;
  }

  async connect(userId: string, modelId: string, dto: ConnectWorkspaceDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    if (!await this.workspaceShares.hasAccess(userId, dto.workspaceId)) throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_WORKSPACE_INVALID);
    const workspace = await this.workspaces.findById(dto.workspaceId);
    const revision = await this.database.transaction(async (client) => {
      const revision = await this.models.advanceRevision(client,modelId,dto.expectedRevision);
      const role = !model.originWorkspaceId || model.originWorkspaceId === dto.workspaceId ? 'origin' : 'connected';
      if (!model.originWorkspaceId) {
        await client.query(
          'UPDATE semantic_model.models SET origin_workspace_id=$2,updated_at=now() WHERE id=$1 AND origin_workspace_id IS NULL',
          [modelId,dto.workspaceId],
        );
      }
      await client.query(
        `INSERT INTO semantic_model.workspace_links(model_id,workspace_id,role,created_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT(model_id,workspace_id) DO UPDATE SET role=$3,enabled=true,updated_at=now()`,
        [modelId,dto.workspaceId,role,userId],
      );
      if (dto.addToDocumentsFallback) {
        const node = await client.query<{ id: string }>(
          `SELECT id FROM semantic_model.node_types WHERE version_id=$1 AND system_key='workspace_documents'`, [model.currentDraftVersionId]);
        if (node.rows[0]) {
          await client.query(
            `INSERT INTO semantic_model.knowledge_bindings
             (model_id,target_kind,target_id,resource_kind,workspace_id,inclusion_mode,retrieval_mode,created_by)
             VALUES($1,'node_type',$2,'workspace',$3,'dynamic','broad',$4)`,
            [modelId,node.rows[0].id,dto.workspaceId,userId],
          );
        }
      }
      return revision;
    });
    return { workspaceId: dto.workspaceId, enabled: true, revision };
  }

  async disconnectImpact(userId: string, modelId: string, workspaceId: string) {
    await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const result = await this.database.query<{ bindingCount: number }>(
      `SELECT COUNT(*)::int AS "bindingCount" FROM semantic_model.knowledge_bindings
       WHERE model_id=$1 AND workspace_id=$2 AND enabled`, [modelId,workspaceId]);
    return { workspaceId, bindingCount: result.rows[0]?.bindingCount ?? 0 };
  }

  async disconnect(userId: string, modelId: string, workspaceId: string, expectedRevision: number): Promise<{ revision: number }> {
    await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const link = await this.database.query<{ role: string }>(
      'SELECT role FROM semantic_model.workspace_links WHERE model_id=$1 AND workspace_id=$2 AND enabled', [modelId,workspaceId]);
    if (!link.rows[0]) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_WORKSPACE_INVALID);
    if (link.rows[0].role === 'origin') throw new ConflictException(ErrorCode.SEMANTIC_MODEL_PROTECTED_RESOURCE);
    const revision = await this.database.transaction(async (client) => {
      const nextRevision = await this.models.advanceRevision(client,modelId,expectedRevision);
      await client.query('UPDATE semantic_model.workspace_links SET enabled=false,updated_at=now() WHERE model_id=$1 AND workspace_id=$2', [modelId,workspaceId]);
      await client.query('UPDATE semantic_model.knowledge_bindings SET enabled=false,availability=\'unavailable\',updated_at=now() WHERE model_id=$1 AND workspace_id=$2', [modelId,workspaceId]);
      return nextRevision;
    });
    return { revision };
  }

  async assertDocument(workspaceId: string, documentId: string): Promise<void> {
    await this.documents.findById(workspaceId, documentId);
  }
}
