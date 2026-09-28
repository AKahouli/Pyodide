import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul, withTransaction } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const e = schema.playbookExecutions;
type ExecutionRow = typeof e.$inferSelect;
type Json = Record<string, unknown>;

export type ExecutionStatus = 'queued' | 'running' | 'pending_approval' | 'completed' | 'failed' | 'cancelled';
export type ExecutionMode = 'live' | 'inherit' | 'replay_strict' | 'replay_flex' | 'replay_adaptive';
export type ExecutionAdvisorScoringMode = 'llm' | 'heuristic';

export const EXECUTION_TERMINAL_STATUSES: readonly ExecutionStatus[] = ['completed', 'failed', 'cancelled'];
/** Not terminal yet: what Mongo expressed as `status: { $nin: TERMINAL_STATUSES }`. */
export const EXECUTION_OPEN_STATUSES: readonly ExecutionStatus[] = ['queued', 'running', 'pending_approval'];
/** The statuses that hold one of the owner's concurrency slots. */
export const EXECUTION_ACTIVE_STATUSES: readonly ExecutionStatus[] = ['running', 'pending_approval'];

export interface ExecutionPendingApproval {
  nodeId: string;
  iteration: number;
  prompt: string;
  requestedAt?: Date;
  interruptType?: string;
  interruptId?: string;
  taskTitle?: string;
  taskDescription?: string;
  result?: string;
  payloadJson?: string;
  resumableActions?: string[];
  blockerRuleId?: string;
  blockerKind?: string;
  reasonCode?: string;
  riskLevel?: string;
  confidence?: number;
  downstreamNodeIds?: string[];
  feedbackScopeDefault?: string;
  interruptPayload?: Json;
}

/** The normalised human answer stored on a HITL event. */
export interface ExecutionHitlResponse {
  action: string;
  message?: string | null;
  approved?: boolean | null;
  reason?: string | null;
  feedback?: string | null;
  scope?: string;
  remember?: boolean;
}

/** Immutable per-execution audit entry of one HITL pause and its answer. */
export interface ExecutionHitlEvent {
  id: string;
  nodeId: string;
  iteration: number;
  interruptId: string;
  type: string;
  blockerRuleId?: string | null;
  blockerKind?: string | null;
  reasonCode: string;
  riskLevel: string;
  prompt: string;
  payload: Json;
  status: string;
  response?: ExecutionHitlResponse | null;
  downstreamNodeIds: string[];
  createdAt: Date;
  respondedAt?: Date | null;
}

export interface ExecutionSeededTaskOutput {
  nodeId: string;
  iteration: number;
  payload: Json;
}

export interface ExecutionReplaySource {
  executionId: string;
  taskId: string;
  iteration?: number;
}

/**
 * One playbook.executions row. `snapshot` and `plannerSnapshot` are big (Mongo kept them out of reads
 * with `select: false`): they are `undefined` unless the read asked for them.
 */
export type ExecutionRecord = Omit<
  ExecutionRow,
  | 'status' | 'advisorScoringMode' | 'executionMode' | 'pendingApproval' | 'hitlEvents' | 'seededTaskOutputs'
  | 'stepExecutionModes' | 'replaySource' | 'snapshot' | 'plannerSnapshot'
> & {
  status: ExecutionStatus;
  advisorScoringMode: ExecutionAdvisorScoringMode;
  executionMode: ExecutionMode;
  pendingApproval: ExecutionPendingApproval | null;
  hitlEvents: ExecutionHitlEvent[];
  seededTaskOutputs: ExecutionSeededTaskOutput[];
  stepExecutionModes: Record<string, string>;
  replaySource: ExecutionReplaySource | null;
  snapshot?: Json | null;
  plannerSnapshot?: Json | null;
};

export interface ExecutionReadOptions {
  withSnapshot?: boolean;
  withPlannerSnapshot?: boolean;
}

export interface NewExecution {
  flowId: string;
  ownerId: string;
  recursionLimit: number;
  maxParallelism: number;
  status?: ExecutionStatus;
  playbookExecutionSettings?: Json | null;
  plannerSnapshot?: Json | null;
  inputContext?: Json | null;
  snapshot?: Json | null;
  idempotencyKey?: string | null;
  singleStepTaskId?: string | null;
  advisorAutopilotEnabled?: boolean;
  advisorAutopilotTargetScore?: number | null;
  advisorAutopilotMaxTurns?: number | null;
  reflectionEnabled?: boolean;
  advisorScoringMode?: ExecutionAdvisorScoringMode | null;
  seededTaskOutputs?: ExecutionSeededTaskOutput[];
  executionMode?: ExecutionMode | string | null;
  stepExecutionModes?: Record<string, string>;
  modelIdOverride?: string | null;
  replaySource?: ExecutionReplaySource | null;
}

