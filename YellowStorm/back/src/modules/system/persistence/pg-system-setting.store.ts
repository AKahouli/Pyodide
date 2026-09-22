import { Inject } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import { SYSTEM_SETTING_STORE, type SystemSettingRow, type SystemSettingStore } from './system-setting.store';

/** PostgreSQL catalog.system_settings implementation of SystemSettingStore (plan 1B.2.1). */
export class PgSystemSettingStore implements SystemSettingStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async get(key: string): Promise<SystemSettingRow | null> {
    const [row] = await this.q
      .select({ key: schema.catalogSystemSettings.key, value: schema.catalogSystemSettings.value, updatedAt: schema.catalogSystemSettings.updatedAt })
      .from(schema.catalogSystemSettings)
      .where(eq(schema.catalogSystemSettings.key, key))
      .limit(1);
    return row ?? null;
  }

  async getMany(keys: string[]): Promise<SystemSettingRow[]> {
    if (keys.length === 0) return [];
    return this.q
      .select({ key: schema.catalogSystemSettings.key, value: schema.catalogSystemSettings.value, updatedAt: schema.catalogSystemSettings.updatedAt })
      .from(schema.catalogSystemSettings)
      .where(inArray(schema.catalogSystemSettings.key, keys));
  }

  async upsert(key: string, value: unknown): Promise<SystemSettingRow> {
    const [row] = await this.q
      .insert(schema.catalogSystemSettings)
      .values({ id: newObjectId(), key, value })
      .onConflictDoUpdate({
        target: schema.catalogSystemSettings.key,
        set: { value, updatedAt: new Date() },
      })
      .returning({ key: schema.catalogSystemSettings.key, value: schema.catalogSystemSettings.value, updatedAt: schema.catalogSystemSettings.updatedAt });
    return row;
  }

  async delete(key: string): Promise<void> {
    await this.q.delete(schema.catalogSystemSettings).where(eq(schema.catalogSystemSettings.key, key));
  }
}
