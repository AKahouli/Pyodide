import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isForeignKeyViolation, isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const t = schema.playbookTaskResults;
type TaskResultRow = typeof t.$inferSelect;
type Json = Record<string, unknown>;

export type TaskResultStatus = 'pending' | 'running' | 'interrupted' | 'completed' | 'failed' | 'skipped' | 'cancelled';
export type TaskResultJudgeStatus = 'idle' | 'evaluating' | 'evaluated' | 'failed';
export type TaskResultScoringMode = 'llm' | 'heuristic';

/** A task that has not settled yet: the run's end moves these to its own outcome. */
export const TASK_RESULT_OPEN_STATUSES: readonly TaskResultStatus[] = ['pending', 'running', 'interrupted'];

export interface TaskJudgeHistoryEntry {
  id: string;
  createdAt: Date;
  attemptNumber?: number | null;
  model?: string | null;
  scoringMode?: TaskResultScoringMode;
  usage?: Json | null;
  llmPromptTrace?: Json[];
  judgeResult: Json;
}

export type TaskResultRecord = Omit<TaskResultRow, 'status' | 'judgeStatus' | 'judgeScoringMode' | 'judgeHistory'> & {
  status: TaskResultStatus;
  judgeStatus: TaskResultJudgeStatus;
  judgeScoringMode: TaskResultScoringMode | null;
  judgeHistory: TaskJudgeHistoryEntry[];
};

/**
 * The document-sized columns (a row reaches several MB). A light read leaves them out; `with` brings
 * back the few a caller needs.
 */
export const TASK_RESULT_HEAVY_FIELDS = [
  'output', 'displayText', 'outputs', 'artifacts', 'components', 'iteratorIterations', 'toolTrace', 'reasoningChain',
  'llmPromptTrace', 'semanticMatch', 'traceMetadata', 'judgeResult', 'judgeHistory',
] as const;
export type TaskResultHeavyField = (typeof TASK_RESULT_HEAVY_FIELDS)[number];

/** A light read: status, ids, timings, usage, judge state, and only the heavy fields listed in `with`. */
export type TaskResultSummary = Omit<TaskResultRecord, TaskResultHeavyField> & Partial<Pick<TaskResultRecord, TaskResultHeavyField>>;

export interface TaskResultKey {
  executionId: string;
  taskId: string;
  iteration: number;
}

export interface TaskResultLightRead {
  light: true;
  with?: readonly TaskResultHeavyField[];
}

export interface TaskResultQuery {
  taskIds?: readonly string[];
  statuses?: readonly TaskResultStatus[];
  /**
   * task: by task id then iteration (the default); ended: by end time, unfinished first; latest:
   * highest iteration first, then latest end; recentlyStarted: latest start first, then highest iteration.
   */
  order?: 'task' | 'ended' | 'latest' | 'recentlyStarted';
}

/** The columns a caller may write. `updatedAt` is always bumped. */
export interface TaskResultPatch {
  status?: TaskResultStatus;
  parentTaskId?: string | null;
  runtimeSubgraphId?: string | null;
  generatedLocalNodeId?: string | null;
  generatedNodeTitle?: string | null;
  output?: unknown;
  displayText?: string | null;
  outputs?: Json | null;
  artifacts?: Json[] | null;
  components?: Json[] | null;
  iteratorIterations?: Json[] | null;
  error?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  toolTrace?: Json[] | null;
  reasoningChain?: Json[] | null;
  llmPromptTrace?: Json[] | null;
  usage?: Json | null;
  semanticMatch?: Json | null;
  traceMetadata?: Json | null;
  judgeStatus?: TaskResultJudgeStatus;
  judgeResult?: Json | null;
  judgeScoringMode?: TaskResultScoringMode | null;
  judgeError?: string | null;
}

export type TaskResultJudgePatch = Pick<TaskResultPatch, 'judgeStatus' | 'judgeResult' | 'judgeScoringMode' | 'judgeError'>;

/** A task result carrying an artifact component, with the flow and run it belongs to. */
export interface RecentArtifactTaskResult {
  flowId: string;
  flowName: string;
  executionId: string;
  executionOwnerId: string;
  executionUpdatedAt: Date;
  taskResult: Pick<TaskResultRecord, 'id' | 'taskId' | 'iteration' | 'components' | 'endedAt' | 'updatedAt'>;
  /** endedAt, else updatedAt. */
  generatedAt: Date;
}

const columns = getTableColumns(t);
/**
 * `output` is read raw: drizzle's jsonb decoder parses a string value a second time, which turns a
 * task output that happens to be JSON text ("42", "{...}") into a number or an object.
 */