/** The columns a transition or a plain update may write. `updatedAt` is always bumped. */
export interface ExecutionPatch {
  status?: ExecutionStatus;
  startedAt?: Date | null;
  endedAt?: Date | null;
  error?: string | null;
  queuePosition?: number;
  pendingApproval?: ExecutionPendingApproval | null;
  inputContext?: Json | null;
  playbookExecutionSettings?: Json | null;
  replayPlanningByTask?: Json;
  threadId?: string | null;
}

/** Guard on the pending approval an answer is meant for (Mongo's `'pendingApproval.nodeId'` ... filter). */
export interface PendingApprovalMatch {
  nodeId: string;
  iteration: number;
  /** Checked only when given (a legacy pause may carry none). */
  interruptId?: string;
}

export interface ExecutionTransition {
  /** The statuses the execution must be in; omitted: any status. */
  from?: readonly ExecutionStatus[];
  pendingApproval?: PendingApprovalMatch;
  patch: ExecutionPatch;
}

export interface HitlAnswer extends ExecutionTransition {
  /** Every HITL event of this interrupt is marked answered with `response`. */
  interruptId: string;
  response: ExecutionHitlResponse | Json;
}

export interface ExecutionListOptions {
  statuses?: readonly string[];
  limit?: number;
  offset?: number;
}

const { snapshot: _snapshot, plannerSnapshot: _plannerSnapshot, ...LIGHT_COLUMNS } = getTableColumns(e);

function selection(options: ExecutionReadOptions = {}) {
  return {
    ...LIGHT_COLUMNS,
    ...(options.withSnapshot ? { snapshot: e.snapshot } : {}),
    ...(options.withPlannerSnapshot ? { plannerSnapshot: e.plannerSnapshot } : {}),
  };
}

const HITL_RESPONSE_SCOPE_DEFAULT = 'step_only';

function reviveDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function revivePendingApproval(value: unknown): ExecutionPendingApproval | null {
  if (!value || typeof value !== 'object') return null;
  const approval = value as ExecutionPendingApproval;
  const requestedAt = reviveDate(approval.requestedAt);
  return requestedAt ? { ...approval, requestedAt } : approval;
}

function reviveHitlEvents(value: unknown): ExecutionHitlEvent[] {
  if (!Array.isArray(value)) return [];
  return (value as ExecutionHitlEvent[]).map((event) => ({
    ...event,
    createdAt: reviveDate(event.createdAt) ?? (event.createdAt as Date),
    ...(event.respondedAt != null ? { respondedAt: reviveDate(event.respondedAt) ?? event.respondedAt } : {}),
  }));
}

export function toExecutionRecord(row: Omit<ExecutionRow, 'snapshot' | 'plannerSnapshot'> & Partial<Pick<ExecutionRow, 'snapshot' | 'plannerSnapshot'>>): ExecutionRecord {
  return {
    ...row,
    status: row.status as ExecutionStatus,
    advisorScoringMode: row.advisorScoringMode as ExecutionAdvisorScoringMode,
    executionMode: row.executionMode as ExecutionMode,
    pendingApproval: revivePendingApproval(row.pendingApproval),
    hitlEvents: reviveHitlEvents(row.hitlEvents),
    seededTaskOutputs: (row.seededTaskOutputs ?? []) as unknown as ExecutionSeededTaskOutput[],
    stepExecutionModes: (row.stepExecutionModes ?? {}) as Record<string, string>,
    replaySource: (row.replaySource ?? null) as unknown as ExecutionReplaySource | null,
    snapshot: 'snapshot' in row ? row.snapshot ?? null : undefined,
    plannerSnapshot: 'plannerSnapshot' in row ? row.plannerSnapshot ?? null : undefined,
  };
}

/**
 * The JSON the Mongo document's toJSON() produced: `id`, the Mongo field names (the planner snapshot
 * is `playbookPlannerSnapshot`), and no key for a field that was never set. `pendingApproval` is
 * always present (null when the run is not paused).
 */
