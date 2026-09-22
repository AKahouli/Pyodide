import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ConflictException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';

export type SemanticExecutionOwner = 'legacy' | 'runtime';

@Injectable()
export class SemanticExecutionOwnershipService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
  ) {}

  async getOwner(modelId: string, client?: PoolClient): Promise<SemanticExecutionOwner> {
    const sql = 'SELECT execution_owner AS owner FROM semantic_model.models WHERE id=$1';
    const result = client
      ? await client.query<{ owner: SemanticExecutionOwner }>(sql, [modelId])
      : await this.database.query<{ owner: SemanticExecutionOwner }>(sql, [modelId]);
    return result.rows[0]?.owner ?? 'legacy';
  }

  async assertLegacyWriteAllowed(
    modelId: string,
    operation: string,
    client?: PoolClient,
  ): Promise<void> {
    if (await this.getOwner(modelId, client) === 'runtime') {
      throw new ConflictException(
        ErrorCode.SEMANTIC_MODEL_RUNTIME_OWNED,
        `Legacy ${operation} is disabled for runtime-owned semantic models`,
      );
    }
  }

  async claimRuntimeOwnership(userId: string, modelId: string, expectedRevision: number) {
    await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    return this.database.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [modelId]);
      const model = await client.query<{
        revision: number;
        owner: SemanticExecutionOwner;
        versionId: string | null;
      }>(
        `SELECT revision::int, execution_owner AS owner,
                COALESCE(current_draft_version_id,current_published_version_id)::text AS "versionId"
         FROM semantic_model.models WHERE id=$1 FOR UPDATE`,
        [modelId],
      );
      const current = model.rows[0];
      if (!current || current.revision !== expectedRevision) {
        throw new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT);
      }
      if (current.owner === 'runtime') return { executionOwner: 'runtime' as const, revision: current.revision };
      const candidate = await client.query(
        `SELECT 1 FROM semantic_population.data_revisions
         WHERE model_id=$1 AND model_version_id=$2 AND validation_state='valid'
           AND projection_ref IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        [modelId, current.versionId],
      );
      if (!candidate.rowCount) {
        throw new ConflictException(
          ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
          'A valid projected runtime population is required before ownership can be claimed',
        );
      }
      const updated = await client.query<{ revision: number }>(
        `UPDATE semantic_model.models
         SET execution_owner='runtime',runtime_claimed_at=now(),runtime_claimed_by=$2,
             revision=revision+1,updated_at=now()
         WHERE id=$1 RETURNING revision::int`,
        [modelId, userId],
      );
      await client.query(
        `UPDATE semantic_model.graph_index_jobs
         SET status='superseded',completed_at=now(),last_error='Runtime ownership claimed',updated_at=now()
         WHERE model_id=$1 AND status IN ('pending','in_progress','failed')`,
        [modelId],
      );
      await this.models.audit(client, modelId, current.versionId, userId, 'runtime.ownership_claimed', {
        previousOwner: current.owner,
      });
      return { executionOwner: 'runtime' as const, revision: updated.rows[0].revision };
    });
  }
}
