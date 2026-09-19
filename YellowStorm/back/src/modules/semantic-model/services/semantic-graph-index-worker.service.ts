import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LoggerService } from '@modules/logger';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticAgeGraphRepository } from '../repositories/semantic-age-graph.repository';
import { SemanticGraphRepository } from '../repositories/semantic-graph.repository';
import { SemanticSearchGraphClient } from './semantic-search-graph-client.service';

interface IndexTarget { modelId: string; versionId: string; revision: number }

@Injectable()
export class SemanticGraphIndexWorkerService {
  private running = false;
  constructor(private readonly database: SemanticModelDatabaseService, private readonly graphs: SemanticGraphRepository,
    private readonly ageGraph: SemanticAgeGraphRepository, private readonly search: SemanticSearchGraphClient,
    private readonly logger: LoggerService) { this.logger.setContext(SemanticGraphIndexWorkerService.name); }

  @Interval(5000)
  async process(): Promise<void> {
    if (this.running || !this.database.isEnabled()) return;
    this.running = true;
    try { const target = await this.claim(); if (target) await this.index(target); }
    finally { this.running = false; }
  }

  private async claim(): Promise<IndexTarget | null> {
    return this.database.transaction(async (client) => {
      const result = await client.query<IndexTarget>(
        `SELECT model_id AS "modelId",target_version_id AS "versionId",target_revision::int AS revision
         FROM semantic_model.graph_index_jobs
         WHERE (status='pending' OR (status='in_progress' AND started_at < now()-interval '10 minutes'))
           AND next_attempt_at<=now() ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      const target = result.rows[0];
      if (!target) return null;
      await client.query(`UPDATE semantic_model.graph_index_jobs SET status='in_progress',started_at=now(),
        attempt_count=attempt_count+1,updated_at=now() WHERE model_id=$1`, [target.modelId]);
      return target;
    });
  }

  private async index(target: IndexTarget): Promise<void> {
    const lockClient = await this.database.acquireClient();
    try {
      const lock = await lockClient.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',[target.modelId]);
      if (!lock.rows[0]?.acquired) {
        await this.database.query(`UPDATE semantic_model.graph_index_jobs SET status='pending',next_attempt_at=now()+interval '5 seconds',updated_at=now() WHERE model_id=$1 AND target_version_id=$2 AND target_revision=$3`,[target.modelId,target.versionId,target.revision]);
        return;
      }
      const current = await this.database.query(
        `SELECT 1 FROM semantic_model.graph_index_jobs j JOIN semantic_model.models m ON m.id=j.model_id
         WHERE j.model_id=$1 AND j.target_version_id=$2 AND j.target_revision=$3
           AND j.status='in_progress' AND m.status<>'archived'`,[target.modelId,target.versionId,target.revision]);
      if (!current.rowCount) return;
      const graph = await this.graphs.getGraph(target.modelId,target.versionId,target.revision);
      await this.ageGraph.dropGraph(target.modelId,true);
      const built = await this.ageGraph.buildGraph(graph,target.modelId,true);
      if (built.failedVertexCount || built.failedEdgeCount) throw new Error('AGE graph projection is incomplete');
      await this.search.index(target.modelId);
      await this.database.query(
        `UPDATE semantic_model.graph_index_jobs SET status='indexed',indexed_version_id=$2,indexed_revision=$3,
         completed_at=now(),last_error=NULL,updated_at=now() WHERE model_id=$1 AND target_version_id=$2 AND target_revision=$3`,
        [target.modelId,target.versionId,target.revision]);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0,500) : 'Indexing failed';
      await this.database.query(
        `UPDATE semantic_model.graph_index_jobs SET status=CASE WHEN attempt_count>=3 THEN 'failed' ELSE 'pending' END,
         next_attempt_at=now()+(LEAST(attempt_count,3)*interval '30 seconds'),last_error=$2,updated_at=now()
         WHERE model_id=$1 AND target_version_id=$3 AND target_revision=$4`, [target.modelId,message,target.versionId,target.revision]);
      this.logger.error('Semantic graph indexing failed', { modelId: target.modelId, error: message });
    } finally {
      // A failed unlock leaves the session-level lock held on this client:
      // destroy it instead of returning it to the pool.
      const unlockErr = await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))',[target.modelId])
        .then(() => undefined, (err: unknown) => (err instanceof Error ? err : new Error(String(err))));
      if (unlockErr) this.logger.warn('Semantic graph advisory unlock failed; discarding client', { modelId: target.modelId, error: unlockErr.message });
      lockClient.release(unlockErr);
    }
  }
}
