import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  WorkyElectricCursorRecord,
  WorkyPlanProjectionRecord,
  WorkyPlanStepArtifactRecord,
  WorkyPlanStepComponentRecord,
} from '../worky.types';

const comp = schema.workyPlanStepComponents;
const art = schema.workyPlanStepArtifacts;
const proj = schema.workyPlanProjections;
const cur = schema.workyElectricCursors;

function text(value: unknown): string | null {
  return typeof value === 'string' ? stripNul(value) : null;
}

/**
 * The rows the manager's Postgres syncs through Electric that are not tasks or messages: the plan
 * projection, the step components and artifacts, and the resume cursor of each shape.
 */
@Injectable()
export class WorkyMirrorRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  // ---------------------------------------------------------------- plan projection

  async findProjection(streamId: string): Promise<WorkyPlanProjectionRecord | null> {
    if (!isObjectId(streamId)) return null;
    const [row] = await this.q.select().from(proj).where(eq(proj.streamId, normalizeObjectId(streamId))).limit(1);
    return row ?? null;
  }

  /**
   * The plans shape writes title/goal/status and the sessions shape writes the session status, each
   * through its own call, so only the fields present in `set` are written on conflict.
   */
  async upsertProjection(streamId: string, set: Record<string, unknown>): Promise<WorkyPlanProjectionRecord> {
    const fields: Partial<typeof proj.$inferInsert> = {};
    if ('title' in set) fields.title = text(set.title) ?? '';
    if ('goal' in set) fields.goal = text(set.goal) ?? '';
    if ('status' in set) fields.status = text(set.status) ?? '';
    if ('sessionStatus' in set) fields.sessionStatus = text(set.sessionStatus);
    if ('activeInterruptId' in set) fields.activeInterruptId = text(set.activeInterruptId);
    const [row] = await this.q
      .insert(proj)
      .values({ id: newObjectId(), streamId: normalizeObjectId(streamId), ...fields })
      .onConflictDoUpdate({ target: proj.streamId, set: { ...fields, updatedAt: new Date() } })
      .returning();
    return row;
  }

  // ---------------------------------------------------------------- step components and artifacts

  async upsertStepComponent(streamId: string, externalId: string, set: Record<string, unknown>): Promise<WorkyPlanStepComponentRecord> {
    const fields = {
      stepExternalId: text(set.stepExternalId) ?? '',
      ordinal: typeof set.ordinal === 'number' ? Math.trunc(set.ordinal) : 0,
      type: text(set.type) ?? '',
      data: stripNul((set.data as Record<string, unknown> | undefined) ?? {}),
    };
    const [row] = await this.q
      .insert(comp)
      .values({ id: newObjectId(), streamId: normalizeObjectId(streamId), externalId, ...fields })
      .onConflictDoUpdate({
        target: [comp.streamId, comp.externalId],
        targetWhere: sql`${comp.externalId} IS NOT NULL`,
        set: { ...fields, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async upsertStepArtifact(streamId: string, externalId: string, set: Record<string, unknown>): Promise<WorkyPlanStepArtifactRecord> {
    const fields = {
      stepExternalId: text(set.stepExternalId) ?? '',
      filePath: text(set.filePath) ?? '',
      filename: text(set.filename) ?? '',
      artifactKind: text(set.artifactKind),
      mimeType: text(set.mimeType),
      size: typeof set.size === 'number' && Number.isFinite(set.size) ? Math.trunc(set.size) : null,
    };
    const [row] = await this.q
      .insert(art)
      .values({ id: newObjectId(), streamId: normalizeObjectId(streamId), externalId, ...fields })
      .onConflictDoUpdate({
        target: [art.streamId, art.externalId],
        targetWhere: sql`${art.externalId} IS NOT NULL`,
        set: { ...fields, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async listStepComponents(streamId: string, stepExternalId: string): Promise<WorkyPlanStepComponentRecord[]> {
    if (!isObjectId(streamId)) return [];
    return this.q
      .select()
      .from(comp)
      .where(and(eq(comp.streamId, normalizeObjectId(streamId)), eq(comp.stepExternalId, stepExternalId)))
      .orderBy(asc(comp.ordinal), asc(comp.createdAt), asc(comp.id));
  }

  async listStepArtifacts(streamId: string, stepExternalId: string): Promise<WorkyPlanStepArtifactRecord[]> {
    if (!isObjectId(streamId)) return [];
    return this.q
      .select()
      .from(art)
      .where(and(eq(art.streamId, normalizeObjectId(streamId)), eq(art.stepExternalId, stepExternalId)))
      .orderBy(asc(art.createdAt), asc(art.id));
  }

  async findStepArtifact(streamId: string, stepExternalId: string, artifactExternalId: string): Promise<WorkyPlanStepArtifactRecord | null> {
    if (!isObjectId(streamId)) return null;
    const [row] = await this.q
      .select()
      .from(art)
      .where(and(eq(art.streamId, normalizeObjectId(streamId)), eq(art.stepExternalId, stepExternalId), eq(art.externalId, artifactExternalId)))
      .limit(1);
    return row ?? null;
  }

  // ---------------------------------------------------------------- Electric cursors

  async findCursor(shape: string): Promise<WorkyElectricCursorRecord | null> {
    const [row] = await this.q.select().from(cur).where(eq(cur.shape, shape)).limit(1);
    return row ?? null;
  }

  async saveCursor(shape: string, handle: string | null, logOffset: string): Promise<void> {
    await this.q
      .insert(cur)
      .values({ shape, handle, logOffset })
      .onConflictDoUpdate({ target: cur.shape, set: { handle, logOffset, updatedAt: new Date() } });
  }
}
