import { APPEARANCE_LOGO_CONSTRAINTS } from '../constants';
import { isAllowedLogoFile, validateLogoSourceDimensions, type LogoFileIssue } from './logo-mime';
import { fitLogoToSlot, type FittedLogo } from './logo-fit';

export interface LogoFileInspection {
  width: number;
  height: number;
}

export async function inspectLogoFile(file: File): Promise<{ ok: true; inspection: LogoFileInspection } | { ok: false; issue: LogoFileIssue }> {
  if (!isAllowedLogoFile(file)) {
    return { ok: false, issue: 'type' };
  }
  if (file.size > APPEARANCE_LOGO_CONSTRAINTS.maxSourceBytes) {
    return { ok: false, issue: 'size' };
  }
  try {
    const inspection = await inspectRaster(file);
    if (!inspection) {
      return { ok: false, issue: 'unreadable' };
    }
    if (!validateLogoSourceDimensions(inspection.width, inspection.height)) {
      return { ok: false, issue: 'dimensions' };
    }
    return { ok: true, inspection };
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

async function inspectRaster(file: File): Promise<LogoFileInspection | null> {
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
