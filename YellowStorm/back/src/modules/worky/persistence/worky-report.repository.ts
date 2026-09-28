import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { WorkyExecutionReportRecord } from '../worky.types';

const r = schema.workyExecutionReports;

export interface WorkyReportFields {
  type: string;
  status: string;
  summary: string;
  markdown: string;
  metadata: Record<string, unknown>;
  generatedAt: Date | null;
}

/** PostgreSQL worky.execution_reports repository (roadmap P7). */
@Injectable()
export class WorkyReportRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findByStream(streamId: string): Promise<WorkyExecutionReportRecord | null> {
    if (!isObjectId(streamId)) return null;
    const [row] = await this.q.select().from(r).where(eq(r.streamId, normalizeObjectId(streamId))).limit(1);
    return row ?? null;
  }

  /** One report per stream: the second generation overwrites the first. */
  async upsert(streamId: string, fields: WorkyReportFields): Promise<WorkyExecutionReportRecord> {
    const values = { ...fields, summary: stripNul(fields.summary), markdown: stripNul(fields.markdown), metadata: stripNul(fields.metadata) };
    const [row] = await this.q
      .insert(r)
      .values({ id: newObjectId(), streamId: normalizeObjectId(streamId), ...values })
      .onConflictDoUpdate({ target: r.streamId, set: { ...values, updatedAt: new Date() } })
      .returning();
    return row;
  }
}
