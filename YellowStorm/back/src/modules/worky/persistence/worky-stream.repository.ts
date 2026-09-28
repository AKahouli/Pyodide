import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, exists, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { escapeLike, isObjectId, newObjectId, normalizeObjectId, withTransaction } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  WorkyBudgetEnforcement,
  WorkySharePermission,
  WorkyStreamRecord,
  WorkyStreamShareRecord,
} from '../worky.types';

const s = schema.workyStreams;
const sh = schema.workyStreamShares;
const tk = schema.workyTasks;

type StreamRow = typeof s.$inferSelect;
type ShareRow = typeof sh.$inferSelect;

/** Stream statuses that need the owner's attention, whatever their tasks look like. */
export const ATTENTION_STATUSES = [
  'start_validation_failed',
  'waiting_for_owner',
  'waiting_for_human',
  'waiting_for_budget_decision',
  'partially_blocked',
] as const;

export function toShareRecord(row: ShareRow): WorkyStreamShareRecord {
  return { ...row, permission: row.permission as WorkySharePermission };
}

export function toStreamRecord(row: StreamRow, shares: ShareRow[] = []): WorkyStreamRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    shares: shares.map(toShareRecord),
    workspaceId: row.workspaceId,
    artifactWorkspaceId: row.artifactWorkspaceId,
    managerAgentId: row.managerAgentId,
    managerModelId: row.managerModelId,
    workerModelId: row.workerModelId,
    voicePrompt: row.voicePrompt,
    aiSessionId: row.aiSessionId,
    governancePolicyRef: row.governancePolicyRef,
    title: row.title,
    status: row.status,
    controlState: row.controlState,
    schedulerEnabled: row.schedulerEnabled,
    currentPlanVersion: row.currentPlanVersion,
    executionPlanVersion: row.executionPlanVersion,
    budget: {
      limitUsd: row.budgetLimitUsd,
      limitTokens: row.budgetLimitTokens,
      spendUsd: row.budgetSpendUsd,
      tokensUsed: row.budgetTokensUsed,
      enforcement: row.budgetEnforcement as WorkyBudgetEnforcement,
    },
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    activeDurationMinutes: row.activeDurationMinutes,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface NewWorkyStream {
  ownerUserId: string;
  workspaceId: string;
  title: string;
}

/** The columns a caller may change on a stream. `updatedAt` is always bumped. */
export interface WorkyStreamPatch {
  title?: string;
  managerModelId?: string | null;
  workerModelId?: string | null;
  voicePrompt?: string | null;
  aiSessionId?: string | null;
  status?: string;
  controlState?: string;
  schedulerEnabled?: boolean;
  startedAt?: Date | null;
  completedAt?: Date | null;
  lastActivityAt?: Date;
}

export interface WorkyStreamListQuery {
  search?: string;
  createdFrom?: Date;
  createdTo?: Date;
  statuses?: string[];
  attention?: boolean;
  sort?: 'created' | 'title' | 'lastActivity';
  sortDir?: 'asc' | 'desc';
  page: number;
  limit: number;
}

export interface WorkyStreamListResult {
  items: WorkyStreamRecord[];
  total: number;
  /** Streams in the search/date scope per status, before the status filter. */
  statusCounts: Record<string, number>;
  attentionCount: number;
  /** Task counts per lane for each stream of the page. */
  laneCounts: Map<string, Record<string, number>>;
}