export function toExecutionJson(record: ExecutionRecord): Record<string, unknown> {
  const { snapshot, plannerSnapshot, ...fields } = record;
  const json: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined) json[key] = value;
  }
  json.pendingApproval = record.pendingApproval;
  if (snapshot != null) json.snapshot = snapshot;
  if (plannerSnapshot != null) json.playbookPlannerSnapshot = plannerSnapshot;
  return json;
}

const PENDING_APPROVAL_KEYS: ReadonlyArray<keyof ExecutionPendingApproval> = [
  'nodeId', 'iteration', 'prompt', 'requestedAt', 'interruptType', 'interruptId', 'taskTitle', 'taskDescription', 'result',
  'payloadJson', 'resumableActions', 'blockerRuleId', 'blockerKind', 'reasonCode', 'riskLevel', 'confidence',
  'downstreamNodeIds', 'feedbackScopeDefault', 'interruptPayload',
];

/** The PendingApproval subdocument cast: unknown keys dropped, as Mongoose's strict mode did. */
function pendingApprovalJson(value: ExecutionPendingApproval): Json {
  const out: Json = {};
  for (const key of PENDING_APPROVAL_KEYS) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return stripNul(out);
}

/** The HitlResponse subdocument cast: known keys with their schema defaults. */
export function toHitlResponse(value: ExecutionHitlResponse | Json): ExecutionHitlResponse {
  const response = value as Record<string, unknown>;
  const text = (key: string): string | null => (typeof response[key] === 'string' ? stripNul(response[key] as string) : null);
  return {
    action: String(response.action ?? ''),
    message: text('message'),
    approved: typeof response.approved === 'boolean' ? response.approved : null,
    reason: text('reason'),
    feedback: text('feedback'),
    scope: typeof response.scope === 'string' ? response.scope : HITL_RESPONSE_SCOPE_DEFAULT,
    remember: response.remember === true,
  };
}

/** The HitlEventLog subdocument cast: known keys, schema defaults for the missing ones. */
function hitlEventJson(event: Partial<ExecutionHitlEvent>): Json {
  return stripNul({
    id: event.id ?? newObjectId(),
    nodeId: event.nodeId,
    iteration: event.iteration ?? 0,
    interruptId: event.interruptId,
    type: event.type,
    blockerRuleId: event.blockerRuleId ?? null,
    blockerKind: event.blockerKind ?? null,
    reasonCode: event.reasonCode,
    riskLevel: event.riskLevel ?? 'medium',
    prompt: event.prompt,
    payload: event.payload ?? {},
    status: event.status ?? 'pending',
    response: event.response ? toHitlResponse(event.response) : null,
    downstreamNodeIds: event.downstreamNodeIds ?? [],
    createdAt: event.createdAt ?? new Date(),
    respondedAt: event.respondedAt ?? null,
  }) as Json;
}

