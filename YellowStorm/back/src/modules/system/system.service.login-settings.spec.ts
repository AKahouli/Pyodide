import { SystemService } from './system.service';

describe('SystemService login settings', () => {
  const store = new Map<string, unknown>();
  const model = {
    findOne: ({ key }: { key: string }) => ({
      lean: () => ({ exec: async () => store.get(key) ?? null }),
    }),
    findOneAndUpdate: jest.fn(async ({ key }, update) => {
      const saved = { key, value: update.value };
      store.set(key, saved);
      return saved;
    }),
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const build = () => new SystemService(
    model as never,
    {} as never,
    logger as never,
    {} as never,
  );

  beforeEach(() => {
    store.clear();
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
