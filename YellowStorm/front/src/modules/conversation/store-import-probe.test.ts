import { describe, expect, it } from 'vitest';
describe('probe', () => {
  it('imports @/modules/localization/i18nInstance', async () => {
    await import('@/modules/localization/i18nInstance');
    expect(true).toBe(true);
  }, 8000);
});
