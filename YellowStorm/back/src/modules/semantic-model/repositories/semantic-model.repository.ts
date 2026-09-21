import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';

export interface SemanticModelRow {
  id: string;
  ownerUserId: string;
  name: string;
  description: string;
  kind: 'workspace_default' | 'designed';
  status: 'draft' | 'published' | 'archived';
  revision: number;
  originWorkspaceId: string | null;
  nameManagedBySystem: boolean;
  currentDraftVersionId: string | null;
  currentPublishedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  indexStatus: 'pending' | 'in_progress' | 'indexed' | 'failed' | 'not_indexed';
  indexError: string | null;
  executionOwner: 'legacy' | 'runtime';
}

const MODEL_COLUMNS = `
  m.id, m.owner_user_id AS "ownerUserId", m.name, m.description, m.kind, m.status,
  m.revision::int, m.origin_workspace_id AS "originWorkspaceId",
  m.name_managed_by_system AS "nameManagedBySystem",
  m.current_draft_version_id AS "currentDraftVersionId",
  m.current_published_version_id AS "currentPublishedVersionId",
  m.execution_owner AS "executionOwner",
  m.created_at AS "createdAt", m.updated_at AS "updatedAt",
  COALESCE((SELECT j.status FROM semantic_model.graph_index_jobs j WHERE j.model_id=m.id),'not_indexed') AS "indexStatus",
  (SELECT j.last_error FROM semantic_model.graph_index_jobs j WHERE j.model_id=m.id) AS "indexError"`;

@Injectable()
export class SemanticModelRepository {
  constructor(private readonly database: SemanticModelDatabaseService) {}

