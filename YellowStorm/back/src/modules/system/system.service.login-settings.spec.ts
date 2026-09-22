import { SystemService } from './system.service';
import type { SystemSettingRow } from './persistence/system-setting.store';

describe('SystemService login settings', () => {
  const rows = new Map<string, SystemSettingRow>();
  const store = {
    get: async (key: string) => rows.get(key) ?? null,
    upsert: async (key: string, value: unknown) => {
      const saved: SystemSettingRow = { key, value, updatedAt: new Date() };
      rows.set(key, saved);
      return saved;
    },
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const build = () => new SystemService(
    store as never,
    {} as never,
    logger as never,
    {} as never,
  );

  beforeEach(() => {
    rows.clear();
    jest.clearAllMocks();
  });

  it('returns defaults and persists valid settings in the synchronous cache', async () => {
    const service = build();
    await expect(service.getLoginSettings()).resolves.toEqual({ accessExpiry: '3600m', refreshExpiry: '7d' });

    await expect(service.setLoginSettings({ accessExpiry: '30m', refreshExpiry: '14d' }))
      .resolves.toEqual({ accessExpiry: '30m', refreshExpiry: '14d' });
    expect(service.getLoginSettingsSync()).toEqual({ accessExpiry: '30m', refreshExpiry: '14d' });
  });

  it('rejects invalid ranges and refresh lifetimes shorter than access lifetimes', async () => {
    const service = build();
    await expect(service.setLoginSettings({ accessExpiry: '30s', refreshExpiry: '7d' })).rejects.toThrow();
    await expect(service.setLoginSettings({ accessExpiry: '2d', refreshExpiry: '1d' })).rejects.toThrow();
  });
});
