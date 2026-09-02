import { APPEARANCE_LOGO_CONSTRAINTS, APPEARANCE_LOGO_OUTPUT, APPEARANCE_LOGO_SLOT } from '../constants';
import type { LogoFileIssue } from './logo-mime';

export interface FittedLogo {
  file: File;
  width: number;
  height: number;
}

export function containRect(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    x: Math.round((boxWidth - width) / 2),
    y: Math.round((boxHeight - height) / 2),
    width,
    height,
  };
}

export async function fitLogoToSlot(file: File): Promise<{ ok: true; fitted: FittedLogo } | { ok: false; issue: LogoFileIssue }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const retina = await rasterizeContain(image, APPEARANCE_LOGO_OUTPUT.widthPx, APPEARANCE_LOGO_OUTPUT.heightPx);
    const fallback = retina && retina.size <= APPEARANCE_LOGO_CONSTRAINTS.maxOutputBytes
      ? retina
      : await rasterizeContain(image, APPEARANCE_LOGO_SLOT.widthPx, APPEARANCE_LOGO_SLOT.heightPx);
    if (!fallback || fallback.size > APPEARANCE_LOGO_CONSTRAINTS.maxOutputBytes) {
      return { ok: false, issue: 'size' };
    }
    const width = fallback === retina ? APPEARANCE_LOGO_OUTPUT.widthPx : APPEARANCE_LOGO_SLOT.widthPx;
    const height = fallback === retina ? APPEARANCE_LOGO_OUTPUT.heightPx : APPEARANCE_LOGO_SLOT.heightPx;
    return {
      ok: true,
      fitted: {
        file: new File([fallback], pngFileName(file.name), { type: 'image/png' }),
        width,
        height,
      },
    };
  } catch {
    return { ok: false, issue: 'unreadable' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function pngFileName(name: string): string {
  return `${name.replace(/\.[^.]+$/, '') || 'logo'}.png`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('unreadable'));
    image.src = src;
  });
}

function rasterizeContain(image: HTMLImageElement, boxWidth: number, boxHeight: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = boxWidth;
  canvas.height = boxHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    return Promise.resolve(null);
  }
  context.clearRect(0, 0, boxWidth, boxHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const rect = containRect(image.naturalWidth || image.width, image.naturalHeight || image.height, boxWidth, boxHeight);
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