/** PostgreSQL worky.streams and worky.stream_shares repository (roadmap P7). */
@Injectable()
export class WorkyStreamRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(input: NewWorkyStream): Promise<WorkyStreamRecord> {
    const [row] = await this.q
      .insert(s)
      .values({
        id: newObjectId(),
        ownerUserId: normalizeObjectId(input.ownerUserId),
        workspaceId: normalizeObjectId(input.workspaceId),
        title: input.title,
      })
      .returning();
    return toStreamRecord(row);
  }

  /** The stream with its shares, or null. */
  async findById(id: string): Promise<WorkyStreamRecord | null> {
    if (!isObjectId(id)) return null;
    const rows = await this.q
      .select({ stream: s, share: sh })
      .from(s)
      .leftJoin(sh, eq(sh.streamId, s.id))
      .where(eq(s.id, normalizeObjectId(id)))
      .orderBy(asc(sh.createdAt), asc(sh.id));
    if (rows.length === 0) return null;
    return toStreamRecord(rows[0].stream, rows.flatMap((row) => (row.share ? [row.share] : [])));
  }

  /** The stream the manager session `aiSessionId` belongs to. */
  async findByAiSessionId(aiSessionId: string): Promise<{ id: string; ownerUserId: string } | null> {
    if (!aiSessionId) return null;
    const [row] = await this.q
      .select({ id: s.id, ownerUserId: s.ownerUserId })
      .from(s)
      .where(eq(s.aiSessionId, aiSessionId))
      .limit(1);
    return row ?? null;
  }

  /** Another stream of the owner already carries `title`. */
  async titleTaken(ownerUserId: string, title: string, excludeId: string): Promise<boolean> {
    const rows = await this.q
      .select({ id: s.id })
      .from(s)
      .where(and(eq(s.ownerUserId, normalizeObjectId(ownerUserId)), eq(s.title, title), sql`${s.id} <> ${normalizeObjectId(excludeId)}`))
      .limit(1);
    return rows.length > 0;
  }

  async update(id: string, patch: WorkyStreamPatch): Promise<WorkyStreamRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(s)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(s.id, normalizeObjectId(id)))
      .returning();
    if (!row) return null;
    return this.findById(row.id);
  }

  /** Deletes the stream: the foreign keys take its tasks, messages, plan history and mirror rows with it. */
  async delete(id: string): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const streamId = normalizeObjectId(id);
    return withTransaction(this.db, async () => {
      // Audit rows carry a scope id, not a foreign key, so they go explicitly.
      await this.q.delete(schema.workyAuditEvents).where(eq(schema.workyAuditEvents.streamId, streamId));
      const deleted = await this.q.delete(s).where(eq(s.id, streamId)).returning({ id: s.id });
      return deleted.length > 0;
    });
  }

  // ---------------------------------------------------------------- list

  private scope(userId: string, query: Pick<WorkyStreamListQuery, 'search' | 'createdFrom' | 'createdTo'>): SQL {
    const uid = normalizeObjectId(userId);
    return and(
      or(
        eq(s.ownerUserId, uid),
        inArray(s.id, this.q.select({ id: sh.streamId }).from(sh).where(eq(sh.userId, uid))),
      ),
      query.search ? ilike(s.title, `%${escapeLike(query.search)}%`) : undefined,
      query.createdFrom ? gte(s.createdAt, query.createdFrom) : undefined,
      query.createdTo ? lte(s.createdAt, query.createdTo) : undefined,
    ) as SQL;
  }

  private attentionPredicate(): SQL {
    return or(
      inArray(s.status, [...ATTENTION_STATUSES]),
      exists(
        this.q
          .select({ one: sql`1` })
          .from(tk)
          .where(and(eq(tk.streamId, s.id), inArray(tk.lane, ['blocked', 'failed']))),
      ),
    ) as SQL;
  }

  /** The streams the user owns or is shared on, one page of them, plus the counts the home page shows. */
  async listForUser(userId: string, query: WorkyStreamListQuery): Promise<WorkyStreamListResult> {
    if (!isObjectId(userId)) {
      return { items: [], total: 0, statusCounts: {}, attentionCount: 0, laneCounts: new Map() };
    }
    const scope = this.scope(userId, query);
    const filter = and(
      scope,
      query.statuses?.length ? inArray(s.status, query.statuses) : undefined,
      query.attention ? this.attentionPredicate() : undefined,
    ) as SQL;

    const dir = query.sortDir === 'asc' ? asc : desc;
    const order =
      query.sort === 'created' ? [dir(s.createdAt), desc(s.id)]
        : query.sort === 'title' ? [dir(sql`${s.title} COLLATE "C"`), asc(s.id)]
          : [dir(s.lastActivityAt), desc(s.createdAt), desc(s.id)];

    const [statusRows, attentionRows, totalRows, pageRows] = await Promise.all([
      this.q.select({ status: s.status, count: sql<number>`count(*)::int` }).from(s).where(scope).groupBy(s.status),
      this.q.select({ count: sql<number>`count(*)::int` }).from(s).where(and(scope, this.attentionPredicate())),
      this.q.select({ count: sql<number>`count(*)::int` }).from(s).where(filter),
      this.q.select().from(s).where(filter).orderBy(...order).limit(query.limit).offset((query.page - 1) * query.limit),
    ]);

    const ids = pageRows.map((row) => row.id);
    const [shareRows, laneRows] = ids.length
      ? await Promise.all([
        this.q.select().from(sh).where(inArray(sh.streamId, ids)).orderBy(asc(sh.createdAt), asc(sh.id)),
        this.q
          .select({ streamId: tk.streamId, lane: tk.lane, count: sql<number>`count(*)::int` })
          .from(tk)
          .where(inArray(tk.streamId, ids))
          .groupBy(tk.streamId, tk.lane),
      ])
      : [[], []];

    const sharesByStream = new Map<string, ShareRow[]>();
    for (const row of shareRows) sharesByStream.set(row.streamId, [...(sharesByStream.get(row.streamId) ?? []), row]);
    const laneCounts = new Map<string, Record<string, number>>();
    for (const row of laneRows) laneCounts.set(row.streamId, { ...(laneCounts.get(row.streamId) ?? {}), [row.lane]: row.count });

    return {
      items: pageRows.map((row) => toStreamRecord(row, sharesByStream.get(row.id) ?? [])),
      total: totalRows[0]?.count ?? 0,
      statusCounts: Object.fromEntries(statusRows.map((row) => [row.status, row.count])),
      attentionCount: attentionRows[0]?.count ?? 0,
      laneCounts,
    };
  }

  // ---------------------------------------------------------------- shares

  async listShares(streamId: string): Promise<WorkyStreamShareRecord[]> {
    if (!isObjectId(streamId)) return [];
    const rows = await this.q.select().from(sh).where(eq(sh.streamId, normalizeObjectId(streamId))).orderBy(asc(sh.createdAt), asc(sh.id));
    return rows.map(toShareRecord);
  }

  /** Grants `userId` access, or changes the permission they already have. */
  async upsertShare(streamId: string, userId: string, permission: WorkySharePermission): Promise<WorkyStreamShareRecord> {
    const [row] = await this.q
      .insert(sh)
      .values({ id: newObjectId(), streamId: normalizeObjectId(streamId), userId: normalizeObjectId(userId), permission })
      .onConflictDoUpdate({ target: [sh.streamId, sh.userId], set: { permission, updatedAt: new Date() } })
      .returning();
    return toShareRecord(row);
  }

  async updateSharePermission(streamId: string, shareId: string, permission: WorkySharePermission): Promise<WorkyStreamShareRecord | null> {
    if (!isObjectId(streamId) || !isObjectId(shareId)) return null;
    const [row] = await this.q
      .update(sh)
      .set({ permission, updatedAt: new Date() })
      .where(and(eq(sh.id, normalizeObjectId(shareId)), eq(sh.streamId, normalizeObjectId(streamId))))
      .returning();
    return row ? toShareRecord(row) : null;
  }

  /** Removes a share and returns it (the caller needs the user it belonged to), or null. */
  async deleteShare(streamId: string, shareId: string): Promise<WorkyStreamShareRecord | null> {
    if (!isObjectId(streamId) || !isObjectId(shareId)) return null;
    const [row] = await this.q
      .delete(sh)
      .where(and(eq(sh.id, normalizeObjectId(shareId)), eq(sh.streamId, normalizeObjectId(streamId))))
      .returning();
    return row ? toShareRecord(row) : null;
  }

  // ---------------------------------------------------------------- plan version and budget

  /**
   * Linearisation point of a plan delta: moves currentPlanVersion from `expected` to the next number
   * only if nobody else did. False means a concurrent delta won.
   */
  async advancePlanVersion(id: string, expected: number): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q
      .update(s)
      .set({ currentPlanVersion: sql`${s.currentPlanVersion} + 1`, lastActivityAt: new Date(), updatedAt: new Date() })
      .where(and(eq(s.id, normalizeObjectId(id)), eq(s.currentPlanVersion, expected)))
      .returning({ id: s.id });
    return rows.length > 0;
  }

  /**
   * Atomic reservation against the budget: adds the amounts to the counters only while a limited
   * dimension stays within its limit (a limit of 0 means unlimited). False means the budget would be
   * exceeded and nothing changed.
   */
  async reserveBudget(id: string, amountUsd: number, tokens: number): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q
      .update(s)
      .set({
        budgetSpendUsd: sql`${s.budgetSpendUsd} + ${amountUsd}`,
        budgetTokensUsed: sql`${s.budgetTokensUsed} + ${tokens}`,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.id, normalizeObjectId(id)),
        sql`(${s.budgetLimitUsd} = 0 OR ${s.budgetSpendUsd} + ${amountUsd} <= ${s.budgetLimitUsd})`,
        sql`(${s.budgetLimitTokens} = 0 OR ${s.budgetTokensUsed} + ${tokens} <= ${s.budgetLimitTokens})`,
      ))
      .returning({ id: s.id });
    return rows.length > 0;
  }

  /** Gives a reservation back. The counters never go below zero. */
  async releaseBudget(id: string, amountUsd: number, tokens: number): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(s)
      .set({
        budgetSpendUsd: sql`GREATEST(${s.budgetSpendUsd} - ${amountUsd}, 0)`,
        budgetTokensUsed: sql`GREATEST(${s.budgetTokensUsed} - ${tokens}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(s.id, normalizeObjectId(id)));
  }

  async setBudgetLimits(id: string, limits: { limitUsd: number; limitTokens: number; enforcement: WorkyBudgetEnforcement }): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(s)
      .set({
        budgetLimitUsd: limits.limitUsd,
        budgetLimitTokens: limits.limitTokens,
        budgetEnforcement: limits.enforcement,
        updatedAt: new Date(),
      })
      .where(eq(s.id, normalizeObjectId(id)));
  }
}
