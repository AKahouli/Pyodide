import { Types } from 'mongoose';
import { UsageService } from './usage.service';
import type { UsageStore, UsageWindowRecord } from './persistence/usage-store';

describe('UsageService PostgreSQL persistence', () => {
  const plan = {
    _id: new Types.ObjectId(),
    slug: 'basic',
    windowHours: 24,
    tokenLimit: 1000,
  } as never;
  const record: UsageWindowRecord = {
    id: new Types.ObjectId().toString(),
    userId: new Types.ObjectId().toString(),
    windowStart: new Date('2026-09-12T00:00:00.000Z'),
    windowEnd: new Date('2026-09-13T00:00:00.000Z'),
    windowHours: 24,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    requestCount: 1,
    createdAt: new Date('2026-09-12T00:00:00.000Z'),
    updatedAt: new Date('2026-09-12T00:00:00.000Z'),
  };
  const usageStore = {
    record: jest.fn().mockResolvedValue(record),
    getOrCreateCurrentWindow: jest.fn(),
    getHistory: jest.fn(),
    getAnalytics: jest.fn(),
    deleteLogsBefore: jest.fn(),
  } as jest.Mocked<UsageStore>;
  const planModel = { findOne: jest.fn().mockResolvedValue(plan) };
  const logger = {
    setContext: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
  };
  const service = new UsageService(planModel as never, usageStore, logger as never);

  beforeEach(() => jest.clearAllMocks());

  it('records the aggregate and request log through the PostgreSQL store', async () => {
    const data = { userId: record.userId, inputTokens: 10, outputTokens: 5 };

    await expect(service.recordUsage(data)).resolves.toBe(record);

    expect(usageStore.record).toHaveBeenCalledWith(data, plan);
  });

  it('drains every full batch of expired usage logs', async () => {
    usageStore.deleteLogsBefore
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(12);

    await service.cleanupExpiredUsageLogs();

    expect(usageStore.deleteLogsBefore).toHaveBeenCalledTimes(3);
  });
});
