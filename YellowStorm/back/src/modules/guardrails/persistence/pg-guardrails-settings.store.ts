import { Inject } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import type { AdminGuardrailsSettings } from '../services/guardrails-settings.service';
import { type GuardrailsSettingsRow,  type GuardrailsSettingsStore } from './guardrails-settings.store';

/** PostgreSQL catalog.guardrails_settings implementation of GuardrailsSettingsStore (plan 1B.2.3). */
export class PgGuardrailsSettingsStore implements GuardrailsSettingsStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async find(): Promise<GuardrailsSettingsRow | null> {
    const [row] = await this.q.select().from(schema.catalogGuardrailsSettings).limit(1);
    if (!row) return null;
    return {
      forceActivation: row.forceActivation,
      promptInjection: row.promptInjection as unknown as GuardrailsSettingsRow['promptInjection'],
      toolActionReview: row.toolActionReview as unknown as GuardrailsSettingsRow['toolActionReview'],
    };
  }

  async upsert(next: AdminGuardrailsSettings): Promise<void> {
    const promptInjection = next.promptInjection as unknown as Record<string, unknown>;
    const toolActionReview = next.toolActionReview as unknown as Record<string, unknown>;
    await this.q
      .insert(schema.catalogGuardrailsSettings)
      .values({
        id: newObjectId(),
        singleton: true,
        forceActivation: next.forceActivation,
        promptInjection,
        toolActionReview,
      })
      .onConflictDoUpdate({
        target: schema.catalogGuardrailsSettings.singleton,
        set: {
          forceActivation: next.forceActivation,
          promptInjection,
          toolActionReview,
          updatedAt: new Date(),
        },
      });
  }
}
