import { AppearanceLogoService } from './appearance-logo.service';

describe('AppearanceLogoService', () => {
  it('rejects built-in logo ids on update', async () => {
    const service = new AppearanceLogoService(
      { findById: jest.fn(), countDocuments: jest.fn(), create: jest.fn(), find: jest.fn(), findByIdAndDelete: jest.fn() } as never,
      { findOne: jest.fn() } as never,
    );
    await expect(service.update('yellowmind', undefined, 'Nope')).rejects.toMatchObject({
      code: 'ERR_1606',
    });
  });

  it('unassigns a custom logo from themes before delete', async () => {
    const logoId = '507f1f77bcf86cd799439011';
    const setting = {
      value: {
        defaultColorTheme: 'blue',
        themes: {
          default: { labelKey: 'appearance.colorTheme.default', logo: logoId },
          yellow: { labelKey: 'appearance.colorTheme.yellow', logo: 'yellowmind' },
          orange: { labelKey: 'appearance.colorTheme.orange', logo: 'yellowmind' },
          blue: { labelKey: 'appearance.colorTheme.blue', logo: logoId },
        },
      },
      markModified: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const findByIdAndDelete = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: logoId }) });
    const service = new AppearanceLogoService(
      { findByIdAndDelete } as never,
      { findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(setting) }) } as never,
    );

    await service.remove(logoId);

    expect(setting.value.themes.default.logo).toBe('yellowmind');
    expect(setting.value.themes.blue.logo).toBe('yellowmind');
    expect(setting.markModified).toHaveBeenCalledWith('value');
    expect(setting.save).toHaveBeenCalled();
    expect(findByIdAndDelete).toHaveBeenCalled();
  });

  it('exposes known builtin ids', () => {
    const service = new AppearanceLogoService({} as never, {} as never);
    expect(service.isKnownLogoId('kpmg', [{ id: 'yellowmind', name: 'Yellowmind', kind: 'builtin' }, { id: 'kpmg', name: 'KPMG', kind: 'builtin' }])).toBe(true);
    expect(service.isKnownLogoId('missing', [{ id: 'yellowmind', name: 'Yellowmind', kind: 'builtin' }])).toBe(false);
  });

  it('rejects SVG uploads', async () => {
    const svg = Buffer.from('<svg viewBox="0 0 300 56" xmlns="http://www.w3.org/2000/svg"></svg>');
    const service = new AppearanceLogoService(
      { countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }), create: jest.fn() } as never,
      {} as never,
    );
    await expect(
      service.create({ originalname: 'mark.svg', mimetype: 'image/svg+xml', size: svg.length, buffer: svg }),
    ).rejects.toMatchObject({ code: 'ERR_1603' });
  });

  it('rejects non-image uploads', async () => {
    const service = new AppearanceLogoService(
      { countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }), create: jest.fn() } as never,
      {} as never,
    );
    await expect(
      service.create({ originalname: 'notes.txt', mimetype: 'text/plain', size: 4, buffer: Buffer.from('nope') }),
    ).rejects.toMatchObject({ code: 'ERR_1603' });
  });

  it('rejects square images that cannot fit the sidebar slot', async () => {
    const buffer = pngBuffer(256, 256);
    const service = new AppearanceLogoService(
      { countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }), create: jest.fn() } as never,
      {} as never,
    );
    await expect(
      service.create({ originalname: 'mark.png', mimetype: 'image/png', size: buffer.length, buffer }),
    ).rejects.toMatchObject({ code: 'ERR_1604' });
  });

  it('rejects stored files larger than 512 KB', async () => {
    const buffer = Buffer.concat([pngBuffer(224, 48), Buffer.alloc(513 * 1024)]);
    const service = new AppearanceLogoService(
      { countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }), create: jest.fn() } as never,
      {} as never,
    );
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
