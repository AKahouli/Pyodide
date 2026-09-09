import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';

@Injectable()
export class SemanticGraphIndexJobService {
  constructor(private readonly database: SemanticModelDatabaseService) {}

  async enqueue(modelId: string, versionId?: string, revision?: number, client?: PoolClient): Promise<void> {
    if (!versionId || revision === undefined) {
      const sql =
        `SELECT COALESCE(m.current_draft_version_id,m.current_published_version_id) AS "versionId", v.revision::int
         FROM semantic_model.models m JOIN semantic_model.versions v
           ON v.id=COALESCE(m.current_draft_version_id,m.current_published_version_id) WHERE m.id=$1`;
      const target = client
        ? await client.query<{ versionId: string; revision: number }>(sql,[modelId])
        : await this.database.query<{ versionId: string; revision: number }>(sql,[modelId]);
      versionId = target.rows[0]?.versionId;
      revision = target.rows[0]?.revision;
    }
    if (!versionId || revision === undefined) return;
    const sql = `INSERT INTO semantic_model.graph_index_jobs (model_id,status,target_version_id,target_revision)
       VALUES ($1,'pending',$2,$3)
       ON CONFLICT (model_id) DO UPDATE SET status='pending',target_version_id=$2,target_revision=$3,
         attempt_count=0,next_attempt_at=now(),last_error=NULL,updated_at=now()`;
    if (client) await client.query(sql,[modelId,versionId,revision]);
    else await this.database.query(sql,[modelId,versionId,revision]);
  }
}
