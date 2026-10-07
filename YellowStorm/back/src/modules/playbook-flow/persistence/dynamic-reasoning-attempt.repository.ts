import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isForeignKeyViolation, isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const a = schema.playbookDynamicReasoningAttempts;
type AttemptRow = typeof a.$inferSelect;
type Json = Record<string, unknown>;

export type DynamicReasoningAttemptStatus = 'planning' | 'direct' | 'running' | 'completed' | 'failed';

/** One planner proposal or repair of an attempt, appended once per (revision, kind). */
export interface DynamicReasoningRevision {
  revision: number;
  kind: string;
  plan?: unknown;
  validationIssues?: unknown[];
  createdAt?: Date;
  [key: string]: unknown;
}

export type DynamicReasoningAttemptRecord = Omit<AttemptRow, 'status' | 'revisions'> & {
  status: DynamicReasoningAttemptStatus;
  revisions: DynamicReasoningRevision[];
};

/** The natural key of an attempt: one dynamic-reasoning parent task iteration, per attempt number. */
export interface DynamicReasoningAttemptIdentity {
  executionId: string;
  parentTaskId: string;
  parentIteration: number;
  attempt: number;
}

/** The columns an event may write; values are cast like the Mongoose schema cast them. */
export interface DynamicReasoningAttemptPatch {
  status?: DynamicReasoningAttemptStatus;
  subgraphId?: unknown;
  taskFingerprint?: unknown;
  contextFingerprint?: unknown;
  inputContextSummary?: unknown;
  policySnapshot?: unknown;
  plannerSnapshot?: unknown;
  decision?: unknown;
  acceptedRevision?: unknown;
  acceptedPlan?: unknown;
  fallbackReason?: unknown;
  error?: unknown;
  planningStartedAt?: Date | null;
  acceptedAt?: Date | null;
  completedAt?: Date | null;
}

/** Written only when the attempt row is created (Mongo's `$setOnInsert`). */
export interface DynamicReasoningAttemptInsert {
  flowId: string;
}

const TEXT_FIELDS = new Set(['subgraphId', 'taskFingerprint', 'contextFingerprint', 'fallbackReason']);
const JSON_FIELDS = new Set(['inputContextSummary', 'policySnapshot', 'plannerSnapshot', 'decision', 'acceptedPlan', 'error']);

function text(value: unknown): string | null {
  if (value === null) return null;
  return stripNul(typeof value === 'string' ? value : String(value));
}

function integerOrNull(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? Math.trunc(number) : null;
}

function wholeNumber(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** The patch as column values; `undefined` keys are skipped, as Mongoose drops them from updates. */
function toColumns(patch: DynamicReasoningAttemptPatch): Partial<typeof a.$inferInsert> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (TEXT_FIELDS.has(key)) out[key] = text(value);
    else if (JSON_FIELDS.has(key)) out[key] = value === null ? null : stripNul(value);
    else if (key === 'acceptedRevision') out[key] = integerOrNull(value);
    else out[key] = value;
  }
  return out;
}

function reviveRevisions(value: unknown): DynamicReasoningRevision[] {
  if (!Array.isArray(value)) return [];
  return (value as DynamicReasoningRevision[]).map((revision) => {
    const createdAt = typeof revision?.createdAt === 'string' ? new Date(revision.createdAt) : revision?.createdAt;
    return createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) ? { ...revision, createdAt } : revision;
  });
}

export function toDynamicReasoningAttemptRecord(row: AttemptRow): DynamicReasoningAttemptRecord {
  return { ...row, status: row.status as DynamicReasoningAttemptStatus, revisions: reviveRevisions(row.revisions) };
}

/**
 * The JSON the lean Mongo document produced (`id` for `_id`): a field the attempt never had is
 * absent rather than null.
 */
export function toDynamicReasoningAttemptJson(record: DynamicReasoningAttemptRecord): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && value !== undefined) json[key] = value;
  }
  return json;
}

/**
 * PostgreSQL playbook.dynamic_reasoning_attempts repository (roadmap P5). The runtime's dynamic
 * reasoning events upsert one row per (execution, parent task, parent iteration, attempt). The run
 * owns its attempts (foreign key with cascade): a write for a run that is gone is refused by the key
 * and reported as `false`, where Mongo created an orphan.
 */
