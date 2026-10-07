import { Inject } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { AdminEvaluationSettings } from '../services/evaluation-settings.service';
import type { EvaluationSettingsRow, EvaluationSettingsStore } from './evaluation-settings.store';

/** PostgreSQL agent_evaluation.settings implementation of EvaluationSettingsStore (roadmap P6). */
export class PgEvaluationSettingsStore implements EvaluationSettingsStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async find(): Promise<EvaluationSettingsRow | null> {
    const [row] = await this.q.select().from(schema.agentEvaluationSettings).limit(1);
    if (!row) return null;
    return {
      responseReliability: row.responseReliability as unknown as EvaluationSettingsRow['responseReliability'],
    };
  }

  async upsert(next: AdminEvaluationSettings): Promise<void> {
    const responseReliability = stripNul(next.responseReliability) as unknown as Record<string, unknown>;
    await this.q
      .insert(schema.agentEvaluationSettings)
      .values({ id: newObjectId(), singleton: true, responseReliability })
      .onConflictDoUpdate({
        target: schema.agentEvaluationSettings.singleton,
        set: { responseReliability, updatedAt: new Date() },
      });
  }
}
