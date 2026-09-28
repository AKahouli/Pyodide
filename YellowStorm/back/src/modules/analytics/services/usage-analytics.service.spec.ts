import { Types } from 'mongoose';
import { UsageAnalyticsService } from './usage-analytics.service';
import { GroupByPeriod } from '../dto';
import type { UsageStore } from '@modules/usage/persistence/usage-store';
import { PostgresUsageStore } from '@modules/usage/persistence/postgres-usage-store';

describe('UsageAnalyticsService', () => {
  it('delegates analytics to PostgreSQL with string user IDs', async () => {
    const response = {
      totalTokens: { input: 1, output: 2, total: 3 },
      tokensByModel: [],
      averageTokensPerConversation: 0,
      usageOverTime: [],
      errorRates: [],
    };
    const store = { getAnalytics: jest.fn().mockResolvedValue(response) } as unknown as PostgresUsageStore;
    const service = new UsageAnalyticsService(store);
    const userId = new Types.ObjectId().toString();

    await expect(
      service.getUsageAnalytics([userId], undefined, undefined, GroupByPeriod.WEEK),
    ).resolves.toBe(response);
    expect(store.getAnalytics).toHaveBeenCalledWith(
      [userId.toString()],
      undefined,
      undefined,
      GroupByPeriod.WEEK,
    );
  });
});