  async listForUser(
    userId: string,
    filters: {
      search?: string;
      kind?: string;
      status?: string;
      workspace?: string;
      page: number;
      limit: number;
    },
  ): Promise<{ items: Array<SemanticModelRow & Record<string, unknown>>; pagination: Record<string, number> }> {
    const params: unknown[] = [userId];
    const conditions = [
      `(m.owner_user_id = $1 OR EXISTS (
        SELECT 1 FROM semantic_model.memberships membership
        WHERE membership.model_id = m.id AND membership.user_id = $1))`,
    ];
    if (filters.search) {
      params.push(`%${filters.search.trim()}%`);
      conditions.push(`(m.name ILIKE $${params.length} OR m.description ILIKE $${params.length})`);
    }
    if (filters.kind) {
      params.push(filters.kind);
      conditions.push(`m.kind = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`m.status = $${params.length}`);
    }
    if (filters.workspace) {
      params.push(filters.workspace);
      conditions.push(`EXISTS (SELECT 1 FROM semantic_model.workspace_links wl
        WHERE wl.model_id = m.id AND wl.workspace_id = $${params.length} AND wl.enabled)`);
    }
    const where = conditions.join(' AND ');
    const count = await this.database.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM semantic_model.models m WHERE ${where}`,
      params,
    );
    const offset = (filters.page - 1) * filters.limit;
    params.push(filters.limit, offset);
    const rows = await this.database.query<SemanticModelRow & Record<string, unknown>>(
      `SELECT ${MODEL_COLUMNS},
        (SELECT COUNT(*)::int FROM semantic_model.workspace_links wl WHERE wl.model_id = m.id AND wl.enabled) AS "workspaceCount",
        (SELECT COUNT(*)::int FROM semantic_model.node_types nt WHERE nt.version_id = m.current_draft_version_id) AS "nodeCount",
        (SELECT COUNT(*)::int FROM semantic_model.relation_types rt WHERE rt.version_id = m.current_draft_version_id) AS "relationCount",
        (SELECT COUNT(*)::int FROM semantic_model.records r WHERE r.version_id = m.current_draft_version_id) AS "recordCount",
        (SELECT COUNT(*)::int FROM semantic_model.knowledge_bindings kb WHERE kb.model_id = m.id AND kb.enabled) AS "bindingCount",
        (SELECT COUNT(*)::int FROM semantic_model.knowledge_bindings kb WHERE kb.model_id = m.id AND kb.enabled AND kb.availability = 'unavailable') AS "brokenBindingCount"
       FROM semantic_model.models m WHERE ${where}
       ORDER BY m.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const total = count.rows[0]?.total ?? 0;
    return {
      items: rows.rows,
      pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
    };
  }

  async findAccessible(userId: string, modelId: string): Promise<(SemanticModelRow & { role: string }) | null> {
    const result = await this.database.query<SemanticModelRow & { role: string }>(
      `SELECT ${MODEL_COLUMNS},
        CASE WHEN m.owner_user_id = $1 THEN 'owner' ELSE membership.role END AS role
       FROM semantic_model.models m
       LEFT JOIN semantic_model.memberships membership
         ON membership.model_id = m.id AND membership.user_id = $1
       WHERE m.id = $2 AND (m.owner_user_id = $1 OR membership.user_id IS NOT NULL)`,
      [userId, modelId],
    );
    return result.rows[0] ?? null;
  }

  async findByOriginWorkspace(workspaceId: string, userId: string): Promise<SemanticModelRow | null> {
    const result = await this.database.query<SemanticModelRow>(
      `SELECT ${MODEL_COLUMNS} FROM semantic_model.models m
       WHERE m.origin_workspace_id = $1 AND m.owner_user_id = $2 AND m.archived_at IS NULL`,
      [workspaceId, userId],
    );
    return result.rows[0] ?? null;
  }

  async listByWorkspace(workspaceId: string, userId: string): Promise<SemanticModelRow[]> {
    const result = await this.database.query<SemanticModelRow>(
      `SELECT ${MODEL_COLUMNS} FROM semantic_model.models m
       JOIN semantic_model.workspace_links wl ON wl.model_id = m.id AND wl.enabled
       LEFT JOIN semantic_model.memberships membership ON membership.model_id = m.id AND membership.user_id = $2
       WHERE wl.workspace_id = $1 AND (m.owner_user_id = $2 OR membership.user_id IS NOT NULL)
       ORDER BY m.updated_at DESC`,
      [workspaceId, userId],
    );
    return result.rows;
  }

  async create(
    client: PoolClient,
    input: {
      ownerUserId: string;
      name: string;
      description: string;
      kind: 'workspace_default' | 'designed';
      originWorkspaceId?: string;
      nameManagedBySystem: boolean;
      workspaceIds: string[];
    },
  ): Promise<SemanticModelRow> {
    const modelResult = await client.query<SemanticModelRow>(
      `INSERT INTO semantic_model.models
        (owner_user_id, name, description, kind, origin_workspace_id, name_managed_by_system)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, owner_user_id AS "ownerUserId", name, description, kind, status,
         revision::int, origin_workspace_id AS "originWorkspaceId", name_managed_by_system AS "nameManagedBySystem",
         current_draft_version_id AS "currentDraftVersionId",
          current_published_version_id AS "currentPublishedVersionId", execution_owner AS "executionOwner",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [input.ownerUserId, input.name, input.description, input.kind, input.originWorkspaceId ?? null, input.nameManagedBySystem],
    );
    const model = modelResult.rows[0];
    const version = await client.query<{ id: string }>(
      `INSERT INTO semantic_model.versions (model_id, version_number, status, created_by)
       VALUES ($1, 1, 'draft', $2) RETURNING id`,
      [model.id, input.ownerUserId],
    );
    await client.query(
      `UPDATE semantic_model.models SET current_draft_version_id = $2 WHERE id = $1`,
      [model.id, version.rows[0].id],
    );
    await client.query(
      `INSERT INTO semantic_model.memberships (model_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [model.id, input.ownerUserId],
    );
    for (const workspaceId of input.workspaceIds) {
      await client.query(
        `INSERT INTO semantic_model.workspace_links (model_id, workspace_id, role, created_by)
         VALUES ($1, $2, $3, $4) ON CONFLICT (model_id, workspace_id) DO UPDATE SET enabled = true`,
        [model.id, workspaceId, workspaceId === input.originWorkspaceId ? 'origin' : 'connected', input.ownerUserId],
      );
    }
    return { ...model, currentDraftVersionId: version.rows[0].id };
  }

  async update(modelId: string, expectedRevision: number, input: { name?: string; description?: string }): Promise<SemanticModelRow | null> {
    const result = await this.database.query<SemanticModelRow>(
      `UPDATE semantic_model.models SET
        name = COALESCE($2, name), description = COALESCE($3, description),
        name_managed_by_system = CASE WHEN $2::text IS NOT NULL THEN false ELSE name_managed_by_system END,
        revision = revision + 1, updated_at = now()
       WHERE id = $1 AND revision = $4
       RETURNING id, owner_user_id AS "ownerUserId", name, description, kind, status,
         revision::int, origin_workspace_id AS "originWorkspaceId", name_managed_by_system AS "nameManagedBySystem",
         current_draft_version_id AS "currentDraftVersionId",
          current_published_version_id AS "currentPublishedVersionId", execution_owner AS "executionOwner",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [modelId, input.name ?? null, input.description ?? null, expectedRevision],
    );
    return result.rows[0] ?? null;
  }
}
