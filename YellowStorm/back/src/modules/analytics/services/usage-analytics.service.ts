import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { USAGE_STORE, type UsageStore } from '@modules/usage/persistence/usage-store';
import { GroupByPeriod } from '../dto';
import type { UsageAnalyticsResponse } from '../interfaces';

@Injectable()
export class UsageAnalyticsService {
  constructor(@Inject(USAGE_STORE) private readonly usageStore: UsageStore) {}

  getUsageAnalytics(
    consentingUserIds: Types.ObjectId[],
    dateFrom?: Date,
    dateTo?: Date,
    groupBy: GroupByPeriod = GroupByPeriod.DAY,
  ): Promise<UsageAnalyticsResponse> {
    return this.usageStore.getAnalytics(
      consentingUserIds.map((id) => id.toString()),
      dateFrom,
      dateTo,
      groupBy,
    );
  }
}
