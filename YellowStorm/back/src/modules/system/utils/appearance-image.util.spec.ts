import {
  isAppearanceLogoMime,
  readAppearanceLogoDimensions,
  sniffAppearanceLogoMime,
  validateAppearanceLogoDimensions,
} from './appearance-image.util';

function pngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe('appearance-image.util', () => {
  it('reads PNG dimensions and sniffs mime type', () => {
    const buffer = pngBuffer(224, 48);
    expect(sniffAppearanceLogoMime(buffer)).toBe('image/png');
    expect(readAppearanceLogoDimensions(buffer, 'image/png')).toEqual({ width: 224, height: 48 });
  });

  it('reads JPEG SOF dimensions and sniffs mime type', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x30, 0x01, 0xc0, 0x01, 0x01, 0x11, 0x00]);
    expect(sniffAppearanceLogoMime(buffer)).toBe('image/jpeg');
    expect(readAppearanceLogoDimensions(buffer, 'image/jpeg')).toEqual({ width: 448, height: 48 });
    expect(sniffAppearanceLogoMime(Buffer.from('not-an-image'), 'image/jpg')).toBe('image/jpeg');
  });

  it('reads GIF and BMP dimensions', () => {
    const gif = Buffer.alloc(10);
    gif.write('GIF89a', 0, 'ascii');
    gif.writeUInt16LE(224, 6);
    gif.writeUInt16LE(48, 8);
    expect(sniffAppearanceLogoMime(gif)).toBe('image/gif');
    expect(readAppearanceLogoDimensions(gif, 'image/gif')).toEqual({ width: 224, height: 48 });

    const bmp = Buffer.alloc(26);
    bmp[0] = 0x42;
    bmp[1] = 0x4d;
    bmp.writeInt32LE(300, 18);
    bmp.writeInt32LE(56, 22);
    expect(sniffAppearanceLogoMime(bmp)).toBe('image/bmp');
    expect(readAppearanceLogoDimensions(bmp, 'image/bmp')).toEqual({ width: 300, height: 56 });
  });

  it('reads SVG viewBox dimensions but does not allow SVG logos', () => {
    const svg = Buffer.from('<svg viewBox="0 0 300 56" xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(readAppearanceLogoDimensions(svg, 'image/svg+xml')).toEqual({ width: 300, height: 56 });
    expect(isAppearanceLogoMime('image/svg+xml')).toBe(false);
  });

  it('accepts sidebar-shaped logos and rejects oversized ones', () => {
    expect(validateAppearanceLogoDimensions({ width: 224, height: 48 })).toBe(true);
    expect(validateAppearanceLogoDimensions({ width: 448, height: 96 })).toBe(true);
    expect(validateAppearanceLogoDimensions({ width: 2000, height: 2000 })).toBe(false);
    expect(validateAppearanceLogoDimensions({ width: 32, height: 32 })).toBe(false);
    expect(validateAppearanceLogoDimensions({ width: 256, height: 256 })).toBe(false);
  });

  it('allows only png, jpeg and webp logos', () => {
    expect(isAppearanceLogoMime('image/png')).toBe(true);
    expect(isAppearanceLogoMime('image/jpg')).toBe(true);
    expect(isAppearanceLogoMime('image/svg+xml')).toBe(false);
    expect(isAppearanceLogoMime('image/gif')).toBe(false);
    expect(isAppearanceLogoMime('image/bmp')).toBe(false);
  });
});
