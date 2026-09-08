import { SystemService, EMAIL_LOGO_MAX_BYTES, EMAIL_LOGO_KEY } from './system.service';

describe('SystemService email logo', () => {
  const makeService = (store: Map<string, { value: unknown }>) => {
    const systemSettingModel = {
      findOne: jest.fn(({ key }: { key: string }) => {
        const doc = store.get(key) ?? null;
        return {
          lean: () => ({ exec: async () => doc }),
        };
      }),
      findOneAndUpdate: jest.fn(
        (_filter: { key: string }, update: { key: string; value: unknown }) => {
          store.set(update.key, { value: update.value });
          return { lean: () => ({ exec: async () => store.get(update.key) }) };
        },
      ),
      deleteOne: jest.fn(async ({ key }: { key: string }) => {
        store.delete(key);
        return { deletedCount: 1 };
      }),
    };
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const userModel = {};
    const appearanceLogoService = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn(),
      upload: jest.fn(),
      delete: jest.fn(),
    };
    const service = new SystemService(
      systemSettingModel as never,
      userModel as never,
      logger as never,
      appearanceLogoService as never,
    );
    return { service, systemSettingModel, logger };
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
    const { service, systemSettingModel } = makeService(new Map());
    const result = await service.setEmailLogo(pngLogo(), 'user-1');

    expect(result).toMatchObject({
      contentType: 'image/png',
      filename: 'brand.png',
      size: 14,
      data: Buffer.from('fake-png-bytes').toString('base64'),
      updatedBy: 'user-1',
    });
    expect(systemSettingModel.findOneAndUpdate).toHaveBeenCalledWith(
      { key: EMAIL_LOGO_KEY },
      expect.objectContaining({ key: EMAIL_LOGO_KEY }),
      { upsert: true, new: true },
    );
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
    const store = new Map<string, { value: unknown }>([
      [EMAIL_LOGO_KEY, { value: { not: 'a logo' } }],
    ]);
    const { service } = makeService(store);
    await expect(service.getEmailLogo()).resolves.toBeNull();
  });
});