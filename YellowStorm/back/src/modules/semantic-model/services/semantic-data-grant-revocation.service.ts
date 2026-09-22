import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';

@Injectable()
export class SemanticDataGrantRevocationService {
  constructor(private readonly database: SemanticModelDatabaseService) {}

  async lockWorkspaces(client: PoolClient, workspaceIds: string[]): Promise<void> {
    for (const workspaceId of [...new Set(workspaceIds)].sort()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`semantic-access:${workspaceId}`]);
    }
  }

  async revokeWorkspaceAccess(workspaceId: string, actorUserId?: string): Promise<void> {
    await this.runWithWorkspaceRevocation(workspaceId, actorUserId, async () => undefined);
  }

  async runWithWorkspaceRevocation<T>(
    workspaceId: string,
    actorUserId: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    const client = await this.database.acquireClient();
    const lockKey = `semantic-access:${workspaceId}`;
    let inTransaction = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
      await client.query('BEGIN');
      inTransaction = true;
      await client.query(
        `UPDATE semantic_access.read_grants grant_row
         SET revoked_at=COALESCE(grant_row.revoked_at,now())
         WHERE ($1::text IS NULL OR grant_row.actor_user_id=$1) AND grant_row.revoked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM semantic_access.read_grant_sources source_row
             WHERE source_row.grant_id=grant_row.id AND source_row.workspace_id=$2
           )`,
        [actorUserId ?? null, workspaceId],
      );
      await client.query('COMMIT');
      inTransaction = false;
      return await work();
    } catch (error) {
      if (inTransaction) await client.query('ROLLBACK');
      throw error;
    } finally {
      const unlockError = await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey])
        .then(() => undefined, (error: unknown) => error instanceof Error ? error : new Error(String(error)));
      client.release(unlockError);
    }
  }
}
