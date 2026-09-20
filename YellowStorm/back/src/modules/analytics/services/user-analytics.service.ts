import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { LoggerService } from '@modules/logger';
import { GroupByPeriod } from '../dto';
import { UserAnalyticsResponse, TimeSeriesDataPoint } from '../interfaces';

type UserRow = typeof schema.identityUsers.$inferSelect;

/**
 * User analytics over PostgreSQL identity.users (plan 1A.10 — the last of the
 * three Mongo aggregations, ported to SQL).
 */
@Injectable()
export class UserAnalyticsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('UserAnalyticsService');
  }

  private get q(): NodePgDatabase<typeof schema> {
    return this.db;
  }

  /**
   * Get IDs of users who have consented to data sharing
   */
  async getConsentingUserIds(): Promise<string[]> {
    const rows = await this.q
      .select({ id: schema.identityUsers.id })
      .from(schema.identityUsers)
      .where(sql`${schema.identityUsers.consentDataSharing} = true`);
    return rows.map((r) => r.id);
  }

  /**
   * Get user analytics for consenting users
   */
  async getUserAnalytics(
    dateFrom?: Date,
    dateTo?: Date,
    groupBy: GroupByPeriod = GroupByPeriod.DAY,
  ): Promise<UserAnalyticsResponse> {
    const totalConsentingUsers = await this.countConsenting();

    const newUsersOverTime = await this.getNewUsersOverTime(dateFrom, dateTo, groupBy);
    const verificationStatus = await this.getVerificationStatus();
    const profileCompletion = await this.getProfileCompletion();

    return {
      totalConsentingUsers,
      newUsersOverTime,
      verificationStatus,
      profileCompletion,
    };
  }

  private async countConsenting(): Promise<number> {
    const rows = await this.q
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.identityUsers)
      .where(sql`${schema.identityUsers.consentDataSharing} = true`);
    return rows[0]?.n ?? 0;
  }

  private async getNewUsersOverTime(
    dateFrom: Date | undefined,
    dateTo: Date | undefined,
    groupBy: GroupByPeriod,
  ): Promise<TimeSeriesDataPoint[]> {
    const format = this.getDateFormat(groupBy);
    const conditions = [sql`${schema.identityUsers.consentDataSharing} = true`];
    if (dateFrom) conditions.push(sql`${schema.identityUsers.createdAt} >= ${dateFrom}`);
    if (dateTo) conditions.push(sql`${schema.identityUsers.createdAt} <= ${dateTo}`);
    const where = sql.join(conditions, sql` AND `);

    const rows = await this.q
      .select({
        date: sql<string>`to_char(${schema.identityUsers.createdAt}, ${format})`,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.identityUsers)
      .where(where)
      .groupBy(sql`to_char(${schema.identityUsers.createdAt}, ${format})`)
      .orderBy(sql`to_char(${schema.identityUsers.createdAt}, ${format})`);
    return rows;
  }

  private async getVerificationStatus(): Promise<{
    verified: number;
    unverified: number;
  }> {
    const rows = await this.q
      .select({
        verified: sql<number>`count(*) FILTER (WHERE ${schema.identityUsers.emailVerified})::int`,
        unverified: sql<number>`count(*) FILTER (WHERE NOT ${schema.identityUsers.emailVerified})::int`,
      })
      .from(schema.identityUsers)
      .where(sql`${schema.identityUsers.consentDataSharing} = true`);
    return { verified: rows[0]?.verified ?? 0, unverified: rows[0]?.unverified ?? 0 };
  }

  private async getProfileCompletion(): Promise<{
    complete: number;
    incomplete: number;
  }> {
    const rows = await this.q
      .select({
        complete: sql<number>`count(*) FILTER (WHERE ${schema.identityUsers.profileComplete})::int`,
        incomplete: sql<number>`count(*) FILTER (WHERE NOT ${schema.identityUsers.profileComplete})::int`,
      })
      .from(schema.identityUsers)
      .where(sql`${schema.identityUsers.consentDataSharing} = true`);
    return { complete: rows[0]?.complete ?? 0, incomplete: rows[0]?.incomplete ?? 0 };
  }

  /** PG to_char format matching the Mongo $dateToString output. */
  private getDateFormat(groupBy: GroupByPeriod): string {
    switch (groupBy) {
      case GroupByPeriod.DAY:
        return 'YYYY-MM-DD';
      case GroupByPeriod.WEEK:
        return 'IYYY-"W"IW';
      case GroupByPeriod.MONTH:
        return 'YYYY-MM';
      default:
        return 'YYYY-MM-DD';
    }
  }
}
