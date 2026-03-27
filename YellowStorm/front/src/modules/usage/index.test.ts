import { describe, expect, it } from 'vitest';
import * as usageModule from './index';

describe('usage module exports', () => {
  it('exports context, api, components, and utility', () => {
    expect(usageModule.UsageProvider).toBeDefined();
    expect(usageModule.useUsage).toBeDefined();
    expect(usageModule.getUsageStatus).toBeDefined();
    expect(usageModule.UsageSection).toBeDefined();
    expect(usageModule.UsageLimitBanner).toBeDefined();
    expect(usageModule.UpgradePage).toBeDefined();
    expect(usageModule.formatStorageSize).toBeDefined();
  });
});