const FULL_SELECTION = { ...columns, output: sql<unknown>`${t.output}` };
const LIGHT_SELECTION = Object.fromEntries(
  Object.entries(FULL_SELECTION).filter(([key]) => !(TASK_RESULT_HEAVY_FIELDS as readonly string[]).includes(key)),
) as Omit<typeof FULL_SELECTION, TaskResultHeavyField>;

function selection(read?: TaskResultLightRead | Record<string, unknown>) {
  if (!read || (read as TaskResultLightRead).light !== true) return FULL_SELECTION;
  const extra = Object.fromEntries(((read as TaskResultLightRead).with ?? []).map((key) => [key, FULL_SELECTION[key]]));
  return { ...LIGHT_SELECTION, ...extra } as typeof FULL_SELECTION;
}

function reviveJudgeHistory(value: unknown): TaskJudgeHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return (value as TaskJudgeHistoryEntry[]).map((entry) => {
    const createdAt = typeof entry?.createdAt === 'string' ? new Date(entry.createdAt) : entry?.createdAt;
    return createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) ? { ...entry, createdAt } : entry;
  });
}

export function toTaskResultRecord(row: Partial<TaskResultRow>): TaskResultRecord {
  const record = {
    ...row,
    status: row.status as TaskResultStatus,
    judgeStatus: (row.judgeStatus ?? 'idle') as TaskResultJudgeStatus,
    judgeScoringMode: (row.judgeScoringMode ?? null) as TaskResultScoringMode | null,
  } as unknown as TaskResultRecord;
  if ('judgeHistory' in row) record.judgeHistory = reviveJudgeHistory(row.judgeHistory);
  return record;
}

const TEXT_FIELDS = new Set(['parentTaskId', 'runtimeSubgraphId', 'generatedLocalNodeId', 'generatedNodeTitle', 'displayText', 'error', 'judgeError']);
const JSON_FIELDS = new Set(['output', 'outputs', 'artifacts', 'components', 'iteratorIterations', 'usage', 'semanticMatch', 'judgeResult']);
/** NOT NULL jsonb columns: a null write means their empty default, as the Mongoose defaults did. */
const ARRAY_FIELDS = new Set(['toolTrace', 'reasoningChain', 'llmPromptTrace']);

function toColumns(patch: TaskResultPatch): Partial<typeof t.$inferInsert> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (TEXT_FIELDS.has(key)) out[key] = value === null ? null : stripNul(String(value));
    else if (JSON_FIELDS.has(key)) out[key] = value === null ? null : stripNul(value);
    else if (ARRAY_FIELDS.has(key)) out[key] = stripNul(value ?? []);
    else if (key === 'traceMetadata') out[key] = stripNul(value ?? {});
    else out[key] = value;
  }
  return out as Partial<typeof t.$inferInsert>;
}

