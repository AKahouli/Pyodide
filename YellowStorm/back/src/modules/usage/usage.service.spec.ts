import { UsageService } from './usage.service';
import type { PlanRecord } from './persistence/plan.store';
import type { UsageStore, UsageWindowRecord } from './persistence/usage-store';

describe('UsageService PostgreSQL persistence', () => {
  const plan: PlanRecord = {
    id: '6ab01464b68fc5a92f1122a6',
    name: 'Basic',
    slug: 'basic',
    description: null,
    tokenLimit: 1000,
    windowHours: 24,
    requestsPerMinute: 60,
    maxTokensPerRequest: -1,
    features: [],
    priority: 0,
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'USD',
    isActive: true,
    isDefault: false,
    displayOrder: 0,
    maxWorkspaces: 3,
    workspaceStorageBytes: 104857600,
    metadata: {},
    createdAt: new Date('2026-09-12T00:00:00.000Z'),
    updatedAt: new Date('2026-09-12T00:00:00.000Z'),
  };
  const record: UsageWindowRecord = {
    id: '6ab01464b68fc5a92f1122a7',
    userId: '6ab01464b68fc5a92f1122a8',
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
  const planStore = {
    findBySlug: jest.fn().mockResolvedValue(plan),
    findFlaggedDefault: jest.fn().mockResolvedValue(null),
    findById: jest.fn(),
  };
  const logger = {
    setContext: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
  };
  const service = new UsageService(planStore as never, usageStore, logger as never);

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
