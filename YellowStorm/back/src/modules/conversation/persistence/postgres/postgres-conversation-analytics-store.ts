import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { GroupByPeriod } from '@modules/analytics/dto';
import type {
  ConversationAnalyticsResponse,
  QualityAnalyticsResponse,
} from '@modules/analytics/interfaces';
import type { ConversationAnalyticsStore } from '../conversation-analytics-store';

@Injectable()
export class PostgresConversationAnalyticsStore implements ConversationAnalyticsStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async getConversationAnalytics(
    consentingUserIds: string[],
    dateFrom?: Date,
    dateTo?: Date,
    groupBy: GroupByPeriod = GroupByPeriod.DAY,
  ): Promise<ConversationAnalyticsResponse> {
    if (!consentingUserIds.length)
      return {
        totalConversations: 0,
        messagesPerConversation: { average: 0, min: 0, max: 0 },
        conversationsOverTime: [],
        componentTypeDistribution: [],
        averageConversationDurationMs: 0,
      };
    const owner = this.conversationWhere(consentingUserIds, dateFrom, dateTo);
    const [stats] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        average: sql<number>`COALESCE(round(avg(${schema.conversations.messageCount})::numeric, 2), 0)::float`,
        min: sql<number>`COALESCE(min(${schema.conversations.messageCount}), 0)::int`,
        max: sql<number>`COALESCE(max(${schema.conversations.messageCount}), 0)::int`,
        duration: sql<number>`COALESCE(round(avg(EXTRACT(EPOCH FROM (${schema.conversations.lastMessageAt} - ${schema.conversations.createdAt})) * 1000)), 0)::float`,
      })
      .from(schema.conversations)
      .where(owner);
    const dateExpression =
      groupBy === GroupByPeriod.WEEK
        ? sql<string>`to_char(${schema.conversations.createdAt} AT TIME ZONE 'UTC', 'IYYY-"W"IW')`
        : groupBy === GroupByPeriod.MONTH
          ? sql<string>`to_char(${schema.conversations.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`
          : sql<string>`to_char(${schema.conversations.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    const timeRows = await this.db
      .select({ date: dateExpression, count: sql<number>`count(*)::int` })
      .from(schema.conversations)
      .where(owner)
      .groupBy(dateExpression)
      .orderBy(asc(dateExpression));
    const messageWhere = and(
      inArray(schema.conversations.createdBy, consentingUserIds),
      eq(schema.messages.conversationType, 'ai'),
      ...(dateFrom ? [gte(schema.conversations.createdAt, dateFrom)] : []),
      ...(dateTo ? [lte(schema.conversations.createdAt, dateTo)] : []),
      ...(dateFrom ? [gte(schema.messages.createdAt, dateFrom)] : []),
      ...(dateTo ? [lte(schema.messages.createdAt, dateTo)] : []),
    );
    const componentRows = await this.db
      .select({ type: sql<string>`component->>'type'`, count: sql<number>`count(*)::int` })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .innerJoin(
        sql`LATERAL jsonb_array_elements(COALESCE(${schema.messages.components}, '[]'::jsonb)) AS component`,
        sql`true`,
      )
      .where(messageWhere)
      .groupBy(sql`component->>'type'`)
      .orderBy(desc(sql`count(*)`));
    const componentTotal = componentRows.reduce((sum, row) => sum + row.count, 0);
    return {
      totalConversations: stats?.total ?? 0,
      messagesPerConversation: {
        average: stats?.average ?? 0,
        min: stats?.min ?? 0,
        max: stats?.max ?? 0,
      },
      conversationsOverTime: timeRows,
      componentTypeDistribution: componentRows.map((row) => ({
        type: row.type,
        count: row.count,
        percentage: componentTotal ? Math.round((row.count / componentTotal) * 10000) / 100 : 0,
      })),
      averageConversationDurationMs: Math.round(stats?.duration ?? 0),
    };
  }

  async getQualityAnalytics(
    consentingUserIds: string[],
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<QualityAnalyticsResponse> {
    if (!consentingUserIds.length)
      return {
        feedbackDistribution: { likes: 0, dislikes: 0, none: 0 },
        feedbackRate: 0,
        reportsByCategory: [],
        totalReports: 0,
        regenerationRate: 0,
      };
    const messageWhere = and(
      inArray(schema.conversations.createdBy, consentingUserIds),
      eq(schema.messages.conversationType, 'ai'),
      ...(dateFrom ? [gte(schema.conversations.createdAt, dateFrom)] : []),
      ...(dateTo ? [lte(schema.conversations.createdAt, dateTo)] : []),
      ...(dateFrom ? [gte(schema.messages.createdAt, dateFrom)] : []),
      ...(dateTo ? [lte(schema.messages.createdAt, dateTo)] : []),
    );
    const [feedback] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        likes: sql<number>`count(*) FILTER (WHERE ${schema.messages.feedback} = 'like')::int`,
        dislikes: sql<number>`count(*) FILTER (WHERE ${schema.messages.feedback} = 'dislike')::int`,
        none: sql<number>`count(*) FILTER (WHERE ${schema.messages.feedback} IS NULL)::int`,
        edited: sql<number>`count(*) FILTER (WHERE ${schema.messages.isEdited} = true)::int`,
      })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .where(messageWhere);
    const reportWhere = and(
      inArray(schema.reports.userId, consentingUserIds),
      ...(dateFrom ? [gte(schema.reports.createdAt, dateFrom)] : []),
      ...(dateTo ? [lte(schema.reports.createdAt, dateTo)] : []),
    );
    const reportsByCategory = await this.db
      .select({ category: schema.reports.reason, count: sql<number>`count(*)::int` })
      .from(schema.reports)
      .where(reportWhere)
      .groupBy(schema.reports.reason)
      .orderBy(desc(sql`count(*)`));
    const total = feedback?.total ?? 0;
    const withFeedback = (feedback?.likes ?? 0) + (feedback?.dislikes ?? 0);
    return {
      feedbackDistribution: {
        likes: feedback?.likes ?? 0,
        dislikes: feedback?.dislikes ?? 0,
        none: feedback?.none ?? 0,
      },
      feedbackRate: total ? Math.round((withFeedback / total) * 10000) / 100 : 0,
      reportsByCategory,
      totalReports: reportsByCategory.reduce((sum, row) => sum + row.count, 0),
      regenerationRate: total ? Math.round(((feedback?.edited ?? 0) / total) * 10000) / 100 : 0,
    };
  }

  private conversationWhere(consentingUserIds: string[], dateFrom?: Date, dateTo?: Date): SQL {
    return and(
      inArray(schema.conversations.createdBy, consentingUserIds),
      ...(dateFrom ? [gte(schema.conversations.createdAt, dateFrom)] : []),
      ...(dateTo ? [lte(schema.conversations.createdAt, dateTo)] : []),
    )!;
  }
}
