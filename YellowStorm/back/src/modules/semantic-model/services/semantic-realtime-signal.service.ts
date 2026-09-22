import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PoolClient } from 'pg';
import semanticModelConfig from '@config/semantic-model.config';

type SignalEvent = 'model-read-state-changed' | 'review-items-changed';

@Injectable()
export class SemanticRealtimeSignalService {
  constructor(
    @Inject(semanticModelConfig.KEY)
    private readonly config: ConfigType<typeof semanticModelConfig>,
  ) {}

  async enqueue(
    client: PoolClient,
    modelId: string,
    eventType: SignalEvent,
    payload: { resource?: string; status?: string; reason?: string } = {},
  ): Promise<void> {
    if (!this.config.realtimeEnabled) return;
    const resource = payload.resource ?? null;
    const body = JSON.stringify({ modelId, ...payload });
    const key = `${modelId}:${eventType}:${resource ?? ''}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
    const updated = await client.query<{ id: string }>(
      `UPDATE semantic_jobs.ui_signal_outbox
       SET payload=$4::jsonb,available_at=now(),updated_at=now(),last_error=NULL
       WHERE id=(SELECT id FROM semantic_jobs.ui_signal_outbox
         WHERE model_id=$1::uuid AND event_type=$2 AND resource IS NOT DISTINCT FROM $3
           AND status='pending' AND claim_owner IS NULL ORDER BY id DESC LIMIT 1)
       RETURNING id`,
      [modelId, eventType, resource, body],
    );
    if (updated.rowCount) return;
    await client.query(
      `INSERT INTO semantic_jobs.ui_signal_outbox(model_id,event_type,resource,payload)
       VALUES ($1::uuid,$2,$3,$4::jsonb)`,
      [modelId, eventType, resource, body],
    );
  }
}
