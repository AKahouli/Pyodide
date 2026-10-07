import { Injectable } from '@nestjs/common';
import { GroupByPeriod } from '../dto';
import type { UsageAnalyticsResponse } from '../interfaces';
import { PostgresUsageStore } from '../../usage/persistence/postgres-usage-store';

@Injectable()
export class UsageAnalyticsService {
  constructor(private readonly usageStore: PostgresUsageStore) {}

  getUsageAnalytics(
    consentingUserIds: string[],
    dateFrom?: Date,
    dateTo?: Date,
    groupBy: GroupByPeriod = GroupByPeriod.DAY,
  ): Promise<UsageAnalyticsResponse> {
    return this.usageStore.getAnalytics(
      consentingUserIds,
      dateFrom,
      dateTo,
      groupBy,
    );
  }
}
