import { APPEARANCE_LOGO_CONSTRAINTS } from '../constants';
import { isAllowedLogoFile, validateLogoSourceDimensions, type LogoFileIssue } from './logo-mime';
import { fitLogoToSlot, type FittedLogo } from './logo-fit';

export interface LogoFileInspection {
  width: number;
  height: number;
  isSvg: boolean;
}

export async function inspectLogoFile(file: File): Promise<{ ok: true; inspection: LogoFileInspection } | { ok: false; issue: LogoFileIssue }> {
  if (!isAllowedLogoFile(file)) {
    return { ok: false, issue: 'type' };
  }
  if (file.size > APPEARANCE_LOGO_CONSTRAINTS.maxSourceBytes) {
    return { ok: false, issue: 'size' };
  }
  const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
  try {
    const inspection = isSvg ? await inspectSvg(file) : await inspectRaster(file);
    if (!inspection) {
      return { ok: false, issue: 'unreadable' };
    }
    if (!validateLogoSourceDimensions(inspection.width, inspection.height)) {
      return { ok: false, issue: 'dimensions' };
    }
    return { ok: true, inspection: { ...inspection, isSvg } };
  } catch {
    return { ok: false, issue: 'unreadable' };
  }
}

export async function prepareLogoUpload(
  file: File,
): Promise<{ ok: true; original: LogoFileInspection; fitted: FittedLogo } | { ok: false; issue: LogoFileIssue }> {
  const inspected = await inspectLogoFile(file);
  if (!inspected.ok) {
    return inspected;
  }
  const fitted = await fitLogoToSlot(file);
  if (!fitted.ok) {
    return fitted;
  }
  return { ok: true, original: inspected.inspection, fitted: fitted.fitted };
}

async function inspectRaster(file: File): Promise<Omit<LogoFileInspection, 'isSvg'> | null> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve(null);
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function inspectSvg(file: File): Promise<Omit<LogoFileInspection, 'isSvg'> | null> {
  const text = await file.text();
  const viewBox = text.match(/viewBox\s*=\s*["']?\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i);
  if (viewBox) {
    const width = Number(viewBox[3]);
    const height = Number(viewBox[4]);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  const width = Number(text.match(/\bwidth\s*=\s*["']?\s*([-\d.]+)/i)?.[1]);
  const height = Number(text.match(/\bheight\s*=\s*["']?\s*([-\d.]+)/i)?.[1]);
  if (width > 0 && height > 0) {
    return { width, height };
  }
  return null;
}