@Injectable()
export class DynamicReasoningAttemptRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private identity(identity: DynamicReasoningAttemptIdentity): SQL {
    return and(
      eq(a.executionId, normalizeObjectId(identity.executionId)),
      eq(a.parentTaskId, identity.parentTaskId),
      eq(a.parentIteration, wholeNumber(identity.parentIteration)),
      eq(a.attempt, wholeNumber(identity.attempt)),
    )!;
  }

  /**
   * Creates or updates the attempt: `set` is written either way, `setOnInsert` only when the row is
   * new. False when the run is gone (or its id is malformed). A subgraph id already held by another
   * attempt is a unique violation (uq_playbook_dynamic_reasoning_attempts_subgraph), as in Mongo.
   */
  async upsert(identity: DynamicReasoningAttemptIdentity, set: DynamicReasoningAttemptPatch, setOnInsert: DynamicReasoningAttemptInsert): Promise<boolean> {
    if (!isObjectId(identity.executionId) || !isObjectId(setOnInsert.flowId)) return false;
    try {
      await this.q
        .insert(a)
        .values({
          ...toColumns(set),
          id: newObjectId(),
          executionId: normalizeObjectId(identity.executionId),
          flowId: normalizeObjectId(setOnInsert.flowId),
          parentTaskId: identity.parentTaskId,
          parentIteration: wholeNumber(identity.parentIteration),
          attempt: wholeNumber(identity.attempt),
        })
        .onConflictDoUpdate({
          target: [a.executionId, a.parentTaskId, a.parentIteration, a.attempt],
          set: { ...toColumns(set), updatedAt: new Date() },
        });
      return true;
    } catch (err) {
      if (isForeignKeyViolation(err)) return false;
      throw err;
    }
  }

  /**
   * Appends a planner revision unless the attempt already holds one with the same (revision, kind):
   * a replayed event is a no-op. False when nothing was appended (duplicate, or no such attempt).
   */
  async pushRevision(identity: DynamicReasoningAttemptIdentity, revision: DynamicReasoningRevision): Promise<boolean> {
    if (!isObjectId(identity.executionId)) return false;
    const entry = stripNul({ ...revision, createdAt: revision.createdAt ?? new Date() });
    // Serialised once so the guard compares exactly what is stored (a NaN revision becomes null on both sides).
    const key = JSON.stringify([{ revision: entry.revision, kind: entry.kind }]);
    const rows = await this.q
      .update(a)
      .set({ revisions: sql`${a.revisions} || jsonb_build_array(${JSON.stringify(entry)}::jsonb)`, updatedAt: new Date() })
      .where(and(this.identity(identity), sql`NOT (${a.revisions} @> ${key}::jsonb)`))
      .returning({ id: a.id });
    return rows.length > 0;
  }

  async find(identity: DynamicReasoningAttemptIdentity): Promise<DynamicReasoningAttemptRecord | null> {
    if (!isObjectId(identity.executionId)) return null;
    const [row] = await this.q.select().from(a).where(this.identity(identity)).limit(1);
    return row ? toDynamicReasoningAttemptRecord(row) : null;
  }

  /** The run's attempts, oldest first (the execution detail view). */
  async listForExecution(executionId: string): Promise<DynamicReasoningAttemptRecord[]> {
    if (!isObjectId(executionId)) return [];
    const rows = await this.q
      .select()
      .from(a)
      .where(eq(a.executionId, normalizeObjectId(executionId)))
      .orderBy(asc(a.createdAt), asc(a.id));
    return rows.map(toDynamicReasoningAttemptRecord);
  }

  /** The attempts of several runs, oldest first (the stream reconnect snapshot of active runs). */
  async listForExecutions(executionIds: readonly string[]): Promise<DynamicReasoningAttemptRecord[]> {
    const ids = [...new Set(executionIds.filter(isObjectId).map(normalizeObjectId))];
    if (ids.length === 0) return [];
    const rows = await this.q
      .select()
      .from(a)
      .where(inArray(a.executionId, ids))
      .orderBy(asc(a.createdAt), asc(a.id));
    return rows.map(toDynamicReasoningAttemptRecord);
  }
}
