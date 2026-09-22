import { Inject } from '@nestjs/common';
import { asc, count, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { withTransaction, resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  APPEARANCE_LOGO_STORE,
  type AppearanceLogoPatch,
  type AppearanceLogoRecord,
  type AppearanceLogoStore,
  type AppearanceLogoWithData,
  type NewAppearanceLogo,
} from './appearance-logo.store';

type Row = typeof schema.catalogAppearanceLogos.$inferSelect;

const publicColumns = {
  id: schema.catalogAppearanceLogos.id,
  name: schema.catalogAppearanceLogos.name,
  contentType: schema.catalogAppearanceLogos.contentType,
  width: schema.catalogAppearanceLogos.width,
  height: schema.catalogAppearanceLogos.height,
  createdAt: schema.catalogAppearanceLogos.createdAt,
  updatedAt: schema.catalogAppearanceLogos.updatedAt,
};

function toRecord(row: Pick<Row, keyof typeof publicColumns>): AppearanceLogoRecord {
  return {
    id: row.id,
    name: row.name,
    contentType: row.contentType,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** PostgreSQL catalog.appearance_logos implementation of AppearanceLogoStore (plan 1B.2.2). */
export class PgAppearanceLogoStore implements AppearanceLogoStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async list(): Promise<AppearanceLogoRecord[]> {
    const rows = await this.q
      .select(publicColumns)
      .from(schema.catalogAppearanceLogos)
      .orderBy(asc(schema.catalogAppearanceLogos.createdAt));
    return rows.map(toRecord);
  }

  async findWithData(id: string): Promise<AppearanceLogoWithData | null> {
    const [row] = await this.q
      .select({ ...publicColumns, data: schema.catalogAppearanceLogos.data })
      .from(schema.catalogAppearanceLogos)
      .where(eq(schema.catalogAppearanceLogos.id, id))
      .limit(1);
    return row ? { ...toRecord(row), data: row.data } : null;
  }

  async createWithinCap(input: NewAppearanceLogo, maxCustomLogos: number): Promise<AppearanceLogoRecord | null> {
    return withTransaction(this.db, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('appearance_logos'))`);
      const [tally] = await tx.select({ n: count() }).from(schema.catalogAppearanceLogos);
      if ((tally?.n ?? 0) >= maxCustomLogos) {
        return null;
      }
      const [row] = await tx
        .insert(schema.catalogAppearanceLogos)
        .values({ id: newObjectId(), ...input })
        .returning(publicColumns);
      return toRecord(row);
    });
  }

  async update(id: string, patch: AppearanceLogoPatch): Promise<AppearanceLogoRecord | null> {
    const [row] = await this.q
      .update(schema.catalogAppearanceLogos)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.catalogAppearanceLogos.id, id))
      .returning(publicColumns);
    return row ? toRecord(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const [row] = await this.q
      .delete(schema.catalogAppearanceLogos)
      .where(eq(schema.catalogAppearanceLogos.id, id))
      .returning({ id: schema.catalogAppearanceLogos.id });
    return Boolean(row);
  }
}
