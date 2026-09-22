import { AppearanceLogoService } from './appearance-logo.service';
import { SYSTEM_SETTING_STORE, type SystemSettingStore } from '../persistence/system-setting.store';
import { APPEARANCE_LOGO_STORE, type AppearanceLogoStore } from '../persistence/appearance-logo.store';

const fakeTxDb = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) } as never;

describe('AppearanceLogoService', () => {
  it('rejects built-in logo ids on update', async () => {
    const service = new AppearanceLogoService(
      fakeTxDb,
      {} as never,
      {} as never,
    );
    await expect(service.update('yellowmind', undefined, 'Nope')).rejects.toMatchObject({
      code: 'ERR_1606',
    });
  });

  it('unassigns a custom logo from themes before delete', async () => {
    const logoId = '507f1f77bcf86cd799439011';
    const appearanceValue = {
      defaultColorTheme: 'blue',
      themes: {
        default: { labelKey: 'appearance.colorTheme.default', logo: logoId },
        yellow: { labelKey: 'appearance.colorTheme.yellow', logo: 'yellowmind' },
        orange: { labelKey: 'appearance.colorTheme.orange', logo: 'yellowmind' },
        blue: { labelKey: 'appearance.colorTheme.blue', logo: logoId },
      },
    };
    const deleted = jest.fn().mockResolvedValue(true);
    const logoStore = { delete: deleted } as unknown as AppearanceLogoStore;
    const upsert = jest.fn().mockResolvedValue({});
    const systemSettings = { get: jest.fn().mockResolvedValue({ key: 'appearance_settings', value: appearanceValue, updatedAt: new Date() }), upsert } as unknown as SystemSettingStore;
    const service = new AppearanceLogoService(fakeTxDb, logoStore, systemSettings);

    await service.remove(logoId);

    expect(deleted).toHaveBeenCalledWith(logoId);
    expect(appearanceValue.themes.default.logo).toBe('yellowmind');
    expect(appearanceValue.themes.blue.logo).toBe('yellowmind');
    expect(upsert).toHaveBeenCalledWith('appearance_settings', appearanceValue);
  });

  it('exposes known builtin ids', () => {
    const service = new AppearanceLogoService(fakeTxDb, {} as never, {} as never);
    expect(service.isKnownLogoId('kpmg', [{ id: 'yellowmind', name: 'Yellowmind', kind: 'builtin' }, { id: 'kpmg', name: 'KPMG', kind: 'builtin' }])).toBe(true);
    expect(service.isKnownLogoId('missing', [{ id: 'yellowmind', name: 'Yellowmind', kind: 'builtin' }])).toBe(false);
  });

  it('rejects SVG uploads', async () => {
    const svg = Buffer.from('<svg viewBox="0 0 300 56" xmlns="http://www.w3.org/2000/svg"></svg>');
    const logoStore = { createWithinCap: jest.fn() } as unknown as AppearanceLogoStore;
    const service = new AppearanceLogoService(fakeTxDb, logoStore, {} as never);
    await expect(
      service.create({ originalname: 'mark.svg', mimetype: 'image/svg+xml', size: svg.length, buffer: svg }),
    ).rejects.toMatchObject({ code: 'ERR_1603' });
  });

  it('rejects non-image uploads', async () => {
    const logoStore = { createWithinCap: jest.fn() } as unknown as AppearanceLogoStore;
    const service = new AppearanceLogoService(fakeTxDb, logoStore, {} as never);
    await expect(
      service.create({ originalname: 'notes.txt', mimetype: 'text/plain', size: 4, buffer: Buffer.from('nope') }),
    ).rejects.toMatchObject({ code: 'ERR_1603' });
  });

  it('rejects square images that cannot fit the sidebar slot', async () => {
    const buffer = pngBuffer(256, 256);
    const logoStore = { createWithinCap: jest.fn() } as unknown as AppearanceLogoStore;
    const service = new AppearanceLogoService(fakeTxDb, logoStore, {} as never);
    await expect(
      service.create({ originalname: 'mark.png', mimetype: 'image/png', size: buffer.length, buffer }),
    ).rejects.toMatchObject({ code: 'ERR_1604' });
  });

  it('rejects stored files larger than 512 KB', async () => {
    const buffer = Buffer.concat([pngBuffer(224, 48), Buffer.alloc(513 * 1024)]);
    const logoStore = { createWithinCap: jest.fn() } as unknown as AppearanceLogoStore;
    const service = new AppearanceLogoService(fakeTxDb, logoStore, {} as never);
    await expect(
      service.create({ originalname: 'mark.png', mimetype: 'image/png', size: buffer.length, buffer }),
    ).rejects.toMatchObject({ code: 'ERR_1605' });
  });
});

function pngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}