function int(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function jsonOrNull<T>(value: T | null | undefined): Json | null {
  return value == null ? null : (stripNul(value) as unknown as Json);
}

function textOrNull(value: string | null | undefined): string | null {
  return value == null ? null : stripNul(value);
}

function ids(values: readonly string[]): string[] {
  return values.filter(isObjectId).map(normalizeObjectId);
}

/**
 * PostgreSQL playbook.executions repository (roadmap P5). Every status change is a conditional UPDATE
 * that reports whether its guard held; the queue claim serialises the claimers of one owner so a slot
 * can never be taken twice.
 */
@Injectable()
export class ExecutionRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Creates a run; the returned record carries its snapshots, like the Mongo document did right after save(). */
  async insert(input: NewExecution): Promise<ExecutionRecord> {
    const [row] = await this.q
      .insert(e)
      .values({
        id: newObjectId(),
        flowId: normalizeObjectId(input.flowId),
        ownerId: normalizeObjectId(input.ownerId),
        status: input.status ?? 'queued',
        recursionLimit: int(input.recursionLimit) ?? 25,
        maxParallelism: int(input.maxParallelism) ?? 5,
        playbookExecutionSettings: jsonOrNull(input.playbookExecutionSettings),
        plannerSnapshot: jsonOrNull(input.plannerSnapshot),
        inputContext: jsonOrNull(input.inputContext),
        snapshot: jsonOrNull(input.snapshot),
        idempotencyKey: input.idempotencyKey ?? null,
        singleStepTaskId: input.singleStepTaskId || null,
        advisorAutopilotEnabled: input.advisorAutopilotEnabled ?? false,
        advisorAutopilotTargetScore: input.advisorAutopilotTargetScore ?? null,
        advisorAutopilotMaxTurns: int(input.advisorAutopilotMaxTurns),
        reflectionEnabled: input.reflectionEnabled ?? false,
        advisorScoringMode: input.advisorScoringMode || 'llm',
        seededTaskOutputs: stripNul(input.seededTaskOutputs ?? []) as unknown as Json[],
        executionMode: input.executionMode || 'live',
        stepExecutionModes: input.stepExecutionModes ?? {},
        modelIdOverride: input.modelIdOverride || null,
        replaySource: jsonOrNull(input.replaySource),
      })
      .returning();
    return toExecutionRecord(row);
  }

  async findById(id: string, options?: ExecutionReadOptions): Promise<ExecutionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select(selection(options)).from(e).where(eq(e.id, normalizeObjectId(id))).limit(1);
    return row ? toExecutionRecord(row) : null;
  }

  /** The run only when `ownerId` started it. */
  async findOwned(id: string, ownerId: string, options?: ExecutionReadOptions): Promise<ExecutionRecord | null> {
    if (!isObjectId(id) || !isObjectId(ownerId)) return null;
    const [row] = await this.q
      .select(selection(options))
      .from(e)
      .where(and(eq(e.id, normalizeObjectId(id)), eq(e.ownerId, normalizeObjectId(ownerId))))
      .limit(1);
    return row ? toExecutionRecord(row) : null;
  }

  // ---------------------------------------------------------------- lists

  private flowFilter(flowId: string, statuses?: readonly string[]): SQL {
    return and(eq(e.flowId, normalizeObjectId(flowId)), statuses?.length ? inArray(e.status, [...statuses]) : undefined) as SQL;
  }

  /** A flow's runs, newest first (the execution list, the repeatability report). */
  async listByFlow(flowId: string, options: ExecutionListOptions = {}): Promise<ExecutionRecord[]> {
    if (!isObjectId(flowId)) return [];
    let query = this.q.select(selection()).from(e).where(this.flowFilter(flowId, options.statuses)).orderBy(desc(e.createdAt), desc(e.id)).$dynamic();
    if (options.limit !== undefined) query = query.limit(Math.max(0, Math.trunc(options.limit)));
    if (options.offset) query = query.offset(Math.max(0, Math.trunc(options.offset)));
    return (await query).map(toExecutionRecord);
  }

  async countByFlow(flowId: string, statuses?: readonly string[]): Promise<number> {
    if (!isObjectId(flowId)) return 0;
    const [row] = await this.q.select({ count: sql<number>`count(*)::int` }).from(e).where(this.flowFilter(flowId, statuses));
    return row?.count ?? 0;
  }

  /** The most recently touched runs of the given flows (the assistant's recent-activity view). */
  async listRecentByFlows(flowIds: readonly string[], options: { statuses?: readonly string[]; limit: number }): Promise<ExecutionRecord[]> {
    const flows = ids(flowIds);
    if (flows.length === 0) return [];
    const rows = await this.q
      .select(selection())
      .from(e)
      .where(and(inArray(e.flowId, flows), options.statuses?.length ? inArray(e.status, [...options.statuses]) : undefined))
      .orderBy(desc(e.updatedAt), desc(e.createdAt), asc(e.id))
      .limit(Math.max(0, Math.trunc(options.limit)));
    return rows.map(toExecutionRecord);
  }

  /**
   * Queued, running and paused runs the user started, or that run one of the flows shared with them;
   * newest first.
   */
  async listActive(ownerId: string, sharedFlowIds: readonly string[] = []): Promise<ExecutionRecord[]> {
    if (!isObjectId(ownerId)) return [];
    const shared = ids(sharedFlowIds);
    const rows = await this.q
      .select(selection())
      .from(e)
      .where(and(
        inArray(e.status, [...EXECUTION_OPEN_STATUSES]),
        shared.length ? or(eq(e.ownerId, normalizeObjectId(ownerId)), inArray(e.flowId, shared)) : eq(e.ownerId, normalizeObjectId(ownerId)),
      ))
      .orderBy(desc(e.createdAt), desc(e.id));
    return rows.map(toExecutionRecord);
  }

  /** Whether a run of the flow holds a slot (running or waiting on a human): the scheduler skips the tick. */
  async hasActiveForFlow(flowId: string): Promise<boolean> {
    if (!isObjectId(flowId)) return false;
    const rows = await this.q
      .select({ id: e.id })
      .from(e)
      .where(and(eq(e.flowId, normalizeObjectId(flowId)), inArray(e.status, [...EXECUTION_ACTIVE_STATUSES])))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * The owner's latest finished runs of a flow (completed or failed), snapshot included, newest first:
   * the single-step preparation looks for one whose upstream steps match the current graph.
   */
  async listRecentCompletedWithSnapshot(flowId: string, ownerId: string, limit: number): Promise<ExecutionRecord[]> {
    if (!isObjectId(flowId) || !isObjectId(ownerId)) return [];
    const rows = await this.q
      .select(selection({ withSnapshot: true }))
      .from(e)
      .where(and(
        eq(e.flowId, normalizeObjectId(flowId)),
        eq(e.ownerId, normalizeObjectId(ownerId)),
        inArray(e.status, ['completed', 'failed']),
      ))
      .orderBy(desc(e.createdAt), desc(e.id))
      .limit(Math.max(0, Math.trunc(limit)));
    return rows.map(toExecutionRecord);
  }

  /** The owners that have queued runs (startup recovery drains each of their queues). */
  async distinctOwnersWithQueued(): Promise<string[]> {
    const rows = await this.q.selectDistinct({ ownerId: e.ownerId }).from(e).where(eq(e.status, 'queued'));
    return rows.map((row) => row.ownerId);
  }

  /** Runs still marked running that started at or before `before` (the startup stale-run sweep). */
  async findStaleRunning(before: Date): Promise<ExecutionRecord[]> {
    const rows = await this.q.select(selection()).from(e).where(and(eq(e.status, 'running'), lte(e.startedAt, before)));
    return rows.map(toExecutionRecord);
  }

  // ---------------------------------------------------------------- queue

  async countQueued(ownerId: string, excludeId?: string): Promise<number> {
    if (!isObjectId(ownerId)) return 0;
    const [row] = await this.q
      .select({ count: sql<number>`count(*)::int` })
      .from(e)
      .where(and(
        eq(e.ownerId, normalizeObjectId(ownerId)),
        eq(e.status, 'queued'),
        excludeId && isObjectId(excludeId) ? ne(e.id, normalizeObjectId(excludeId)) : undefined,
      ));
    return row?.count ?? 0;
  }

  /** Running plus paused runs: the slots the owner currently holds. */
  async countActive(ownerId: string): Promise<number> {
    if (!isObjectId(ownerId)) return 0;
    const [row] = await this.q
      .select({ count: sql<number>`count(*)::int` })
      .from(e)
      .where(and(eq(e.ownerId, normalizeObjectId(ownerId)), inArray(e.status, [...EXECUTION_ACTIVE_STATUSES])));
    return row?.count ?? 0;
  }

  /**
   * Promotes the owner's oldest queued run to running when fewer than `maxConcurrent` slots are held,
   * and returns it with its snapshot. Claimers of one owner are serialised by a transaction-scoped
   * advisory lock, so the slot count read after taking it is exact and a slot is never over-claimed;
   * the row itself is taken FOR UPDATE SKIP LOCKED.
   */
  async claimNextQueued(ownerId: string, maxConcurrent: number): Promise<ExecutionRecord | null> {
    if (!isObjectId(ownerId)) return null;
    const owner = normalizeObjectId(ownerId);
    return withTransaction(this.db, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`playbook.execution-queue:${owner}`}, 0))`);
      const next = tx
        .select({ id: e.id })
        .from(e)
        .where(and(eq(e.ownerId, owner), eq(e.status, 'queued')))
        .orderBy(asc(e.createdAt), asc(e.id))
        .limit(1)
        .for('update', { skipLocked: true });
      const [row] = await tx
        .update(e)
        .set({ status: 'running', queuePosition: 0, startedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(e.id, sql`(${next})`),
          sql`(SELECT count(*) FROM ${e} AS held WHERE held.owner_id = ${owner} AND held.status IN ('running', 'pending_approval')) < ${Math.trunc(maxConcurrent)}`,
        ))
        .returning(selection({ withSnapshot: true }));
      return row ? toExecutionRecord(row) : null;
    });
  }

  /**
   * Renumbers the owner's queued runs 1..n by age and returns the ones whose position changed, in
   * queue order (the service streams each change).
   */
  async renumberQueue(ownerId: string): Promise<Array<{ executionId: string; queuePosition: number }>> {
    if (!isObjectId(ownerId)) return [];
    const result = await this.q.execute(sql`
      WITH ranked AS (
        SELECT queued.id, row_number() OVER (ORDER BY queued.created_at, queued.id)::int AS position
        FROM ${e} AS queued
        WHERE queued.owner_id = ${normalizeObjectId(ownerId)} AND queued.status = 'queued'
      )
      UPDATE ${e} AS target SET queue_position = ranked.position, updated_at = now()
      FROM ranked
      WHERE target.id = ranked.id AND target.queue_position <> ranked.position
      RETURNING target.id AS id, target.queue_position AS position`);
    return (result.rows as Array<{ id: string; position: number }>)
      .map((row) => ({ executionId: row.id, queuePosition: Number(row.position) }))
      .sort((a, b) => a.queuePosition - b.queuePosition);
  }

  // ---------------------------------------------------------------- updates

  private toSet(patch: ExecutionPatch): Partial<typeof e.$inferInsert> {
    return {
      status: patch.status,
      startedAt: patch.startedAt,
      endedAt: patch.endedAt,
      error: patch.error === undefined ? undefined : textOrNull(patch.error),
      queuePosition: patch.queuePosition === undefined ? undefined : Math.trunc(patch.queuePosition),
      pendingApproval: patch.pendingApproval === undefined ? undefined : patch.pendingApproval === null ? null : pendingApprovalJson(patch.pendingApproval),
      inputContext: patch.inputContext === undefined ? undefined : jsonOrNull(patch.inputContext),
      playbookExecutionSettings: patch.playbookExecutionSettings === undefined ? undefined : jsonOrNull(patch.playbookExecutionSettings),
      replayPlanningByTask: patch.replayPlanningByTask === undefined ? undefined : (stripNul(patch.replayPlanningByTask) ?? {}),
      threadId: patch.threadId,
      updatedAt: new Date(),
    };
  }

  private guard(id: string, change: Pick<ExecutionTransition, 'from' | 'pendingApproval'>): SQL {
    const match = change.pendingApproval;
    return and(
      eq(e.id, normalizeObjectId(id)),
      change.from ? inArray(e.status, [...change.from]) : undefined,
      match ? sql`${e.pendingApproval} @> jsonb_build_object('nodeId', ${match.nodeId}::text, 'iteration', ${Math.trunc(match.iteration)}::int)` : undefined,
      match?.interruptId ? sql`${e.pendingApproval} ->> 'interruptId' = ${match.interruptId}` : undefined,
    ) as SQL;
  }

  /** Writes fields whatever the status. False when the run does not exist. */
  async update(id: string, patch: ExecutionPatch): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q.update(e).set(this.toSet(patch)).where(eq(e.id, normalizeObjectId(id))).returning({ id: e.id });
    return rows.length > 0;
  }

  /**
   * Applies `patch` only while the run is in one of `from` (and, when given, paused on the matching
   * approval). True when the guard held and the row changed.
   */
  async transition(id: string, change: ExecutionTransition): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q.update(e).set(this.toSet(change.patch)).where(this.guard(id, change)).returning({ id: e.id });
    return rows.length > 0;
  }

  /** The claimed run's dispatch point: stamps the start while it is still running. False: no longer runnable. */
  async markStarted(id: string, replayPlanningByTask: Json): Promise<boolean> {
    return this.transition(id, { from: ['running'], patch: { startedAt: new Date(), queuePosition: 0, replayPlanningByTask } });
  }

  /** Fails the run; with `from`, only while it is in one of those statuses. */
  async markFailed(id: string, error: string, from?: readonly ExecutionStatus[]): Promise<boolean> {
    return this.transition(id, { from, patch: { status: 'failed', endedAt: new Date(), error } });
  }

  /** Puts a running run back at the head of the queue (lease refused, or stale after a restart). */
  async requeueRunning(id: string, options: { clearError?: boolean } = {}): Promise<boolean> {
    return this.transition(id, {
      from: ['running'],
      patch: { status: 'queued', queuePosition: 0, startedAt: null, ...(options.clearError ? { error: null } : {}) },
    });
  }

  /**
   * Pauses an open run on a human decision: sets the pending approval and, when given, appends the
   * audit event in the same statement. False when the run is already terminal.
   */
  async setPendingApproval(id: string, pendingApproval: ExecutionPendingApproval, hitlEvent?: Partial<ExecutionHitlEvent>): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q
      .update(e)
      .set({
        ...this.toSet({ status: 'pending_approval', pendingApproval }),
        ...(hitlEvent ? { hitlEvents: sql`${e.hitlEvents} || jsonb_build_array(${JSON.stringify(hitlEventJson(hitlEvent))}::jsonb)` } : {}),
      })
      .where(this.guard(id, { from: EXECUTION_OPEN_STATUSES }))
      .returning({ id: e.id });
    return rows.length > 0;
  }

  /**
   * Records a human answer: every HITL event of `interruptId` becomes answered with the normalised
   * `response`, and `patch` is applied, all under the transition guard. True when the guard held.
   */
  async answerHitlEvent(id: string, answer: HitlAnswer): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const response = JSON.stringify(toHitlResponse(answer.response));
    const respondedAt = new Date().toISOString();
    const rows = await this.q
      .update(e)
      .set({
        ...this.toSet(answer.patch),
        hitlEvents: sql`COALESCE((
          SELECT jsonb_agg(CASE WHEN ev ->> 'interruptId' = ${answer.interruptId}
            THEN ev || jsonb_build_object('status', 'answered', 'response', ${response}::jsonb, 'respondedAt', ${respondedAt}::text)
            ELSE ev END ORDER BY ord)
          FROM jsonb_array_elements(${e.hitlEvents}) WITH ORDINALITY AS h(ev, ord)), '[]'::jsonb)`,
      })
      .where(this.guard(id, answer))
      .returning({ id: e.id });
    return rows.length > 0;
  }

  /**
   * A HITL interrupt the runtime re-sends after the run finished, or after a human already answered it:
   * the node handler ignores it. False for an unknown run.
   */
  async isInterruptStale(id: string, interruptId: string): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q
      .select({ id: e.id })
      .from(e)
      .where(and(
        eq(e.id, normalizeObjectId(id)),
        or(
          inArray(e.status, [...EXECUTION_TERMINAL_STATUSES]),
          sql`${e.hitlEvents} @> jsonb_build_array(jsonb_build_object('interruptId', ${interruptId}::text, 'status', 'answered'))`,
        ),
      ))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Cancels an open run in one statement: ends it, clears the pause and marks its pending HITL events
   * cancelled. Null when the run is unknown or already terminal.
   */
  async cancelOpen(id: string): Promise<ExecutionRecord | null> {
    if (!isObjectId(id)) return null;
    const now = new Date();
    const [row] = await this.q
      .update(e)
      .set({
        ...this.toSet({ status: 'cancelled', endedAt: now, pendingApproval: null }),
        hitlEvents: sql`COALESCE((
          SELECT jsonb_agg(CASE WHEN ev ->> 'status' = 'pending'
            THEN ev || jsonb_build_object('status', 'cancelled', 'respondedAt', ${now.toISOString()}::text)
            ELSE ev END ORDER BY ord)
          FROM jsonb_array_elements(${e.hitlEvents}) WITH ORDINALITY AS h(ev, ord)), '[]'::jsonb)`,
      })
      .where(this.guard(id, { from: EXECUTION_OPEN_STATUSES }))
      .returning(selection());
    return row ? toExecutionRecord(row) : null;
  }

  // ---------------------------------------------------------------- delete

  /** Deletes the run; its task results and router decisions go with it (foreign keys). */
  async delete(id: string): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q.delete(e).where(eq(e.id, normalizeObjectId(id))).returning({ id: e.id });
    return rows.length > 0;
  }

  /** Deletes the owner's runs of a flow with everything under them; returns how many runs went. */
  async deleteByFlowAndOwner(flowId: string, ownerId: string): Promise<number> {
    if (!isObjectId(flowId) || !isObjectId(ownerId)) return 0;
    const rows = await this.q
      .delete(e)
      .where(and(eq(e.flowId, normalizeObjectId(flowId)), eq(e.ownerId, normalizeObjectId(ownerId))))
      .returning({ id: e.id });
    return rows.length;
  }
}
