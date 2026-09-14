import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newOwnedId } from '@modules/conversation/persistence/owned-id';
import { UsageType } from '../usage-type.enum';
import type { PlanDocument } from '../schemas/plan.schema';
import type { RecordUsageData } from '../interfaces/usage.interface';
import type {
  UsageAnalyticsResult,
  UsageHistoryResult,
  UsageStore,
  UsageWindowRecord,
} from './usage-store';

@Injectable()
export class PostgresUsageStore implements UsageStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async getOrCreateCurrentWindow(userId: string, plan: PlanDocument): Promise<UsageWindowRecord> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
      const now = new Date();
      const activeRows = await tx
        .select()
        .from(schema.usageWindows)
        .where(
          and(
            eq(schema.usageWindows.userId, userId),
            lte(schema.usageWindows.windowStart, now),
            gt(schema.usageWindows.windowEnd, now),
          ),
        )
        .orderBy(desc(schema.usageWindows.windowStart))
        .limit(1);
      if (activeRows.length) return this.mapWindow(activeRows[0]);
      const [created] = await tx
        .insert(schema.usageWindows)
        .values(this.windowValues(userId, plan, now))
        .returning();
      return this.mapWindow(created);
    });
  }

  async record(data: RecordUsageData, plan: PlanDocument): Promise<UsageWindowRecord> {
    const totalTokens = data.inputTokens + data.outputTokens;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${data.userId}))`);
      const now = new Date();
      const activeRows = await tx
        .select()
        .from(schema.usageWindows)
        .where(
          and(
            eq(schema.usageWindows.userId, data.userId),
            lte(schema.usageWindows.windowStart, now),
            gt(schema.usageWindows.windowEnd, now),
          ),
        )
        .orderBy(desc(schema.usageWindows.windowStart))
        .limit(1);
      const window = activeRows.length
        ? activeRows[0]
        : (
            await tx
              .insert(schema.usageWindows)
              .values(this.windowValues(data.userId, plan, now))
              .returning()
          )[0];
      const [updated] = await tx
        .update(schema.usageWindows)
        .set({
          inputTokens: sql`${schema.usageWindows.inputTokens} + ${data.inputTokens}`,
          outputTokens: sql`${schema.usageWindows.outputTokens} + ${data.outputTokens}`,
          totalTokens: sql`${schema.usageWindows.totalTokens} + ${totalTokens}`,
          requestCount: sql`${schema.usageWindows.requestCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schema.usageWindows.id, window.id))
        .returning();
      await tx.insert(schema.usageLogs).values({
        id: newOwnedId(),
        userId: data.userId,
        usageType: data.usageType ?? UsageType.CHAT,
        modelName: data.modelName,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens,
        durationMs: data.durationMs,
        conversationId: data.conversationId,
        endpoint: data.endpoint,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        success: data.success ?? true,
        errorCode: data.errorCode,
        metadata: data.metadata ?? {},
      });
      return this.mapWindow(updated);
    });
  }

  async getHistory(
    userId: string,
    options: { startDate?: Date; endDate?: Date; limit: number; skip: number },
  ): Promise<UsageHistoryResult> {
    const where = and(
      eq(schema.usageWindows.userId, userId),
      ...(options.startDate ? [gte(schema.usageWindows.windowStart, options.startDate)] : []),
      ...(options.endDate ? [lte(schema.usageWindows.windowStart, options.endDate)] : []),
    );
    const [records, countRows, summaryRows] = await Promise.all([
      this.db
        .select()
        .from(schema.usageWindows)
        .where(where)
        .orderBy(desc(schema.usageWindows.windowStart))
        .limit(options.limit)
        .offset(options.skip),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.usageWindows)
        .where(where),
      this.db
        .select({
          totalInputTokens: sql<number>`COALESCE(sum(${schema.usageWindows.inputTokens}), 0)::float8`,
          totalOutputTokens: sql<number>`COALESCE(sum(${schema.usageWindows.outputTokens}), 0)::float8`,
          totalTokens: sql<number>`COALESCE(sum(${schema.usageWindows.totalTokens}), 0)::float8`,
          totalRequests: sql<number>`COALESCE(sum(${schema.usageWindows.requestCount}), 0)::float8`,
          minDate: sql<Date | null>`min(${schema.usageWindows.windowStart})`,
          maxDate: sql<Date | null>`max(${schema.usageWindows.windowEnd})`,
        })
        .from(schema.usageWindows)
        .where(where),
    ]);
    return {
      records: records.map((row) => this.mapWindow(row)),
      total: countRows[0]?.count ?? 0,
      summary: summaryRows[0] ?? {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalRequests: 0,
        minDate: null,
        maxDate: null,
      },
    };
  }

  async getAnalytics(
    consentingUserIds: string[],
    dateFrom?: Date,
    dateTo?: Date,
    groupBy: 'day' | 'week' | 'month' = 'day',
  ): Promise<UsageAnalyticsResult> {
    if (!consentingUserIds.length) return this.emptyAnalytics();
    const where = this.logWhere(consentingUserIds, dateFrom, dateTo);
    const modelWhere = and(where, isNotNull(schema.usageLogs.modelName));
    const dateExpression =
      groupBy === 'week'
        ? sql<string>`to_char(${schema.usageLogs.createdAt} AT TIME ZONE 'UTC', 'YYYY-"W"IW')`
        : groupBy === 'month'
          ? sql<string>`to_char(${schema.usageLogs.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`
          : sql<string>`to_char(${schema.usageLogs.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    const conversationTotals = this.db
      .select({
        conversationId: schema.usageLogs.conversationId,
        totalTokens: sql<number>`sum(${schema.usageLogs.totalTokens})::float`.as('total_tokens'),
      })
      .from(schema.usageLogs)
      .where(and(where, isNotNull(schema.usageLogs.conversationId)))
      .groupBy(schema.usageLogs.conversationId)
      .as('conversation_totals');
    const [totals, tokensByModel, averages, usageOverTime, errorRates] = await Promise.all([
      this.db
        .select({
          input: sql<number>`COALESCE(sum(${schema.usageLogs.inputTokens}), 0)::float8`,
          output: sql<number>`COALESCE(sum(${schema.usageLogs.outputTokens}), 0)::float8`,
          total: sql<number>`COALESCE(sum(${schema.usageLogs.totalTokens}), 0)::float8`,
        })
        .from(schema.usageLogs)
        .where(where),
      this.db
        .select({
          model: schema.usageLogs.modelName,
          inputTokens: sql<number>`sum(${schema.usageLogs.inputTokens})::float8`,
          outputTokens: sql<number>`sum(${schema.usageLogs.outputTokens})::float8`,
          totalTokens: sql<number>`sum(${schema.usageLogs.totalTokens})::float8`,
          requestCount: sql<number>`count(*)::float8`,
        })
        .from(schema.usageLogs)
        .where(modelWhere)
        .groupBy(schema.usageLogs.modelName)
        .orderBy(desc(sql`sum(${schema.usageLogs.totalTokens})`)),
      this.db
        .select({
          average: sql<number>`COALESCE(avg(${conversationTotals.totalTokens}), 0)::float`,
        })
        .from(conversationTotals),
      this.db
        .select({
          date: dateExpression,
          count: sql<number>`sum(${schema.usageLogs.totalTokens})::float8`,
        })
        .from(schema.usageLogs)
        .where(where)
        .groupBy(dateExpression)
        .orderBy(asc(dateExpression)),
      this.db
        .select({
          model: schema.usageLogs.modelName,
          totalRequests: sql<number>`count(*)::float8`,
          failedRequests: sql<number>`count(*) FILTER (WHERE ${schema.usageLogs.success} = false)::float8`,
        })
        .from(schema.usageLogs)
        .where(modelWhere)
        .groupBy(schema.usageLogs.modelName)
        .orderBy(desc(sql`count(*)`)),
    ]);
    return {
      totalTokens: totals[0] ?? { input: 0, output: 0, total: 0 },
      tokensByModel: tokensByModel.flatMap((row) =>
        row.model ? [{ ...row, model: row.model }] : [],
      ),
      averageTokensPerConversation: Math.round(averages[0]?.average ?? 0),
      usageOverTime,
      errorRates: errorRates.flatMap((row) =>
        row.model
          ? [
              {
                ...row,
                model: row.model,
                errorRate: row.totalRequests
                  ? Math.round((row.failedRequests / row.totalRequests) * 10000) / 100
                  : 0,
              },
            ]
          : [],
      ),
    };
  }

  async deleteLogsBefore(cutoff: Date, limit: number): Promise<number> {
    const result = await this.db.execute(sql`
      DELETE FROM conversation.usage_logs
      WHERE id IN (
        SELECT id FROM conversation.usage_logs
        WHERE created_at < ${cutoff}
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
    `);
    return result.rowCount ?? 0;
  }

  private windowValues(userId: string, plan: PlanDocument, now: Date) {
    const windowStartHour = Math.floor(now.getHours() / plan.windowHours) * plan.windowHours;
    const windowStart = new Date(now);
    windowStart.setHours(windowStartHour, 0, 0, 0);
    const windowEnd = new Date(windowStart);
    windowEnd.setHours(windowEnd.getHours() + plan.windowHours);
    return {
      id: newOwnedId(),
      userId,
      windowStart,
      windowEnd,
      windowHours: plan.windowHours,
      planId: plan._id.toString(),
      planSlug: plan.slug,
      tokenLimitAtCreation: plan.tokenLimit,
    };
  }

  private mapWindow(row: typeof schema.usageWindows.$inferSelect): UsageWindowRecord {
    return {
      ...row,
      id: row.id.trim(),
      planId: row.planId ?? undefined,
      planSlug: row.planSlug ?? undefined,
      tokenLimitAtCreation: row.tokenLimitAtCreation ?? undefined,
    };
  }

  private logWhere(userIds: string[], dateFrom?: Date, dateTo?: Date): SQL {
    return (
      and(
        inArray(schema.usageLogs.userId, userIds),
        ...(dateFrom ? [gte(schema.usageLogs.createdAt, dateFrom)] : []),
        ...(dateTo ? [lte(schema.usageLogs.createdAt, dateTo)] : []),
      ) ?? sql`false`
    );
  }

  private emptyAnalytics(): UsageAnalyticsResult {
    return {
      totalTokens: { input: 0, output: 0, total: 0 },
      tokensByModel: [],
      averageTokensPerConversation: 0,
      usageOverTime: [],
      errorRates: [],
    };
  }
}
