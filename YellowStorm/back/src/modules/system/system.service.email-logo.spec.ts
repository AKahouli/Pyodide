import { SystemService, EMAIL_LOGO_MAX_BYTES, EMAIL_LOGO_KEY } from './system.service';
import type { SystemSettingRow } from './persistence/system-setting.store';

describe('SystemService email logo', () => {
  const makeService = (storeMap: Map<string, SystemSettingRow>) => {
    const upsert = jest.fn(async (key: string, value: unknown) => {
      const saved: SystemSettingRow = { key, value, updatedAt: new Date() };
      storeMap.set(key, saved);
      return saved;
    });
    const store = {
      get: jest.fn(async (key: string) => storeMap.get(key) ?? null),
      upsert,
      delete: jest.fn(async (key: string) => {
        storeMap.delete(key);
      }),
    };
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const userStore = {};
    const appearanceLogoService = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn(),
      upload: jest.fn(),
      delete: jest.fn(),
    };
    const service = new SystemService(
      store as never,
      userStore as never,
      logger as never,
      appearanceLogoService as never,
    );
    return { service, store, logger };
  };

  const pngLogo = () => ({
    buffer: Buffer.from('fake-png-bytes'),
    contentType: 'image/png',
    filename: 'brand.png',
    size: 14,
  });

  it('returns null when no custom logo is stored', async () => {
    const { service } = makeService(new Map());
    await expect(service.getEmailLogo()).resolves.toBeNull();
  });

  it('stores the logo as base64 and returns the persisted value', async () => {
    const { service, store } = makeService(new Map());
    const result = await service.setEmailLogo(pngLogo(), 'user-1');

    expect(result).toMatchObject({
      contentType: 'image/png',
      filename: 'brand.png',
      size: 14,
      data: Buffer.from('fake-png-bytes').toString('base64'),
      updatedBy: 'user-1',
    });
    expect(store.upsert).toHaveBeenCalledWith(EMAIL_LOGO_KEY, expect.objectContaining({ contentType: 'image/png' }));
    await expect(service.getEmailLogo()).resolves.toEqual(result);
  });

  it('rejects unsupported content types', async () => {
    const { service } = makeService(new Map());
    await expect(
      service.setEmailLogo({ ...pngLogo(), contentType: 'image/gif' }),
    ).rejects.toThrow(/Unsupported email logo content type/);
  });

  it('rejects files over the size limit', async () => {
    const { service } = makeService(new Map());
    await expect(
      service.setEmailLogo({ ...pngLogo(), size: EMAIL_LOGO_MAX_BYTES + 1 }),
    ).rejects.toThrow(/between 1 and/);
  });

  it('clears the stored logo and resets the cache', async () => {
    const { service } = makeService(new Map());
    await service.setEmailLogo(pngLogo());
    await service.clearEmailLogo('user-2');
    await expect(service.getEmailLogo()).resolves.toBeNull();
  });

  it('treats a malformed stored value as absent', async () => {
    const storeMap = new Map<string, SystemSettingRow>([
      [EMAIL_LOGO_KEY, { key: EMAIL_LOGO_KEY, value: { not: 'a logo' }, updatedAt: new Date() }],
    ]);
    const { service } = makeService(storeMap);
    await expect(service.getEmailLogo()).resolves.toBeNull();
  });
});
