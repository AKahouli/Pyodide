import { APPEARANCE_LOGO_ALLOWED_MIMES, APPEARANCE_LOGO_CONSTRAINTS } from '../constants/appearance-logo.constants';

export interface ImageDimensions {
  width: number;
  height: number;
}

export function normalizeAppearanceLogoMime(mime: string): string {
  const normalized = mime.trim().toLowerCase();
  if (normalized === 'image/jpg') {
    return 'image/jpeg';
  }
  if (normalized === 'image/x-png') {
    return 'image/png';
  }
  if (normalized === 'image/vnd.microsoft.icon') {
    return 'image/x-icon';
  }
  return normalized;
}

export function isAppearanceLogoMime(mime: string | null | undefined): mime is string {
  if (!mime) {
    return false;
  }
  return (APPEARANCE_LOGO_ALLOWED_MIMES as readonly string[]).includes(normalizeAppearanceLogoMime(mime));
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffAppearanceLogoMime(buffer: Buffer, declaredMime?: string): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  const gifHeader = buffer.length >= 6 ? buffer.toString('ascii', 0, 6) : '';
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return 'image/gif';
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp';
  }
  if (buffer.length >= 4 && buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1) {
    return 'image/x-icon';
  }
  const head = buffer.subarray(0, Math.min(buffer.length, 256)).toString('utf8').trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) {
    return 'image/svg+xml';
  }
  if (declaredMime && isAppearanceLogoMime(declaredMime)) {
    return normalizeAppearanceLogoMime(declaredMime);
  }
  return null;
}

export function readAppearanceLogoDimensions(buffer: Buffer, mimeType: string): ImageDimensions | null {
  const mime = normalizeAppearanceLogoMime(mimeType);
  if (mime === 'image/png') {
    return readPngSize(buffer);
  }
  if (mime === 'image/jpeg') {
    return readJpegSize(buffer);
  }
  if (mime === 'image/webp') {
    return readWebpSize(buffer);
  }
  if (mime === 'image/gif') {
    return readGifSize(buffer);
  }
  if (mime === 'image/bmp') {
    return readBmpSize(buffer);
  }
  if (mime === 'image/x-icon') {
    return readIcoSize(buffer);
  }
  if (mime === 'image/svg+xml') {
    return readSvgSize(buffer);
  }
  return null;
}

export function validateAppearanceLogoDimensions(dimensions: ImageDimensions): boolean {
  const { width, height } = dimensions;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }
  const aspect = width / height;
  return (
    width >= APPEARANCE_LOGO_CONSTRAINTS.minWidth &&
    width <= APPEARANCE_LOGO_CONSTRAINTS.maxWidth &&
    height >= APPEARANCE_LOGO_CONSTRAINTS.minHeight &&
    height <= APPEARANCE_LOGO_CONSTRAINTS.maxHeight &&
    aspect >= APPEARANCE_LOGO_CONSTRAINTS.minAspectRatio &&
    aspect <= APPEARANCE_LOGO_CONSTRAINTS.maxAspectRatio
  );
}

function readPngSize(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegSize(buffer: Buffer): ImageDimensions | null {
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      return null;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    if (segmentLength < 2) {
      return null;
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebpSize(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 30) {
    return null;
  }
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    const start = 20;
    return {
      width: buffer.readUInt16LE(start + 6) & 0x3fff,
      height: buffer.readUInt16LE(start + 8) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

function readGifSize(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 10) {
    return null;
  }
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function readBmpSize(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 26) {
    return null;
  }
  return {
    width: Math.abs(buffer.readInt32LE(18)),
    height: Math.abs(buffer.readInt32LE(22)),
  };
}

function readIcoSize(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 8) {
    return null;
  }
  return {
    width: buffer[6] || 256,
    height: buffer[7] || 256,
  };
}

function readSvgSize(buffer: Buffer): ImageDimensions | null {
  const text = buffer.toString('utf8');
  const viewBox = /viewBox\s*=\s*["']?\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i.exec(text);
  if (viewBox) {
    const width = Number(viewBox[3]);
    const height = Number(viewBox[4]);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  const widthAttr = parseSvgLength((/\bwidth\s*=\s*["']?\s*([-\d.]+)/i.exec(text))?.[1]);
  const heightAttr = parseSvgLength((/\bheight\s*=\s*["']?\s*([-\d.]+)/i.exec(text))?.[1]);
  if (widthAttr && heightAttr) {
    return { width: widthAttr, height: heightAttr };
  }
  return null;
}

function parseSvgLength(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
