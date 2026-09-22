import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, callPrivate, expectNoMongoKeys, expectNoKeys } from '../wire-helpers';
import { UsageService } from '@modules/usage/usage.service';
import type { PlanRecord } from '@modules/usage/persistence/plan.store';

const plan: PlanRecord = {
  id: '64b000000000000000000501',
  name: 'Pro',
  slug: 'pro',
  description: 'Pro plan',
  tokenLimit: 1000000,
  windowHours: 5,
  requestsPerMinute: 60,
  maxTokensPerRequest: 32000,
  features: ['chat', 'agents'],
  priority: 10,
  priceMonthly: 20,
  priceYearly: 200,
  currency: 'USD',
  isActive: true,
  isDefault: false,
  displayOrder: 2,
  maxWorkspaces: 5,
  workspaceStorageBytes: 1073741824,
  metadata: { internal: 'never on the wire' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

describe('usage plan contract', () => {
  it('mapPlanToResponse matches the plan fixture', () => {
    const body = toWire(callPrivate(UsageService, 'mapPlanToResponse', [plan]));
    expectContract('usage/plan', body);
    expect(body.id).toBe(plan.id);
    expect(body.isUnlimited).toBe(false);
    expectNoMongoKeys(body);
    expectNoKeys(body, 'metadata', 'createdAt', 'updatedAt');
  });

  it('flags unlimited plans (tokenLimit -1) and drops a null description', () => {
    const body = toWire(callPrivate(UsageService, 'mapPlanToResponse', [{ ...plan, tokenLimit: -1, description: null }]));
    expect(body.isUnlimited).toBe(true);
    expect(body).not.toHaveProperty('description');
  });

  it('mapUsageToResponse matches the usage window fixture', () => {
    const body = toWire(
      callPrivate(UsageService, 'mapUsageToResponse', [
        {
          id: '64b000000000000000000502',
          userId: '64b000000000000000000001',
          windowStart: new Date('2026-01-01T00:00:00Z'),
          windowEnd: new Date('2026-01-01T05:00:00Z'),
          windowHours: 5,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          requestCount: 2,
          planSlug: 'pro',
          tokenLimitAtCreation: 1000000,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T01:00:00Z'),
        },
      ]),
    );
    expectContract('usage/usage-window', body);
    expectNoMongoKeys(body);
  });
});
