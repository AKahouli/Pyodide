import type { Plan, UsageStatus } from './types';

export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-free',
    name: 'Free',
    slug: 'free',
    description: 'Starter plan',
    tokenLimit: 10000,
    windowHours: 24,
    requestsPerMinute: 60,
    maxTokensPerRequest: 2000,
    features: ['basic_chat', 'history'],
    priority: 1,
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'USD',
    isActive: true,
    isDefault: true,
    displayOrder: 1,
    maxWorkspaces: 2,
    workspaceStorageBytes: 1024 * 1024,
    isUnlimited: false,
    ...overrides,
  };
}

export function makeUsageStatus(overrides: Partial<UsageStatus> = {}): UsageStatus {
  return {
    window: {
      start: '2025-01-01T00:00:00.000Z',
      end: '2025-01-02T00:00:00.000Z',
      hoursRemaining: 10,
    },
    tokens: {
      input: 100,
      output: 200,
      total: 300,
      limit: 1000,
      remaining: 700,
      percentUsed: 30,
      isUnlimited: false,
    },
    requests: {
      count: 12,
      limit: 60,
      remaining: 48,
      isUnlimited: false,
    },
    plan: {
      id: 'plan-free',
      name: 'Free',
      slug: 'free',
      tokenLimit: 10000,
      windowHours: 24,
      isUnlimited: false,
      features: ['basic_chat'],
      maxWorkspaces: 2,
      workspaceStorageBytes: 1024 * 1024,
    },
    isLimitExceeded: false,
    resetsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}