function iterationOf(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/**
 * PostgreSQL playbook.task_results repository (roadmap P5). One row per (execution, task, iteration):
 * the runtime handlers upsert it event by event. A write for a run that no longer exists is refused
 * by the foreign key and reported as `false` (Mongo created an orphan).
 */
@Injectable()
export class TaskResultRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private key(key: TaskResultKey): SQL {
    return and(
      eq(t.executionId, normalizeObjectId(key.executionId)),
      eq(t.taskId, stripNul(key.taskId)),
      eq(t.iteration, iterationOf(key.iteration)),
    ) as SQL;
  }

  private filter(query: TaskResultQuery): SQL | undefined {
    return and(
      query.taskIds ? (query.taskIds.length ? inArray(t.taskId, query.taskIds.map((id) => stripNul(id))) : sql`false`) : undefined,
      query.statuses?.length ? inArray(t.status, [...query.statuses]) : undefined,
    );
  }

  private order(order: TaskResultQuery['order'] = 'task'): SQL[] {
    switch (order) {
      case 'ended':
        return [sql`${t.endedAt} ASC NULLS FIRST`, asc(t.id)];
      case 'latest':
        return [desc(t.iteration), sql`${t.endedAt} DESC NULLS LAST`, asc(t.id)];
      case 'recentlyStarted':
        return [sql`${t.startedAt} DESC NULLS LAST`, desc(t.iteration), asc(t.id)];
      default:
        // Mongo compared task ids byte-wise.
        return [sql`${t.taskId} COLLATE "C"`, asc(t.iteration), asc(t.id)];
    }
  }

  // ---------------------------------------------------------------- reads

  find(key: TaskResultKey): Promise<TaskResultRecord | null>;
  find(key: TaskResultKey, read: TaskResultLightRead): Promise<TaskResultSummary | null>;
  async find(key: TaskResultKey, read?: TaskResultLightRead): Promise<TaskResultRecord | null> {
    if (!isObjectId(key.executionId)) return null;
    const [row] = await this.q.select(selection(read)).from(t).where(this.key(key)).limit(1);
    return row ? toTaskResultRecord(row) : null;
  }

  /** The task's highest iteration (optionally among the given statuses). */
  findLatestForTask(executionId: string, taskId: string, options?: { statuses?: readonly TaskResultStatus[] }): Promise<TaskResultRecord | null>;
  findLatestForTask(executionId: string, taskId: string, options: { statuses?: readonly TaskResultStatus[] } & TaskResultLightRead): Promise<TaskResultSummary | null>;
  async findLatestForTask(
    executionId: string,
    taskId: string,
    options: { statuses?: readonly TaskResultStatus[] } & Partial<TaskResultLightRead> = {},
  ): Promise<TaskResultRecord | null> {
    if (!isObjectId(executionId)) return null;
    const [row] = await this.q
      .select(selection(options as TaskResultLightRead))
      .from(t)
      .where(and(eq(t.executionId, normalizeObjectId(executionId)), eq(t.taskId, stripNul(taskId)), this.filter({ statuses: options.statuses })))
      .orderBy(...this.order('latest'))
      .limit(1);
    return row ? toTaskResultRecord(row) : null;
  }

  /** The run's most recently ended failed task (its error becomes the run's error). Light. */
  async findLatestFailed(executionId: string): Promise<TaskResultSummary | null> {
    if (!isObjectId(executionId)) return null;
    const [row] = await this.q
      .select(LIGHT_SELECTION)
      .from(t)
      .where(and(eq(t.executionId, normalizeObjectId(executionId)), eq(t.status, 'failed')))
      .orderBy(sql`${t.endedAt} DESC NULLS LAST`, asc(t.id))
      .limit(1);
    return row ? toTaskResultRecord(row) : null;
  }

  listForExecution(executionId: string, query?: TaskResultQuery): Promise<TaskResultRecord[]>;
  listForExecution(executionId: string, query: TaskResultQuery & TaskResultLightRead): Promise<TaskResultSummary[]>;
  async listForExecution(executionId: string, query: TaskResultQuery & Partial<TaskResultLightRead> = {}): Promise<TaskResultRecord[]> {
    if (!isObjectId(executionId)) return [];
    const rows = await this.q
      .select(selection(query as TaskResultLightRead))
      .from(t)
      .where(and(eq(t.executionId, normalizeObjectId(executionId)), this.filter(query)))
      .orderBy(...this.order(query.order));
    return rows.map(toTaskResultRecord);
  }

  listForExecutions(executionIds: readonly string[], query?: TaskResultQuery): Promise<TaskResultRecord[]>;
  listForExecutions(executionIds: readonly string[], query: TaskResultQuery & TaskResultLightRead): Promise<TaskResultSummary[]>;
  async listForExecutions(executionIds: readonly string[], query: TaskResultQuery & Partial<TaskResultLightRead> = {}): Promise<TaskResultRecord[]> {
    const ids = executionIds.filter(isObjectId).map(normalizeObjectId);
    if (ids.length === 0) return [];
    const rows = await this.q
      .select(selection(query as TaskResultLightRead))
      .from(t)
      .where(and(inArray(t.executionId, ids), this.filter(query)))
      .orderBy(...this.order(query.order));
    return rows.map(toTaskResultRecord);
  }

  /**
   * The task results that carry an artifact component, across the runs of the flows the user owns or
   * is shared on, most recently generated first.
   */
  async listRecentArtifacts(userId: string, sharedFlowIds: readonly string[], limit: number): Promise<RecentArtifactTaskResult[]> {
    if (!isObjectId(userId)) return [];
    const f = schema.playbookFlows;
    const e = schema.playbookExecutions;
    const shared = sharedFlowIds.filter(isObjectId).map(normalizeObjectId);
    const generatedAt = sql<Date>`COALESCE(${t.endedAt}, ${t.updatedAt})`;
    const rows = await this.q
      .select({
        flowId: f.id,
        flowName: f.name,
        executionId: e.id,
        executionOwnerId: e.ownerId,
        executionUpdatedAt: e.updatedAt,
        id: t.id,
        taskId: t.taskId,
        iteration: t.iteration,
        components: t.components,
        endedAt: t.endedAt,
        updatedAt: t.updatedAt,
        generatedAt: generatedAt.mapWith(t.updatedAt),
      })
      .from(t)
      .innerJoin(e, eq(e.id, t.executionId))
      .innerJoin(f, eq(f.id, e.flowId))
      .where(and(
        shared.length ? or(eq(f.ownerId, normalizeObjectId(userId)), inArray(f.id, shared)) : eq(f.ownerId, normalizeObjectId(userId)),
        sql`${t.components} @> '[{"type":"artifact"}]'::jsonb`,
      ))
      .orderBy(desc(generatedAt), asc(t.id))
      .limit(Math.max(0, Math.trunc(limit)));
    return rows.map((row) => ({
      flowId: row.flowId,
      flowName: row.flowName,
      executionId: row.executionId,
      executionOwnerId: row.executionOwnerId,
      executionUpdatedAt: row.executionUpdatedAt,
      taskResult: { id: row.id, taskId: row.taskId, iteration: row.iteration, components: row.components, endedAt: row.endedAt, updatedAt: row.updatedAt },
      generatedAt: row.generatedAt,
    }));
  }

  // ---------------------------------------------------------------- writes

  /**
   * Creates or updates the (execution, task, iteration) row: `set` is written either way, `setOnInsert`
   * only when the row is new (Mongo's `$set` / `$setOnInsert` upsert). False when the run is gone.
   */
  async upsert(key: TaskResultKey, set: TaskResultPatch, setOnInsert: TaskResultPatch = {}): Promise<boolean> {
    if (!isObjectId(key.executionId)) return false;
    try {
      await this.q
        .insert(t)
        .values({
          ...toColumns({ ...setOnInsert, ...set }),
          id: newObjectId(),
          executionId: normalizeObjectId(key.executionId),
          taskId: stripNul(key.taskId),
          iteration: iterationOf(key.iteration),
        })
        .onConflictDoUpdate({
          target: [t.executionId, t.taskId, t.iteration],
          set: { ...toColumns(set), updatedAt: new Date() },
        });
      return true;
    } catch (err) {
      if (isForeignKeyViolation(err)) return false;
      throw err;
    }
  }

  /** Appends a streamed token to the task's text output and marks it running (creating the row if needed). */
  async appendOutput(key: TaskResultKey, token: string): Promise<boolean> {
    if (!isObjectId(key.executionId)) return false;
    const text = stripNul(token);
    try {
      await this.q
        .insert(t)
        .values({
          id: newObjectId(),
          executionId: normalizeObjectId(key.executionId),
          taskId: stripNul(key.taskId),
          iteration: iterationOf(key.iteration),
          status: 'running',
          output: text,
        })
        .onConflictDoUpdate({
          target: [t.executionId, t.taskId, t.iteration],
          set: {
            status: 'running',
            output: sql`to_jsonb(COALESCE(${t.output} #>> '{}', '') || ${text}::text)`,
            updatedAt: new Date(),
          },
        });
      return true;
    } catch (err) {
      if (isForeignKeyViolation(err)) return false;
      throw err;
    }
  }

  /** Writes `patch` to the run's tasks that are in one of `statuses`; returns how many changed. */
  async updateManyForExecution(executionId: string, where: { statuses: readonly TaskResultStatus[] }, patch: TaskResultPatch): Promise<number> {
    if (!isObjectId(executionId) || where.statuses.length === 0) return 0;
    const rows = await this.q
      .update(t)
      .set({ ...toColumns(patch), updatedAt: new Date() })
      .where(and(eq(t.executionId, normalizeObjectId(executionId)), inArray(t.status, [...where.statuses])))
      .returning({ id: t.id });
    return rows.length;
  }

  /** Writes the judge state of one task result. False when it does not exist. */
  async updateJudge(id: string, patch: TaskResultJudgePatch): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q
      .update(t)
      .set({ ...toColumns(patch), updatedAt: new Date() })
      .where(eq(t.id, normalizeObjectId(id)))
      .returning({ id: t.id });
    return rows.length > 0;
  }

  /** Appends one evaluation to the judge history, together with the judge state it produced. */
  async pushJudgeHistory(id: string, entry: TaskJudgeHistoryEntry | Json, patch: TaskResultJudgePatch = {}): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q
      .update(t)
      .set({
        ...toColumns(patch),
        judgeHistory: sql`${t.judgeHistory} || jsonb_build_array(${JSON.stringify(stripNul(entry))}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(t.id, normalizeObjectId(id)))
      .returning({ id: t.id });
    return rows.length > 0;
  }
}
