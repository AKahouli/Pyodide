import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';
import { SemanticDataGrantRevocationService } from './semantic-data-grant-revocation.service';

interface SourceScopeRow {
  workspaceId: string;
  assetId: string;
}

export interface SemanticReadGrant {
  grantId: string;
  scopeHash: string;
  jti: string;
  expiresAt: Date;
}

@Injectable()
export class SemanticDataGrantService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly workspaceShares: WorkspaceShareService,
    private readonly revocations: SemanticDataGrantRevocationService,
  ) {}

  async issue(actorUserId: string, modelId: string, ttlSeconds: number): Promise<SemanticReadGrant> {
    await this.models.requireRole(actorUserId, modelId, ['owner', 'editor', 'viewer']);
    const mapped = await this.database.query<SourceScopeRow>(
      `SELECT DISTINCT workspace_id AS "workspaceId", document_id AS "assetId"
       FROM semantic_model.source_mappings WHERE model_id=$1
       ORDER BY workspace_id, document_id`,
      [modelId],
    );
    const workspaceIds = [...new Set(mapped.rows.map((source) => source.workspaceId))];

    return this.database.transaction(async (client) => {
      await this.revocations.lockWorkspaces(client, workspaceIds);
      const accessible = new Set(await this.workspaceShares.filterAccessible(actorUserId, workspaceIds));
      const sources = mapped.rows.filter((source) => accessible.has(source.workspaceId));
      const scopeHash = createHash('sha256')
        .update(JSON.stringify(sources.map((source) => [source.workspaceId, source.assetId])))
        .digest('hex');
      const reusable = await client.query<SemanticReadGrant>(
        `SELECT id AS "grantId", scope_hash AS "scopeHash", jti, expires_at AS "expiresAt"
         FROM semantic_access.read_grants
         WHERE actor_user_id=$1 AND model_id=$2 AND scope_hash=$3
           AND revoked_at IS NULL AND expires_at > now()+interval '10 seconds'
         ORDER BY expires_at DESC LIMIT 1`,
        [actorUserId, modelId, scopeHash],
      );
      if (reusable.rows[0]) return reusable.rows[0];

      const grantId = randomUUID();
      const jti = randomUUID();
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await client.query(
        `INSERT INTO semantic_access.read_grants
         (id,actor_user_id,model_id,scope_hash,expires_at,jti)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [grantId, actorUserId, modelId, scopeHash, expiresAt, jti],
      );
      for (const source of sources) {
        await client.query(
          `INSERT INTO semantic_access.read_grant_sources (grant_id,workspace_id,asset_id)
           VALUES ($1,$2,$3)`,
          [grantId, source.workspaceId, source.assetId],
        );
      }
      return { grantId, scopeHash, jti, expiresAt };
    });
  }

  async revokeModelGrants(
    client: PoolClient,
    modelId: string,
    actorUserId?: string,
  ): Promise<void> {
    await client.query(
      `UPDATE semantic_access.read_grants SET revoked_at=COALESCE(revoked_at,now())
       WHERE model_id=$1 AND ($2::text IS NULL OR actor_user_id=$2) AND revoked_at IS NULL`,
      [modelId, actorUserId ?? null],
    );
  }

}
